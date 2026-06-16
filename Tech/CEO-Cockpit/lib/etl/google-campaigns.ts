/**
 * Google Ads campaign-level ETL
 *
 * Persists daily campaign metrics to google_campaigns_daily, including a
 * rolling peak_ctr computed from the last 7 days of stored data.
 * Fixes the creative fatigue feature which always showed "Healthy".
 *
 * Env vars required:
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_SPA_CUSTOMER_ID
 *   GOOGLE_ADS_AES_CUSTOMER_ID
 *   GOOGLE_ADS_SLIM_CUSTOMER_ID
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { upsert, selectRaw } from "@/lib/etl/supabase-etl";
import { ETLLogger } from "@/lib/etl/etl-logger";

const GOOGLE_ADS_BASE = "https://googleads.googleapis.com/v21";

const CUSTOMER_IDS: Record<string, string | undefined> = {
  spa:        process.env.GOOGLE_ADS_SPA_CUSTOMER_ID,
  aesthetics: process.env.GOOGLE_ADS_AES_CUSTOMER_ID,
  slimming:   process.env.GOOGLE_ADS_SLIM_CUSTOMER_ID,
};

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

async function getAccessToken(): Promise<string> {
  // .trim() strips trailing \n that Vercel CLI may append when pulling/storing env vars.
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID?.replace(/\n/g, "").trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.replace(/\n/g, "").trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.replace(/\n/g, "").trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Ads OAuth credentials not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });

  const json = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (json.error) throw new Error(`Google OAuth: ${json.error} — ${json.error_description ?? ""}`);
  return json.access_token!;
}

async function getBrandId(slug: string): Promise<string> {
  const rows = await selectRaw("brands", { slug: `eq.${slug}`, select: "id" });
  if (!rows.length) throw new Error(`Brand not found: ${slug}`);
  return rows[0].id as string;
}

async function fetchPeakCtrMap(
  brandId: string,
  sevenDaysAgo: string,
): Promise<Map<string, number>> {
  const rows = await selectRaw("google_campaigns_daily", {
    brand_id: `eq.${brandId}`,
    date:     `gte.${sevenDaysAgo}`,
    select:   "campaign_id,ctr_pct",
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    const cid = row.campaign_id as string;
    const ctr = (row.ctr_pct as number) ?? 0;
    map.set(cid, Math.max(map.get(cid) ?? 0, ctr));
  }
  return map;
}

function computeFatigueStatus(currentCtr: number, peakCtr: number): string {
  if (peakCtr <= 0) return "healthy";
  const ratio = currentCtr / peakCtr;
  if (ratio >= 0.8) return "healthy";
  if (ratio >= 0.5) return "warning";
  return "fatigued";
}

interface GoogleAdsRow {
  campaign?: {
    id?:     string;
    name?:   string;
    status?: string;
  };
  customer?: {
    currencyCode?: string; // e.g. "USD" or "EUR" — account billing currency
  };
  metrics?: {
    costMicros?:          string;
    impressions?:         string;
    clicks?:              string;
    conversions?:         number;
    allConversionsValue?: number;
    ctr?:                 number;
    averageCpc?:          number;
    averageCpm?:          number;
  };
  segments?: {
    date?: string;
  };
}

// Fetch live USD→EUR rate; falls back to a reasonable approximation.
// Note: api.frankfurter.app now redirects to api.frankfurter.dev/v1 — use the canonical URL directly.
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

async function fetchCampaignRows(
  customerId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string,
): Promise<GoogleAdsRow[]> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!devToken) throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");

  const cleanId = customerId.replace(/-/g, "");
  const url     = `${GOOGLE_ADS_BASE}/customers/${cleanId}/googleAds:searchStream`;

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      customer.currency_code,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.all_conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status != 'REMOVED'
  `;

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      Authorization:     `Bearer ${accessToken}`,
      "developer-token": devToken,
      "Content-Type":    "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads API (${cleanId}) ${res.status}: ${text.slice(0, 2000)}`);
  }

  const json = JSON.parse(text) as unknown;
  const allRows: GoogleAdsRow[] = [];
  if (Array.isArray(json)) {
    for (const batch of json) {
      if ((batch as { results?: GoogleAdsRow[] }).results) {
        allRows.push(...(batch as { results: GoogleAdsRow[] }).results);
      }
    }
  }
  return allRows;
}

export interface GoogleCampaignsEtlResult {
  rows_upserted: number;
  log: string;
}

export async function runGoogleCampaignsEtl(opts: {
  dateFrom: string;
  dateTo:   string;
  brandSlug?: BrandSlug;
}): Promise<GoogleCampaignsEtlResult> {
  // Observability wrapper — records start/success/fail to etl_sync_log
  // (log key "google_campaigns"). Data logic lives in the inner function.
  // Note: getAccessToken() throws inside the inner fn, so an expired
  // GOOGLE_ADS_REFRESH_TOKEN (invalid_grant) lands in the catch → fail().
  const logger = new ETLLogger("google_campaigns");
  await logger.start();
  try {
    const result = await runGoogleCampaignsEtlInner(opts);
    if (result.rows_upserted === 0 && result.log.includes("ERROR")) {
      await logger.fail(result.log.slice(0, 500));
    } else {
      await logger.complete(result.rows_upserted);
    }
    return result;
  } catch (err) {
    await logger.fail(String(err));
    throw err;
  }
}

async function runGoogleCampaignsEtlInner(opts: {
  dateFrom: string;
  dateTo:   string;
  brandSlug?: BrandSlug;
}): Promise<GoogleCampaignsEtlResult> {
  const { dateFrom, dateTo, brandSlug } = opts;
  const accessToken = await getAccessToken();

  const brandsToProcess = brandSlug
    ? [brandSlug]
    : (BRAND_SLUGS as readonly string[]) as BrandSlug[];

  const sevenDaysAgo = new Date(
    new Date(dateFrom).getTime() - 7 * 86_400_000,
  ).toISOString().slice(0, 10);

  // Fetch exchange rate once per ETL run (reused across all USD accounts).
  const usdToEur = await getUsdToEurRate();

  const log: string[] = [`[etl] using ${GOOGLE_ADS_BASE}`];
  let totalUpserted = 0;

  for (const slug of brandsToProcess) {
    const rawId = CUSTOMER_IDS[slug];
    // Defensive: Vercel CLI sometimes appends a literal "\n" to env var values.
    const customerId = rawId?.replace(/\n/g, "").trim();
    if (!customerId) {
      log.push(`[${slug}] GOOGLE_ADS_${slug === "aesthetics" ? "AES" : slug.toUpperCase()}_CUSTOMER_ID not set — skipped`);
      continue;
    }

    try {
      const brandId = await getBrandId(slug);

      log.push(`[${slug}] fetching campaign rows ${dateFrom}→${dateTo} (customer: ${customerId})`);
      const [rawRows, peakCtrMap] = await Promise.all([
        fetchCampaignRows(customerId, accessToken, dateFrom, dateTo),
        fetchPeakCtrMap(brandId, sevenDaysAgo),
      ]);

      // Detect account currency from first row (all rows share the same customer).
      const accountCurrency = rawRows[0]?.customer?.currencyCode ?? "EUR";
      const fxRate = accountCurrency === "USD" ? usdToEur : 1.0;
      log.push(`[${slug}] currency=${accountCurrency} fxRate=${fxRate.toFixed(4)} rows=${rawRows.length}`);

      const rows: Record<string, unknown>[] = [];

      for (const r of rawRows) {
        if (r.campaign?.status === "REMOVED") continue;

        const rawSpend        = (parseInt(r.metrics?.costMicros ?? "0", 10)) / 1_000_000;
        const spend           = rawSpend * fxRate; // always stored in EUR
        const impressions     = parseInt(r.metrics?.impressions ?? "0", 10);
        const clicks          = parseInt(r.metrics?.clicks ?? "0", 10);
        const conversions     = r.metrics?.conversions ?? 0;
        const conversionValue = (r.metrics?.allConversionsValue ?? 0) * fxRate;
        const ctrPct          = (r.metrics?.ctr ?? 0) * 100; // Google returns decimal
        const cpc             = ((r.metrics?.averageCpc ?? 0) / 1_000_000) * fxRate;
        const cpm             = ((r.metrics?.averageCpm ?? 0) / 1_000_000) * fxRate;
        const campaignId      = r.campaign?.id ?? "";
        const date            = r.segments?.date ?? dateFrom;

        const historicalPeak  = peakCtrMap.get(campaignId) ?? 0;
        const peakCtr         = Math.max(historicalPeak, ctrPct);
        const fatigueStatus   = computeFatigueStatus(ctrPct, peakCtr);
        const roas            = spend > 0 ? conversionValue / spend : null;

        rows.push({
          date,
          brand_id:         brandId,
          campaign_id:      campaignId,
          campaign_name:    r.campaign?.name ?? "Unknown",
          spend:            Math.round(spend * 100) / 100,
          impressions,
          clicks,
          conversions:      Math.round(conversions * 100) / 100,
          conversion_value: Math.round(conversionValue * 100) / 100,
          cpc:              Math.round(cpc * 100) / 100,
          cpm:              Math.round(cpm * 100) / 100,
          ctr_pct:          Math.round(ctrPct * 10000) / 10000,
          roas:             roas !== null ? Math.round(roas * 10000) / 10000 : null,
          peak_ctr:         Math.round(peakCtr * 10000) / 10000,
          fatigue_status:   fatigueStatus,
          etl_synced_at:    new Date().toISOString(),
        });
      }

      const upserted = await upsert("google_campaigns_daily", rows, "date,brand_id,campaign_id");
      totalUpserted += upserted;
      log.push(`[${slug}] ✓ ${upserted} rows upserted`);
    } catch (err) {
      log.push(`[${slug}] ERROR — ${String(err)}`);
    }
  }

  return { rows_upserted: totalUpserted, log: log.join("\n") };
}
