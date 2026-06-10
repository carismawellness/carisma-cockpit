/**
 * GET /api/funnel/constraint-heatmap?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Metric sources (after Jun 2026 accuracy fixes):
 *   daily_leads        — Meta meta_campaigns_daily: total leads / calendar days in range
 *   cpl                — Meta spend / Meta leads
 *   leads_per_agent    — Meta daily leads / active SDR agents for that brand in period
 *   booking_conversion — crm_agent_daily: SUM(total_booked) / SUM(total_messages) for SDR agents
 *   deposit_rate       — crm_agent_daily: SUM(total_deposit_count) / SUM(total_booked) for SDR agents
 *   speed_to_lead_min  — crm_daily: median of daily medians
 *   ad_refresh_days    — meta_campaigns_daily: days since newest campaign_id first appeared
 *
 * SDR agents per brand (chat team excluded):
 *   Spa: juliana, vj  |  Aesthetics: april  |  Slimming: dorianne, queenee
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

// SDR agents per brand — chat team (adeel, rana, abid, km, anni, nicci, nathalia) excluded
const BRAND_SDR_AGENTS: Record<BrandSlug, string[]> = {
  spa:        ["juliana", "vj"],
  aesthetics: ["april"],
  slimming:   ["dorianne", "queenee"],
};

export type BrandHeatmapMetrics = {
  daily_leads:        number | null;
  total_leads:        number | null;
  total_bookings:     number | null;
  total_revenue:      number | null;
  total_spend:        number | null;
  cpl:                number | null;
  leads_per_agent:    number | null;
  booking_conversion: number | null;
  deposit_rate:       number | null;
  show_rate_pct:      number | null;
  speed_to_lead_min:  number | null;
  ad_refresh_days:    number | null;
};

export type ConstraintHeatmapResponse = {
  brands:     Record<BrandSlug, BrandHeatmapMetrics>;
  date_from:  string;
  date_to:    string;
  fetched_at: string;
};

const EMPTY_METRICS: BrandHeatmapMetrics = {
  daily_leads: null, total_leads: null, total_bookings: null,
  total_revenue: null, total_spend: null,
  cpl: null, leads_per_agent: null,
  booking_conversion: null, deposit_rate: null,
  show_rate_pct: null, speed_to_lead_min: null, ad_refresh_days: null,
};

const REVENUE_TABLE: Record<BrandSlug, string> = {
  spa:        "spa_revenue_daily",
  aesthetics: "aesthetics_sales_daily",
  slimming:   "slimming_sales_daily",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const daysInRange = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1);

  // Brand ID lookup
  const { data: brandRows } = await supabase.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const b of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[b.slug] = b.id;

  const results = await Promise.all(BRAND_SLUGS.map(async (slug): Promise<[BrandSlug, BrandHeatmapMetrics]> => {
    const brandId = brandIdMap[slug];
    if (!brandId) return [slug, { ...EMPTY_METRICS }];

    // ── 1. Meta: daily_leads, cpl, ad_refresh ────────────────────────────────
    const { data: metaRows } = await supabase
      .from("meta_campaigns_daily")
      .select("campaign_id, spend, leads, date")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    type MetaRow = { campaign_id: string; spend: number; leads: number; date: string };

    const metaSpend = (metaRows ?? []).reduce((s: number, r: MetaRow) => s + (r.spend ?? 0), 0);
    const metaLeads = (metaRows ?? []).reduce((s: number, r: MetaRow) => s + (r.leads ?? 0), 0);
    const cpl        = metaLeads > 0 ? Math.round((metaSpend / metaLeads) * 100) / 100 : null;
    const daily_leads = metaLeads > 0 ? Math.round((metaLeads / daysInRange) * 10) / 10 : null;

    // Ad refresh proxy: days since newest campaign_id first appeared
    const firstSeen = new Map<string, string>();
    for (const r of (metaRows ?? []) as MetaRow[]) {
      if (r.campaign_id && !firstSeen.has(r.campaign_id)) firstSeen.set(r.campaign_id, r.date);
    }
    const newestLaunch = firstSeen.size > 0 ? [...firstSeen.values()].sort().reverse()[0] : null;
    const ad_refresh_days = newestLaunch
      ? Math.floor((Date.now() - new Date(newestLaunch).getTime()) / 86_400_000)
      : null;

    // ── 2. CRM agent data: booking conversion, deposit rate, active SDR count ─
    const sdrs = BRAND_SDR_AGENTS[slug];
    const { data: agentRows } = await supabase
      .from("crm_agent_daily")
      .select("agent_slug, total_booked, total_messages, total_deposit_count")
      .in("agent_slug", sdrs)
      .gte("date", from)
      .lte("date", to);

    type AgentRow = { agent_slug: string; total_booked: number; total_messages: number; total_deposit_count: number };

    const totalBooked   = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_booked   ?? 0), 0);
    const totalMessages = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_messages ?? 0), 0);
    const totalDeposits = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_deposit_count ?? 0), 0);

    const booking_conversion = totalMessages > 0 ? Math.round((totalBooked / totalMessages) * 1000) / 10 : null;
    const deposit_rate       = totalBooked   > 0 ? Math.round((totalDeposits / totalBooked) * 1000) / 10 : null;

    // Active SDR count = unique agents with any data in period
    const activeAgents = new Set((agentRows ?? []).map((r: AgentRow) => r.agent_slug)).size;
    const leads_per_agent = daily_leads !== null && activeAgents > 0
      ? Math.round((daily_leads / activeAgents) * 10) / 10
      : null;

    // ── 3. Revenue table ──────────────────────────────────────────────────────
    const { data: revenueRows } = await supabase
      .from(REVENUE_TABLE[slug])
      .select("price_ex_vat")
      .gte("date_of_service", from)
      .lte("date_of_service", to);

    type RevenueRow = { price_ex_vat: number | null };
    const total_revenue = (revenueRows ?? []).reduce(
      (s: number, r: RevenueRow) => s + (r.price_ex_vat ?? 0), 0,
    ) || null;

    // ── 4. crm_daily: speed to lead only ─────────────────────────────────────
    const { data: crmRows } = await supabase
      .from("crm_daily")
      .select("speed_to_lead_median_min")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    type CrmRow = { speed_to_lead_median_min: number | null };
    const stlValues = (crmRows ?? [])
      .filter((r: CrmRow) => r.speed_to_lead_median_min !== null && (r.speed_to_lead_median_min as number) > 0)
      .map((r: CrmRow) => r.speed_to_lead_median_min as number)
      .sort((a, b) => a - b);
    const stlMid = Math.floor(stlValues.length / 2);
    const speed_to_lead_min: number | null = stlValues.length > 0
      ? Math.round((stlValues.length % 2 === 1 ? stlValues[stlMid] : (stlValues[stlMid - 1] + stlValues[stlMid]) / 2) * 10) / 10
      : null;

    return [slug, {
      daily_leads,
      total_leads:    metaLeads > 0 ? metaLeads : null,
      total_bookings: totalBooked > 0 ? totalBooked : null,
      total_revenue,
      total_spend:    metaSpend > 0 ? Math.round(metaSpend) : null,
      cpl,
      leads_per_agent,
      booking_conversion,
      deposit_rate,
      show_rate_pct:    null,
      speed_to_lead_min,
      ad_refresh_days,
    }];
  }));

  return NextResponse.json({
    brands:     Object.fromEntries(results) as Record<BrandSlug, BrandHeatmapMetrics>,
    date_from:  from,
    date_to:    to,
    fetched_at: new Date().toISOString(),
  } satisfies ConstraintHeatmapResponse);
}
