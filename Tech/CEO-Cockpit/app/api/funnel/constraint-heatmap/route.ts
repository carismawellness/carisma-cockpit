/**
 * GET /api/funnel/constraint-heatmap?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Metric sources:
 *   total_revenue       — brand revenue table (Cockpit datasheet via ETL)
 *   total_leads         — Meta meta_campaigns_daily: SUM(leads)
 *   total_bookings      — crm_agent_daily: SUM(total_booked) for SDR agents
 *   daily_leads         — Meta leads / calendar days in range
 *   leads_per_agent     — daily_leads / active SDR count in period
 *   roas                — total_revenue / total_spend
 *   cpl                 — Meta spend / Meta leads
 *   booking_efficiency  — weighted avg of crm_agent_daily.conversion_rate_pct across SDR agents
 *                         (SUM(rate * messages) / SUM(messages))
 *   deposit_rate        — crm_agent_daily: SUM(total_deposit_count) / SUM(total_booked) for SDR agents
 *   speed_to_lead_min   — crm_daily: median of daily medians
 *   ad_refresh_days     — meta_campaigns_daily: days since newest campaign_id first appeared
 *
 * SDR agent list is read from crm_agent_mapping table (position='sdr', brand_slug=slug, is_active=true).
 * Falls back to hardcoded defaults if the table is empty.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

// Fallback SDR agents per brand if crm_agent_mapping table is empty
const FALLBACK_SDR_AGENTS: Record<BrandSlug, string[]> = {
  spa:        ["juliana", "vj"],
  aesthetics: ["april"],
  slimming:   ["dorianne", "queenee"],
};

// Manual booking efficiency overrides — takes precedence over DB computation
const BRAND_BOOKING_OVERRIDE: Partial<Record<BrandSlug, number>> = {
  spa: 10.0,  // Business assumption: conservative 10%
};

export type BrandHeatmapMetrics = {
  total_revenue:      number | null;
  total_leads:        number | null;
  total_bookings:     number | null;
  daily_leads:        number | null;
  leads_per_agent:    number | null;
  roas:               number | null;
  cpl:                number | null;
  booking_efficiency: number | null;
  deposit_rate:       number | null;
  show_rate_pct:      number | null;
  speed_to_lead_min:  number | null;
  ad_refresh_days:    number | null;
  // kept for campaign drilldown compatibility
  total_spend:        number | null;
};

export type ConstraintHeatmapResponse = {
  brands:     Record<BrandSlug, BrandHeatmapMetrics>;
  date_from:  string;
  date_to:    string;
  fetched_at: string;
};

const EMPTY_METRICS: BrandHeatmapMetrics = {
  total_revenue: null, total_leads: null, total_bookings: null,
  daily_leads: null, leads_per_agent: null,
  roas: null, cpl: null,
  booking_efficiency: null, deposit_rate: null,
  show_rate_pct: null, speed_to_lead_min: null, ad_refresh_days: null,
  total_spend: null,
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

  // ── Agent mapping from DB ─────────────────────────────────────────────────────
  const { data: agentMapRows } = await supabase
    .from("crm_agent_mapping")
    .select("agent_slug, brand_slug, position")
    .eq("is_active", true)
    .eq("position", "sdr");

  const brandSdrAgents: Record<BrandSlug, string[]> = { spa: [], aesthetics: [], slimming: [] };
  if (agentMapRows && agentMapRows.length > 0) {
    for (const r of agentMapRows as { agent_slug: string; brand_slug: string | null }[]) {
      if (r.brand_slug && r.brand_slug in brandSdrAgents) {
        brandSdrAgents[r.brand_slug as BrandSlug].push(r.agent_slug);
      }
    }
    // If a brand has no mapped agents fall back to hardcoded defaults
    for (const slug of BRAND_SLUGS) {
      if (brandSdrAgents[slug].length === 0) brandSdrAgents[slug] = FALLBACK_SDR_AGENTS[slug];
    }
  } else {
    // Table is empty — use hardcoded fallback
    Object.assign(brandSdrAgents, FALLBACK_SDR_AGENTS);
  }

  // Brand ID lookup
  const { data: brandRows } = await supabase.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const b of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[b.slug] = b.id;

  const results = await Promise.all(BRAND_SLUGS.map(async (slug): Promise<[BrandSlug, BrandHeatmapMetrics]> => {
    const brandId = brandIdMap[slug];
    if (!brandId) return [slug, { ...EMPTY_METRICS }];

    const sdrs = brandSdrAgents[slug];

    // ── 1. Meta: leads, spend, ad_refresh ────────────────────────────────────
    const { data: metaRows } = await supabase
      .from("meta_campaigns_daily")
      .select("campaign_id, spend, leads, date")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });

    type MetaRow = { campaign_id: string; spend: number; leads: number; date: string };

    const metaSpend  = (metaRows ?? []).reduce((s: number, r: MetaRow) => s + (r.spend ?? 0), 0);
    const metaLeads  = (metaRows ?? []).reduce((s: number, r: MetaRow) => s + (r.leads ?? 0), 0);
    const cpl        = metaLeads > 0 ? Math.round((metaSpend / metaLeads) * 100) / 100 : null;
    const daily_leads = metaLeads > 0 ? Math.round((metaLeads / daysInRange) * 10) / 10 : null;

    const firstSeen = new Map<string, string>();
    for (const r of (metaRows ?? []) as MetaRow[]) {
      if (r.campaign_id && !firstSeen.has(r.campaign_id)) firstSeen.set(r.campaign_id, r.date);
    }
    const newestLaunch = firstSeen.size > 0 ? [...firstSeen.values()].sort().reverse()[0] : null;
    const ad_refresh_days = newestLaunch
      ? Math.floor((Date.now() - new Date(newestLaunch).getTime()) / 86_400_000)
      : null;

    // ── 2. CRM agent data: booking efficiency, deposit rate, active SDR count ─
    const { data: agentRows } = await supabase
      .from("crm_agent_daily")
      .select("agent_slug, total_booked, total_messages, total_deposit_count, booking_eff_pct")
      .in("agent_slug", sdrs)
      .gte("date", from)
      .lte("date", to);

    type AgentRow = {
      agent_slug: string;
      total_booked: number;
      total_messages: number;
      total_deposit_count: number;
      booking_eff_pct: number;
    };

    const totalBooked   = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_booked   ?? 0), 0);
    const totalMessages = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_messages ?? 0), 0);
    const totalDeposits = (agentRows ?? []).reduce((s: number, r: AgentRow) => s + (r.total_deposit_count ?? 0), 0);

    // Booking efficiency: weighted average of per-row booking_eff_pct (sheet col G),
    // weighted by total_messages so high-volume agents contribute proportionally.
    let booking_efficiency: number | null;
    if (BRAND_BOOKING_OVERRIDE[slug] !== undefined) {
      booking_efficiency = BRAND_BOOKING_OVERRIDE[slug]!;
    } else {
      const weightedSum = (agentRows ?? []).reduce(
        (s: number, r: AgentRow) => s + ((r.booking_eff_pct ?? 0) * (r.total_messages ?? 0)),
        0,
      );
      booking_efficiency = totalMessages > 0
        ? Math.round((weightedSum / totalMessages) * 10) / 10
        : null;
    }

    const deposit_rate = totalBooked > 0
      ? Math.round((totalDeposits / totalBooked) * 1000) / 10
      : null;

    const activeAgents  = new Set((agentRows ?? []).map((r: AgentRow) => r.agent_slug)).size;
    const leads_per_agent = daily_leads !== null && activeAgents > 0
      ? Math.round((daily_leads / activeAgents) * 10) / 10
      : null;

    // ── 3. Revenue ────────────────────────────────────────────────────────────
    let total_revenue: number | null = null;
    if (slug === "spa") {
      const { data: spaRevRows } = await supabase
        .from("spa_revenue_daily")
        .select("services, product_phytomer, product_purest, product_other")
        .gte("date", from)
        .lte("date", to);
      type SpaRevRow = { services: number | null; product_phytomer: number | null; product_purest: number | null; product_other: number | null };
      const sum = (spaRevRows ?? []).reduce(
        (s: number, r: SpaRevRow) =>
          s + (r.services ?? 0) + (r.product_phytomer ?? 0) + (r.product_purest ?? 0) + (r.product_other ?? 0),
        0,
      );
      total_revenue = sum > 0 ? Math.round(sum * 100) / 100 : null;
    } else {
      const { data: revenueRows } = await supabase
        .from(REVENUE_TABLE[slug])
        .select("price_ex_vat")
        .gte("date_of_service", from)
        .lte("date_of_service", to);
      type RevenueRow = { price_ex_vat: number | null };
      const sum = (revenueRows ?? []).reduce((s: number, r: RevenueRow) => s + (r.price_ex_vat ?? 0), 0);
      total_revenue = sum > 0 ? Math.round(sum * 100) / 100 : null;
    }

    const total_spend = metaSpend > 0 ? Math.round(metaSpend) : null;
    const roas = total_revenue !== null && total_spend !== null && total_spend > 0
      ? Math.round((total_revenue / total_spend) * 100) / 100
      : null;

    // ── 4. Speed to lead ─────────────────────────────────────────────────────
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
      total_revenue,
      total_leads:    metaLeads > 0 ? metaLeads : null,
      total_bookings: totalBooked > 0 ? totalBooked : null,
      daily_leads,
      leads_per_agent,
      roas,
      cpl,
      booking_efficiency,
      deposit_rate,
      show_rate_pct:    null,
      speed_to_lead_min,
      ad_refresh_days,
      total_spend,
    }];
  }));

  return NextResponse.json({
    brands:     Object.fromEntries(results) as Record<BrandSlug, BrandHeatmapMetrics>,
    date_from:  from,
    date_to:    to,
    fetched_at: new Date().toISOString(),
  } satisfies ConstraintHeatmapResponse);
}
