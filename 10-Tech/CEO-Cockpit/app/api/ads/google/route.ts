import { NextRequest, NextResponse } from "next/server";
import type { AdsApiResponse, BrandSlug, CampaignData } from "@/lib/types/ads";

export const maxDuration = 120;

const VALID_BRANDS = new Set<string>(["spa", "aesthetics", "slimming"]);

function getCustomerId(brand: BrandSlug): string {
  const map: Record<BrandSlug, string | undefined> = {
    spa: process.env.GOOGLE_ADS_SPA_CUSTOMER_ID,
    aesthetics: process.env.GOOGLE_ADS_AES_CUSTOMER_ID,
    slimming: process.env.GOOGLE_ADS_SLIM_CUSTOMER_ID,
  };
  return map[brand] ?? "";
}

async function getAccessToken(): Promise<string> {
  // .trim() strips trailing \n that Vercel CLI may append when storing env vars.
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.replace(/\n/g, "").trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.replace(/\n/g, "").trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.replace(/\n/g, "").trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Ads OAuth credentials not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(`OAuth error: ${json.error} — ${json.error_description ?? ""}`);
  }
  return json.access_token;
}

interface GoogleAdsRow {
  campaign?: { name?: string; id?: string; status?: string };
  customer?: { currencyCode?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    costPerConversion?: number;
    allConversionsValue?: number;
    ctr?: number;
    averageCpc?: number;
    averageCpm?: number;
  };
}

async function getUsdToEurRate(): Promise<number> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=EUR");
    if (!res.ok) return 0.92;
    const data = await res.json() as { rates?: { EUR?: number } };
    return data.rates?.EUR ?? 0.92;
  } catch {
    return 0.92;
  }
}

function transformRows(rows: GoogleAdsRow[], fxRate: number, dayCount: number): CampaignData[] {
  return rows
    .filter((r) => r.campaign?.status !== "REMOVED")
    .map((r) => {
      const costMicros = parseInt(r.metrics?.costMicros ?? "0", 10);
      const spend = (costMicros / 1_000_000) * fxRate;
      const impressions = parseInt(r.metrics?.impressions ?? "0", 10);
      const clicks = parseInt(r.metrics?.clicks ?? "0", 10);
      const conversions = r.metrics?.conversions ?? 0;
      const ctr = (r.metrics?.ctr ?? 0) * 100; // Google returns as decimal
      const cpc = ((r.metrics?.averageCpc ?? 0) / 1_000_000) * fxRate;
      const cpm = ((r.metrics?.averageCpm ?? 0) / 1_000_000) * fxRate;
      const conversionValue = r.metrics?.allConversionsValue ?? 0;
      const cpl = conversions > 0 ? spend / conversions : 0;

      return {
        campaign: r.campaign?.name ?? "Unknown",
        campaignId: r.campaign?.id ?? "",
        cpl: Math.round(cpl * 100) / 100,
        totalSpend: Math.round(spend * 100) / 100,
        totalLeads: Math.round(conversions),
        clicks,
        ctr: Math.round(ctr * 10) / 10,
        cpm: Math.round(cpm * 100) / 100,
        frequency: impressions > 0 && clicks > 0 ? Math.round((impressions / (clicks / (ctr / 100 || 1))) * 10) / 10 : 1.0,
        attributedRevenue: Math.round(conversionValue),
        peakCtr: Math.round(ctr * 10) / 10,
      };
    });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  const emptyResponse: AdsApiResponse = {
    campaigns: [],
    totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
  };

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json({ ...emptyResponse, error: "Invalid brand" }, { status: 400 });
  }

  // Defensive: Vercel CLI sometimes appends a literal "\n" to pulled env var values.
  const customerId = getCustomerId(brand).replace(/\n/g, "").trim();
  if (!customerId) {
    return NextResponse.json(
      { ...emptyResponse, error: `Google Ads customer ID not configured for ${brand}. Set GOOGLE_ADS_${brand === "aesthetics" ? "AES" : brand.toUpperCase()}_CUSTOMER_ID in .env.local` },
      { status: 500 },
    );
  }

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!devToken) {
    return NextResponse.json({ ...emptyResponse, error: "GOOGLE_ADS_DEVELOPER_TOKEN not configured" }, { status: 500 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    return NextResponse.json(
      { ...emptyResponse, error: err instanceof Error ? err.message : "OAuth failed", tokenExpired: true },
      { status: 401 },
    );
  }

  const query = `
    SELECT
      campaign.name,
      campaign.id,
      campaign.status,
      customer.currency_code,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.all_conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status != 'REMOVED'
  `;

  const cleanCustomerId = customerId.replace(/-/g, "").trim();
  const url = `https://googleads.googleapis.com/v21/customers/${cleanCustomerId}/googleAds:searchStream`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
      next: { revalidate: 300 },
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ...emptyResponse, error: `Google Ads API returned non-JSON (status ${res.status})` },
        { status: 502 },
      );
    }

    if (!res.ok) {
      const j = json as Record<string, unknown>;
      const errMsg =
        (j as { error?: { message?: string } })?.error?.message ??
        (Array.isArray(j) ? (j[0] as { error?: { message?: string } })?.error?.message : null) ??
        `Google Ads API error (${res.status})`;
      const isExpired = String(errMsg).includes("expired") || String(errMsg).includes("UNAUTHENTICATED");
      return NextResponse.json(
        { ...emptyResponse, error: errMsg, tokenExpired: isExpired },
        { status: isExpired ? 401 : 502 },
      );
    }

    // searchStream returns array of result batches
    const allRows: GoogleAdsRow[] = [];
    if (Array.isArray(json)) {
      for (const batch of json) {
        if (batch.results) {
          allRows.push(...batch.results);
        }
      }
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));

    // Detect account currency from first row and convert USD → EUR if needed.
    const accountCurrency = allRows[0]?.customer?.currencyCode ?? "EUR";
    const fxRate = accountCurrency === "USD" ? await getUsdToEurRate() : 1.0;

    const campaigns = transformRows(allRows, fxRate, dayCount);

    const totals = campaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + c.totalSpend,
        leads: acc.leads + c.totalLeads,
        impressions: acc.impressions,
        clicks: acc.clicks,
        revenue: acc.revenue + c.attributedRevenue,
      }),
      { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
    );

    return NextResponse.json({ campaigns, totals } satisfies AdsApiResponse);
  } catch (err) {
    return NextResponse.json(
      { ...emptyResponse, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
