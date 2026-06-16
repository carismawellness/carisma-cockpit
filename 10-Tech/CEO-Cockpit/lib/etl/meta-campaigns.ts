/**
 * Meta Ads campaign-level ETL
 *
 * Persists daily campaign metrics to meta_campaigns_daily, including a
 * rolling peak_ctr computed from the last 7 days of stored data.
 * This fixes the creative fatigue feature which previously computed
 * peakCtr = currentCtr on every render, always showing "Healthy".
 *
 * Env vars required:
 *   META_ACCESS_TOKEN         — system user token (non-expiring)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { upsert, selectRaw } from "@/lib/etl/supabase-etl";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";

const META_BASE = "https://graph.facebook.com/v22.0";

const META_AD_ACCOUNTS: Record<string, string> = {
  spa:        "act_654279452039150",
  aesthetics: "act_382359687910745",
  slimming:   "act_1496776195316716",
};

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsight {
  campaign_id?:        string;
  campaign_name?:      string;
  adset_name?:         string;
  spend?:              string;
  impressions?:        string;
  clicks?:             string;
  /** Link clicks only (outbound_clicks) — what Meta Ads Manager calls "CPC (cost per link click)" */
  outbound_clicks?:    MetaAction[];
  ctr?:                string;
  cpm?:                string;
  frequency?:          string;
  actions?:            MetaAction[];
  purchase_roas?:      { action_type: string; value: string }[];
  date_start?:         string;
}

function safeNum(val: string | undefined | null): number {
  if (!val) return 0;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function computeFatigueStatus(currentCtr: number, peakCtr: number): string {
  if (peakCtr <= 0) return "healthy";
  const ratio = currentCtr / peakCtr;
  if (ratio >= 0.8) return "healthy";
  if (ratio >= 0.5) return "warning";
  return "fatigued";
}

// Each brand's ad account lives in a separate Meta Business Portfolio,
// so each needs its own system-user token.
const BRAND_TOKEN_ENVS: Record<string, string> = {
  spa:        "META_ACCESS_TOKEN_SPA",
  aesthetics: "META_ACCESS_TOKEN_AES",
  slimming:   "META_ACCESS_TOKEN_SLIM",
};

async function getMetaToken(brandSlug?: string): Promise<string> {
  // Per-brand env vars take priority (system user tokens scoped to each brand's portfolio)
  if (brandSlug) {
    const envKey = BRAND_TOKEN_ENVS[brandSlug];
    const t = envKey ? process.env[envKey] : undefined;
    if (t && t !== "REPLACE_WITH_NEW_TOKEN") return t;
  }

  // Fall back to integration_tokens (OAuth user-authorized generic token)
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await sb
      .from("integration_tokens")
      .select("token, expires_at")
      .eq("platform", "meta_ads")
      .is("brand_id", null)
      .single();
    if (data?.token) {
      const expired = data.expires_at ? new Date(data.expires_at) < new Date() : false;
      if (!expired) return data.token as string;
    }
  } catch { /* fall through */ }

  // Generic env var last resort
  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken && envToken !== "REPLACE_WITH_NEW_TOKEN") return envToken;

  throw new Error(`Meta token not configured for ${brandSlug ?? "any brand"}`);
}

async function getBrandId(slug: string): Promise<string> {
  const rows = await selectRaw("brands", { slug: `eq.${slug}`, select: "id" });
  if (!rows.length) throw new Error(`Brand not found: ${slug}`);
  return rows[0].id as string;
}

/**
 * Fetch the max ctr_pct per campaign_id for the last 7 days from Supabase.
 * Used to compute rolling peak_ctr without an RPC.
 */
