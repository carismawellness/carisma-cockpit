/**
 * GET /api/ads/google-db?brand=spa&from=2026-01-01&to=2026-06-09
 *
 * Reads from google_campaigns_daily (Supabase) and returns AdsApiResponse.
 * Aggregates daily rows by campaign_id for the requested date range.
 * Uses peak_ctr stored by the ETL for accurate creative fatigue scoring.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AdsApiResponse, BrandSlug, CampaignData } from "@/lib/types/ads";

const VALID_BRANDS = new Set<string>(["spa", "aesthetics", "slimming"]);

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}

function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey:        key,
    Authorization: `Bearer ${key}`,
    Accept:        "application/json",
  };
}

async function getBrandId(slug: string): Promise<string | null> {
  const res = await fetch(`${sbUrl("brands")}?slug=eq.${slug}&select=id`, {
    headers: sbHeaders(),
  });
  if (!res.ok) return null;
  const rows = await res.json() as { id: string }[];
  return rows[0]?.id ?? null;
}

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

  const brandId = await getBrandId(brand);
  if (!brandId) {
    return NextResponse.json({ ...EMPTY, error: `Brand '${brand}' not found` }, { status: 404 });
  }

  const qs = new URLSearchParams({
    brand_id: `eq.${brandId}`,
    date:     `gte.${dateFrom}`,
    select:   "campaign_id,campaign_name,spend,impressions,clicks,conversions,conversion_value,ctr_pct,cpc,cpm,peak_ctr",
  });
  qs.append("date", `lte.${dateTo}`);

  const res = await fetch(`${sbUrl("google_campaigns_daily")}?${qs}`, {
    headers: sbHeaders(),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ ...EMPTY, error: `Supabase: ${err}` }, { status: 502 });
  }

  type DbRow = {
    campaign_id:      string;
    campaign_name:    string;
    spend:            number;
    impressions:      number;
    clicks:           number;
    conversions:      number | null;
    conversion_value: number | null;
    ctr_pct:          number | null;
    cpc:              number | null;
    cpm:              number | null;
    peak_ctr:         number | null;
  };

  const rows = await res.json() as DbRow[];

  // Aggregate by campaign_id
  const map = new Map<string, {
    name:            string;
    spend:           number;
    impressions:     number;
    clicks:          number;
    conversions:     number;
    conversionValue: number;
    peakCtr:         number;
    ctrSum:          number;
    cpmSum:          number;
    dayCount:        number;
  }>();

  for (const r of rows) {
    const existing = map.get(r.campaign_id);
    if (existing) {
      existing.spend           += r.spend ?? 0;
      existing.impressions     += r.impressions ?? 0;
      existing.clicks          += r.clicks ?? 0;
      existing.conversions     += r.conversions ?? 0;
      existing.conversionValue += r.conversion_value ?? 0;
      existing.peakCtr          = Math.max(existing.peakCtr, r.peak_ctr ?? 0);
      existing.ctrSum          += r.ctr_pct ?? 0;
      existing.cpmSum          += r.cpm ?? 0;
      existing.dayCount        += 1;
    } else {
      map.set(r.campaign_id, {
        name:            r.campaign_name,
        spend:           r.spend ?? 0,
        impressions:     r.impressions ?? 0,
        clicks:          r.clicks ?? 0,
        conversions:     r.conversions ?? 0,
        conversionValue: r.conversion_value ?? 0,
        peakCtr:         r.peak_ctr ?? 0,
        ctrSum:          r.ctr_pct ?? 0,
        cpmSum:          r.cpm ?? 0,
        dayCount:        1,
      });
    }
  }

  const campaigns: CampaignData[] = [];
  for (const [campaignId, agg] of map) {
    const n = agg.dayCount;
    campaigns.push({
      campaign:          agg.name,
      campaignId,
      cpl:               agg.conversions > 0 ? Math.round((agg.spend / agg.conversions) * 100) / 100 : 0,
      totalSpend:        Math.round(agg.spend * 100) / 100,
      totalLeads:        Math.round(agg.conversions),
      clicks:            agg.clicks,
      ctr:               n > 0 ? Math.round((agg.ctrSum / n) * 100) / 100 : 0,
      cpm:               n > 0 ? Math.round((agg.cpmSum / n) * 100) / 100 : 0,
      frequency:         1, // Google doesn't track frequency the same way
      attributedRevenue: Math.round(agg.conversionValue * 100) / 100,
      peakCtr:           Math.round(agg.peakCtr * 100) / 100,
    });
  }

  campaigns.sort((a, b) => b.totalSpend - a.totalSpend);

  const totals = campaigns.reduce(
    (acc, c) => ({
      spend:       acc.spend + c.totalSpend,
      leads:       acc.leads + c.totalLeads,
      impressions: acc.impressions,
      clicks:      acc.clicks + c.clicks,
      revenue:     acc.revenue + c.attributedRevenue,
    }),
    { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 },
  );

  return NextResponse.json({ campaigns, totals } satisfies AdsApiResponse);
}
