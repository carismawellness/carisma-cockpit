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
  show_rate_pct:      null;
  speed_to_lead_min:  null;
  ad_refresh_days:    null;
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
      .select("total_leads, appointments_booked")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    const totalLeads  = (crmRows ?? []).reduce((s: number, r: { total_leads: number }) => s + (r.total_leads ?? 0), 0);
    const totalBooked = (crmRows ?? []).reduce((s: number, r: { appointments_booked: number }) => s + (r.appointments_booked ?? 0), 0);
    const daysWithLeads = (crmRows ?? []).filter((r: { total_leads: number }) => r.total_leads > 0).length;

    const daily_leads        = daysWithLeads > 0 ? Math.round((totalLeads / daysWithLeads) * 10) / 10 : null;
    const booking_conversion = totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 1000) / 10 : null;
    const leads_per_agent    = daily_leads !== null ? Math.round((daily_leads / AGENT_COUNT[slug]) * 10) / 10 : null;

    // meta_campaigns_daily for CPL
    const { data: metaRows } = await supabase
      .from("meta_campaigns_daily")
      .select("spend, leads")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    const metaSpend = (metaRows ?? []).reduce((s: number, r: { spend: number }) => s + (r.spend ?? 0), 0);
    const metaLeads = (metaRows ?? []).reduce((s: number, r: { leads: number }) => s + (r.leads ?? 0), 0);
    const cpl = metaLeads > 0 ? Math.round((metaSpend / metaLeads) * 100) / 100 : null;

    return [slug, {
      daily_leads,
      cpl,
      leads_per_agent,
      booking_conversion,
      deposit_rate:      globalDepositRate,
      show_rate_pct:     null,
      speed_to_lead_min: null,
      ad_refresh_days:   null,
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
