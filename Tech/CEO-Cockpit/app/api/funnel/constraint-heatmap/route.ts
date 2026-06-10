/**
 * GET /api/funnel/constraint-heatmap?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Aggregates real funnel KPIs per brand:
 *   - crm_daily:          total_leads, appointments_booked → daily_leads, booking_conversion
 *   - meta_campaigns_daily: spend, leads                   → cpl
 *   - crm_agent_daily:    total_deposit_count, total_booked → deposit_rate (global, shared across brands)
 *
 * Metrics not yet stored in DB are returned as null:
 *   ad_refresh_days, speed_to_lead_min, show_rate_pct
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

// Agent count per brand — from BrandFunnelCard hardcoded config
const AGENT_COUNT: Record<BrandSlug, number> = {
  spa: 3,
  aesthetics: 4,
  slimming: 2,
};

export type BrandHeatmapMetrics = {
  daily_leads:        number | null;
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
  daily_leads: null, cpl: null, leads_per_agent: null,
  booking_conversion: null, deposit_rate: null,
  show_rate_pct: null, speed_to_lead_min: null, ad_refresh_days: null,
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Brand ID lookup
  const { data: brandRows } = await supabase.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const b of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[b.slug] = b.id;

  // Global deposit rate from crm_agent_daily (agents are shared across brands)
  const { data: agentRows } = await supabase
    .from("crm_agent_daily")
    .select("total_deposit_count, total_booked")
    .gte("date", from)
    .lte("date", to);

  const globalDeposits = (agentRows ?? []).reduce((s: number, r: { total_deposit_count: number }) => s + (r.total_deposit_count ?? 0), 0);
  const globalBooked   = (agentRows ?? []).reduce((s: number, r: { total_booked: number })          => s + (r.total_booked   ?? 0), 0);
  const globalDepositRate = globalBooked > 0
    ? Math.round((globalDeposits / globalBooked) * 1000) / 10
    : null;

  // Per-brand metrics
  const results = await Promise.all(BRAND_SLUGS.map(async (slug): Promise<[BrandSlug, BrandHeatmapMetrics]> => {
    const brandId = brandIdMap[slug];
    if (!brandId) return [slug, { ...EMPTY_METRICS }];

    // crm_daily
    const { data: crmRows } = await supabase
      .from("crm_daily")
      .select("total_leads, appointments_booked, speed_to_lead_median_min, deposit_pct")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    type CrmRow = { total_leads: number; appointments_booked: number; speed_to_lead_median_min: number | null; deposit_pct: number | null };
    const totalLeads  = (crmRows ?? []).reduce((s: number, r: CrmRow) => s + (r.total_leads ?? 0), 0);
    const totalBooked = (crmRows ?? []).reduce((s: number, r: CrmRow) => s + (r.appointments_booked ?? 0), 0);
    const daysWithLeads = (crmRows ?? []).filter((r: CrmRow) => r.total_leads > 0).length;

    const daily_leads        = daysWithLeads > 0 ? Math.round((totalLeads / daysWithLeads) * 10) / 10 : null;
    const booking_conversion = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 1000) / 10 : null;
    const leads_per_agent    = daily_leads !== null ? Math.round((daily_leads / AGENT_COUNT[slug]) * 10) / 10 : null;

    // Speed to lead — median of daily medians
    const stlValues = (crmRows ?? [])
      .filter((r: CrmRow) => r.speed_to_lead_median_min !== null && r.speed_to_lead_median_min > 0)
      .map((r: CrmRow) => r.speed_to_lead_median_min as number)
      .sort((a, b) => a - b);
    const stlMid = Math.floor(stlValues.length / 2);
    const speed_to_lead_min: number | null = stlValues.length > 0
      ? Math.round((stlValues.length % 2 === 1 ? stlValues[stlMid] : (stlValues[stlMid - 1] + stlValues[stlMid]) / 2) * 10) / 10
      : null;

    // Deposit rate from crm_daily if available (weighted by total_booked)
    let depNum = 0, depDen = 0;
    for (const r of (crmRows ?? []) as CrmRow[]) {
      if (r.deposit_pct !== null && r.appointments_booked > 0) {
        depNum += r.deposit_pct * r.appointments_booked;
        depDen += r.appointments_booked;
      }
    }
    const brand_deposit_rate = depDen > 0 ? Math.round((depNum / depDen) * 10) / 10 : null;

    // meta_campaigns_daily for CPL + ad_refresh proxy
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
    const cpl = metaLeads > 0 ? Math.round((metaSpend / metaLeads) * 100) / 100 : null;

    // Ad refresh proxy: days since the most recently launched campaign first appeared
    const firstSeen = new Map<string, string>();
    for (const r of (metaRows ?? []) as MetaRow[]) {
      if (r.campaign_id && !firstSeen.has(r.campaign_id)) firstSeen.set(r.campaign_id, r.date);
    }
    const newestLaunch = firstSeen.size > 0
      ? [...firstSeen.values()].sort().reverse()[0]
      : null;
    const ad_refresh_days = newestLaunch
      ? Math.floor((Date.now() - new Date(newestLaunch).getTime()) / 86_400_000)
      : null;

    return [slug, {
      daily_leads,
      cpl,
      leads_per_agent,
      booking_conversion,
      deposit_rate:      brand_deposit_rate ?? globalDepositRate,
      show_rate_pct:     null,
      speed_to_lead_min,
      ad_refresh_days,
    }];
  }));

  const brands = Object.fromEntries(results) as Record<BrandSlug, BrandHeatmapMetrics>;

  return NextResponse.json({
    brands,
    date_from: from,
    date_to: to,
    fetched_at: new Date().toISOString(),
  } satisfies ConstraintHeatmapResponse);
}
