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
  outbound_clicks?: MetaAction[]; // link clicks — matches "CPC (cost per link click)" in Ads Manager
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

function extractLeads(actions: MetaAction[] | undefined): number {
  return actions?.reduce((s, a) => a.action_type === "lead" ? s + parseInt(a.value || "0", 10) : s, 0) ?? 0;
}

function extractLinkClicks(row: MetaInsight): number {
  const link = (row.outbound_clicks ?? []).reduce(
    (s, a) => a.action_type === "outbound_click" ? s + parseInt(a.value || "0", 10) : s, 0,
  );
  return link > 0 ? link : parseInt(row.clicks ?? "0", 10);
}

function extractRevenue(row: MetaInsight, spend: number): number {
  const roasVal = row.purchase_roas?.find((r) => r.action_type === "omni_purchase")?.value ?? row.purchase_roas?.[0]?.value ?? "0";
  return Math.round(safeNum(roasVal) * spend);
}

/**
 * Groups weekly-breakdown insight rows by campaign and computes:
 * - Full-period totals (spend, leads, clicks, revenue, frequency)
 * - Launch-week CPL (CPL in the earliest 7-day window — used for fatigue detection)
 *
 * With time_increment=7, Meta returns one row per campaign per calendar week.
 * The row with the smallest date_start is the launch week.
 */
function transformWeeklyInsights(insights: MetaInsight[]): CampaignData[] {
  // Group rows by campaign_id
  const map = new Map<string, {
    name: string;
    weeks: { dateStart: string; spend: number; leads: number; clicks: number; revenue: number; ctr: number; cpm: number; freqSum: number; }[];
  }>();

  for (const row of insights) {
    const id   = row.campaign_id   ?? row.campaign_name ?? "unknown";
    const name = row.campaign_name ?? "Unknown";
    const spend   = safeNum(row.spend);
    const leads   = extractLeads(row.actions);
    const clicks  = extractLinkClicks(row);
    const revenue = extractRevenue(row, spend);
    const ctr     = safeNum(row.ctr);
    const cpm     = safeNum(row.cpm);
    const freq    = safeNum(row.frequency);

    const entry = { dateStart: row.date_start ?? "", spend, leads, clicks, revenue, ctr, cpm, freqSum: freq };
    const existing = map.get(id);
    if (!existing) {
      map.set(id, { name, weeks: [entry] });
    } else {
      existing.weeks.push(entry);
    }
  }

  const campaigns: CampaignData[] = [];
  for (const [id, { name, weeks }] of map) {
    // Sort ascending by date so weeks[0] is always the earliest (launch) week
    weeks.sort((a, b) => a.dateStart.localeCompare(b.dateStart));

    const totalSpend   = weeks.reduce((s, w) => s + w.spend,    0);
    const totalLeads   = weeks.reduce((s, w) => s + w.leads,    0);
    const totalClicks  = weeks.reduce((s, w) => s + w.clicks,   0);
    const totalRevenue = weeks.reduce((s, w) => s + w.revenue,  0);
    const n            = weeks.length;
    const avgCtr = n > 0 ? weeks.reduce((s, w) => s + w.ctr, 0) / n : 0;
    const avgCpm = n > 0 ? weeks.reduce((s, w) => s + w.cpm, 0) / n : 0;
    // Frequency: average across weeks (Meta reports per-week frequency)
    const avgFreq = n > 0 ? weeks.reduce((s, w) => s + w.freqSum, 0) / n : 0;

    const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

    // Launch-week CPL — first week's spend ÷ first week's leads
    const lw = weeks[0];
    const launchWeekCpl = lw && lw.leads > 0 ? Math.round((lw.spend / lw.leads) * 100) / 100 : undefined;

    campaigns.push({
      campaign: name,
      campaignId: id,
      cpl:              Math.round(cpl * 100) / 100,
      totalSpend:       Math.round(totalSpend * 100) / 100,
      totalLeads,
      clicks:           totalClicks,
      ctr:              Math.round(avgCtr * 100) / 100,
      cpm:              Math.round(avgCpm * 100) / 100,
      frequency:        Math.round(avgFreq * 10) / 10,
      attributedRevenue: totalRevenue,
      peakCtr:          Math.round(avgCtr * 100) / 100,
      launchWeekCpl,
    });
  }

  return campaigns;
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
    "clicks",           // all clicks
    "outbound_clicks",  // link clicks — what Meta shows as "CPC (cost per link click)"
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
  url.searchParams.set("time_increment", "7");   // weekly rows — enables launch-week CPL fatigue detection
  url.searchParams.set("limit", "500");           // N campaigns × W weeks; 500 covers up to ~40 campaigns × 12 weeks
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
    const campaigns = transformWeeklyInsights(insights);

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
