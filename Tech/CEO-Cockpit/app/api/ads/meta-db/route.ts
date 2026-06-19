/**
 * GET /api/ads/meta-db?brand=spa&from=2026-01-01&to=2026-06-09
 *
 * Reads from meta_campaigns_daily (Supabase) and returns AdsApiResponse.
 * Aggregates daily rows by campaign_id for the requested date range.
 *
 * Expected revenue uses the same formula as the Funnel dashboard:
 *   leads × (GHL lead conversion rate) × AOV per campaign type
 * This ensures the Profitability Matrix on the marketing pages is consistent
 * with the Funnel's "Exp. Revenue" figures for the same period.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AdsApiResponse, BrandSlug, CampaignData } from "@/lib/types/ads";
import { computeLeadConversion } from "@/lib/funnel/lead-conversion";
import { resolveAov } from "@/lib/funnel/aov";

const VALID_BRANDS = new Set<string>(["spa", "aesthetics", "slimming"]);

const EMPTY: AdsApiResponse = {
  campaigns: [],
  totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand    = searchParams.get("brand") as BrandSlug | null;
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json({ ...EMPTY, error: "Invalid brand" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Brand ID lookup
  const { data: brandRows } = await supabase
    .from("brands")
    .select("id")
    .eq("slug", brand)
    .single();
  const brandId: number | null = (brandRows as { id: number } | null)?.id ?? null;

  if (!brandId) {
    return NextResponse.json({ ...EMPTY, error: `Brand '${brand}' not found` }, { status: 404 });
  }

  // Fetch campaign daily rows
  const { data: rows, error } = await supabase
    .from("meta_campaigns_daily")
    .select("campaign_id,campaign_name,spend,impressions,clicks,leads,cpl,ctr_pct,cpm,frequency,peak_ctr")
    .eq("brand_id", brandId)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    return NextResponse.json({ ...EMPTY, error: `Supabase: ${error.message}` }, { status: 502 });
  }

  // Conversion rate — same formula used by the Funnel campaign-drilldown
  const leadConv = await computeLeadConversion(supabase, brandId, dateFrom, dateTo);
  const convRate = leadConv.ratePct !== null ? leadConv.ratePct / 100 : 0;

  type DbRow = {
    campaign_id:   string;
    campaign_name: string;
    spend:         number;
    impressions:   number;
    clicks:        number;
    leads:         number;
    cpl:           number | null;
    ctr_pct:       number | null;
    cpm:           number | null;
    frequency:     number | null;
    peak_ctr:      number | null;
  };

  // Aggregate by campaign_id
  const map = new Map<string, {
    name:        string;
    spend:       number;
    impressions: number;
    clicks:      number;
    leads:       number;
    peakCtr:     number;
    ctrSum:      number;
    cpmSum:      number;
    freqSum:     number;
    dayCount:    number;
  }>();

  for (const r of (rows ?? []) as DbRow[]) {
    const existing = map.get(r.campaign_id);
    if (existing) {
      existing.spend       += r.spend ?? 0;
      existing.impressions += r.impressions ?? 0;
      existing.clicks      += r.clicks ?? 0;
      existing.leads       += r.leads ?? 0;
      existing.peakCtr      = Math.max(existing.peakCtr, r.peak_ctr ?? 0);
      existing.ctrSum      += r.ctr_pct ?? 0;
      existing.cpmSum      += r.cpm ?? 0;
      existing.freqSum     += r.frequency ?? 0;
      existing.dayCount    += 1;
    } else {
      map.set(r.campaign_id, {
        name:        r.campaign_name,
        spend:       r.spend ?? 0,
        impressions: r.impressions ?? 0,
        clicks:      r.clicks ?? 0,
        leads:       r.leads ?? 0,
        peakCtr:     r.peak_ctr ?? 0,
        ctrSum:      r.ctr_pct ?? 0,
        cpmSum:      r.cpm ?? 0,
        freqSum:     r.frequency ?? 0,
        dayCount:    1,
      });
    }
  }

  const campaigns: CampaignData[] = [];
  for (const [campaignId, agg] of map) {
    const n = agg.dayCount;
    const aov = resolveAov(brand, agg.name);
    // Expected revenue = same formula as Funnel dashboard (leads × convRate × AOV)
    const expectedRevenue = Math.round(agg.leads * convRate * aov * 100) / 100;
    campaigns.push({
      campaign:          agg.name,
      campaignId,
      cpl:               agg.leads > 0 ? Math.round((agg.spend / agg.leads) * 100) / 100 : 0,
      totalSpend:        Math.round(agg.spend * 100) / 100,
      totalLeads:        agg.leads,
      ctr:               n > 0 ? Math.round((agg.ctrSum / n) * 100) / 100 : 0,
      cpm:               n > 0 ? Math.round((agg.cpmSum / n) * 100) / 100 : 0,
      frequency:         n > 0 ? Math.round((agg.freqSum / n) * 10) / 10 : 0,
      attributedRevenue: expectedRevenue,
      peakCtr:           Math.round(agg.peakCtr * 100) / 100,
    });
  }

  campaigns.sort((a, b) => b.totalSpend - a.totalSpend);

  const totals = campaigns.reduce(
    (acc, c) => ({
      spend:       acc.spend + c.totalSpend,
      leads:       acc.leads + c.totalLeads,
      impressions: acc.impressions,
      clicks:      acc.clicks,
      revenue:     acc.revenue + c.attributedRevenue,
    }),
    { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
  );

  return NextResponse.json({ campaigns, totals } satisfies AdsApiResponse);
}
