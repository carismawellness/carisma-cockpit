import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AdsApiResponse, BrandSlug, CampaignData } from "@/lib/types/ads";

export const maxDuration = 120;

async function getMetaToken(): Promise<{ token: string | null; expired: boolean }> {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data } = await supabaseAdmin
      .from("integration_tokens")
      .select("token, expires_at")
      .eq("platform", "meta_ads")
      .is("brand_id", null)
      .single();

    if (data?.token) {
      const expired = data.expires_at ? new Date(data.expires_at) < new Date() : false;
      return { token: data.token, expired };
    }
  } catch {
    // Fall through to env
  }

  const envToken = process.env.META_ACCESS_TOKEN;
  if (!envToken || envToken === "REPLACE_WITH_NEW_TOKEN") {
    return { token: null, expired: true };
  }
  return { token: envToken, expired: false };
}

const META_AD_ACCOUNTS: Record<BrandSlug, string> = {
  spa: "act_654279452039150",
  aesthetics: "act_382359687910745",
  slimming: "act_1496776195316716",
};

const VALID_BRANDS = new Set<string>(["spa", "aesthetics", "slimming"]);

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsight {
  campaign_name?: string;
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  frequency?: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  purchase_roas?: { action_type: string; value: string }[];
  date_start?: string;
  date_stop?: string;
}

function safeNum(val: string | undefined | null): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function transformInsights(
  insights: MetaInsight[],
  dayCount: number,
): CampaignData[] {
  return insights.map((row) => {
    const spend = safeNum(row.spend);
    const leads =
      row.actions?.reduce((sum, a) => {
        if (a.action_type === "lead") {
          return sum + parseInt(a.value || "0", 10);
        }
        return sum;
      }, 0) ?? 0;

    const cpl = leads > 0 ? spend / leads : 0;
    const ctr = safeNum(row.ctr);
    const frequency = safeNum(row.frequency);

    // Purchase ROAS from Meta — multiply by spend to get attributed revenue
    const roasValue =
      row.purchase_roas?.find((r) => r.action_type === "omni_purchase")
        ?.value ??
      row.purchase_roas?.[0]?.value ??
      "0";
    const roas = safeNum(roasValue);
    const attributedRevenue = Math.round(roas * spend);

    return {
      campaign: row.campaign_name ?? "Unknown",
      campaignId: row.campaign_id ?? "",
      cpl: Math.round(cpl * 100) / 100,
      totalSpend: Math.round(spend * 100) / 100,
      totalLeads: leads,
      ctr: Math.round(ctr * 100) / 100,
      cpm: Math.round(safeNum(row.cpm) * 100) / 100,
      frequency: Math.round(frequency * 10) / 10,
      attributedRevenue,
      // peakCtr requires historical tracking; default to current CTR
      peakCtr: Math.round(ctr * 100) / 100,
    };
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const dateFrom = searchParams.get("from"); // YYYY-MM-DD
  const dateTo = searchParams.get("to"); // YYYY-MM-DD

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json(
      { campaigns: [], totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 }, error: "Invalid brand" },
      { status: 400 },
    );
  }

  const { token, expired: tokenPreExpired } = await getMetaToken();
  if (!token) {
    return NextResponse.json(
      { campaigns: [], totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 }, error: "Meta access token not configured", tokenExpired: true } satisfies AdsApiResponse,
      { status: 500 },
    );
  }
  if (tokenPreExpired) {
    return NextResponse.json(
      { campaigns: [], totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 }, error: "Meta access token has expired — refresh it at /api/ads/meta/refresh", tokenExpired: true } satisfies AdsApiResponse,
      { status: 401 },
    );
  }

  const accountId = META_AD_ACCOUNTS[brand];
  const fields = [
    "campaign_name",
    "campaign_id",
    "spend",
    "impressions",
    "clicks",
    "cpc",
    "cpm",
    "ctr",
    "frequency",
    "actions",
    "cost_per_action_type",
    "purchase_roas",
  ].join(",");

  const timeRange =
    dateFrom && dateTo
      ? JSON.stringify({ since: dateFrom, until: dateTo })
      : JSON.stringify({ since: "2026-01-01", until: new Date().toISOString().slice(0, 10) });

  const url = new URL(`https://graph.facebook.com/v22.0/${accountId}/insights`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("time_range", timeRange);
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    const json = await res.json();

    if (json.error) {
      const isExpired =
        json.error.code === 190 || json.error.message?.includes("expired");
      return NextResponse.json(
        {
          campaigns: [],
          totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
          error: json.error.message || "Meta API error",
          tokenExpired: isExpired,
        } satisfies AdsApiResponse,
        { status: isExpired ? 401 : 502 },
      );
    }

    const insights: MetaInsight[] = json.data ?? [];

    const from = dateFrom ? new Date(dateFrom) : new Date("2026-01-01");
    const to = dateTo ? new Date(dateTo) : new Date();
    const dayCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));

    const campaigns = transformInsights(insights, dayCount);

    const totals = campaigns.reduce(
      (acc, c) => ({
        spend: acc.spend + c.totalSpend,
        leads: acc.leads + c.totalLeads,
        impressions: acc.impressions, // not available at campaign aggregate — kept for interface compat
        clicks: acc.clicks,
        revenue: acc.revenue + c.attributedRevenue,
      }),
      { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
    );

    return NextResponse.json({ campaigns, totals } satisfies AdsApiResponse);
  } catch (err) {
    return NextResponse.json(
      {
        campaigns: [],
        totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
        error: err instanceof Error ? err.message : "Unknown error",
      } satisfies AdsApiResponse,
      { status: 500 },
    );
  }
}