async function fetchPeakCtrMap(
  brandId: string,
  sevenDaysAgo: string,
): Promise<Map<string, number>> {
  const rows = await selectRaw("meta_campaigns_daily", {
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

async function fetchInsights(
  accountId: string,
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<MetaInsight[]> {
  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_name",
    "spend",
    "impressions",
    "clicks",         // all clicks — used for impressions context, NOT for CPC
    "outbound_clicks", // link clicks — what Meta calls "CPC (cost per link click)"
    "ctr",
    "cpm",
    "frequency",
    "actions",
    "purchase_roas",
  ].join(",");

  const url = new URL(`${META_BASE}/${accountId}/insights`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("time_increment", "1"); // daily breakdown
  url.searchParams.set("time_range", JSON.stringify({ since: dateFrom, until: dateTo }));
  // Force the same attribution window Meta Ads Manager uses by default (7-day click, 1-day view).
  // Without this, the API defaults to a broader window (includes 7-day view) and over-counts leads.
  url.searchParams.set("action_attribution_windows", JSON.stringify(["7d_click", "1d_view"]));
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", token);

  const allInsights: MetaInsight[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const json = await res.json() as {
      data?: MetaInsight[];
      error?: { message: string; code: number };
      paging?: { next?: string };
    };

    if (json.error) {
      throw new Error(`Meta API (${accountId}): ${json.error.message}`);
    }

    allInsights.push(...(json.data ?? []));
    nextUrl = json.paging?.next ?? null;
  }

  return allInsights;
}

export interface MetaCampaignsEtlResult {
  rows_upserted: number;
  log: string;
}

export async function runMetaCampaignsEtl(opts: {
  dateFrom: string;
  dateTo:   string;
  brandSlug?: BrandSlug;
}): Promise<MetaCampaignsEtlResult> {
  // Observability wrapper — records start/success/fail to etl_sync_log
  // (log key "meta_campaigns"). Data logic lives in the inner function.
  const logger = new ETLLogger("meta_campaigns");
  await logger.start();
  try {
    const result = await runMetaCampaignsEtlInner(opts);
    // Per-brand errors are caught inside the loop; treat a run where every
    // brand errored (nothing upserted) as a failure.
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

async function runMetaCampaignsEtlInner(opts: {
  dateFrom: string;
  dateTo:   string;
  brandSlug?: BrandSlug;
}): Promise<MetaCampaignsEtlResult> {
  const { dateFrom, dateTo, brandSlug } = opts;

  const brandsToProcess = brandSlug
    ? [brandSlug]
    : (BRAND_SLUGS as readonly string[]) as BrandSlug[];

  // Seven days before dateFrom for peak_ctr lookback
  const sevenDaysAgo = new Date(
    new Date(dateFrom).getTime() - 7 * 86_400_000,
  ).toISOString().slice(0, 10);

  const log: string[] = [];
  let totalUpserted = 0;

  for (const slug of brandsToProcess) {
    const accountId = META_AD_ACCOUNTS[slug];
    if (!accountId) {
      log.push(`[${slug}] no ad account configured — skipped`);
      continue;
    }

    try {
      const brandId = await getBrandId(slug);
      const token = await getMetaToken(slug);

      log.push(`[${slug}] fetching insights ${dateFrom}→${dateTo}`);
      const [insights, peakCtrMap] = await Promise.all([
        fetchInsights(accountId, token, dateFrom, dateTo),
        fetchPeakCtrMap(brandId, sevenDaysAgo),
      ]);

      const rows: Record<string, unknown>[] = [];

      for (const row of insights) {
        const spend       = safeNum(row.spend);
        const impressions = parseInt(row.impressions ?? "0", 10);
        // Use outbound_clicks (link clicks) to match Meta Ads Manager's
        // "CPC (cost per link click)" definition. Falls back to all-clicks
        // only if outbound_clicks is absent from the API response.
        const linkClicks  = (row.outbound_clicks ?? []).reduce(
          (s, a) => a.action_type === "outbound_click" ? s + parseInt(a.value || "0", 10) : s,
          0,
        );
        const clicks = linkClicks > 0 ? linkClicks : parseInt(row.clicks ?? "0", 10);
        const ctrPct      = safeNum(row.ctr);
        const cpm         = safeNum(row.cpm);
        const frequency   = safeNum(row.frequency);
        const campaignId  = row.campaign_id ?? "";

        const leads = (row.actions ?? []).reduce((sum, a) => {
          return a.action_type === "lead" ? sum + parseInt(a.value || "0", 10) : sum;
        }, 0);

        const roasRaw = row.purchase_roas?.find(
          (r) => r.action_type === "omni_purchase",
        )?.value ?? row.purchase_roas?.[0]?.value ?? "0";
        const roas             = safeNum(roasRaw);
        const attributedRevenue = spend > 0 ? Math.round(roas * spend * 100) / 100 : 0;

        const historicalPeak = peakCtrMap.get(campaignId) ?? 0;
        const peakCtr        = Math.max(historicalPeak, ctrPct);
        const fatigueStatus  = computeFatigueStatus(ctrPct, peakCtr);

        rows.push({
          date:               row.date_start?.slice(0, 10) ?? dateFrom,
          brand_id:           brandId,
          campaign_id:        campaignId,
          campaign_name:      row.campaign_name ?? "Unknown",
          adset_name:         row.adset_name ?? null,
          spend:              Math.round(spend * 100) / 100,
          impressions,
          clicks,
          leads,
          cpl:                leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
          ctr_pct:            Math.round(ctrPct * 10000) / 10000,
          cpm:                Math.round(cpm * 100) / 100,
          frequency:          Math.round(frequency * 1000) / 1000,
          attributed_revenue: attributedRevenue,
          roas:               spend > 0 ? Math.round(roas * 10000) / 10000 : null,
          peak_ctr:           Math.round(peakCtr * 10000) / 10000,
          fatigue_status:     fatigueStatus,
          etl_synced_at:      new Date().toISOString(),
        });
      }

      const upserted = await upsert("meta_campaigns_daily", rows, "date,brand_id,campaign_id");
      totalUpserted += upserted;
      log.push(`[${slug}] ✓ ${upserted} rows upserted`);
    } catch (err) {
      log.push(`[${slug}] ERROR — ${String(err)}`);
    }
  }

  return { rows_upserted: totalUpserted, log: log.join("\n") };
}
