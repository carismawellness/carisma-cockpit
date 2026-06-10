/**
 * GET /api/funnel/campaign-drilldown?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns per-campaign Meta metrics (spend, leads, CPL, attributed_revenue, ROAS)
 * grouped by brand. Booking conversion is sourced at brand level from crm_daily
 * and applied uniformly to all campaigns of that brand.
 *
 * Columns not available per-campaign: show_rate_pct → null
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;

// Default AOV per brand (€). Campaign-name keywords can override.
const BRAND_AOV_DEFAULT: Record<string, number> = {
  spa:        180,
  aesthetics: 350,
  slimming:  1200,
};

// Keyword → AOV overrides (checked against lowercased campaign name)
const AOV_OVERRIDES: Array<{ keywords: string[]; aov: number }> = [
  { keywords: ["fat freeze", "cryolipolysis"],    aov: 450  },
  { keywords: ["hifu", "ultrasound"],             aov: 600  },
  { keywords: ["laser", "ipl"],                   aov: 300  },
  { keywords: ["facial", "hydrafacial"],          aov: 200  },
  { keywords: ["botox", "filler", "injectables"], aov: 500  },
  { keywords: ["weight loss", "slimming plan"],   aov: 1200 },
  { keywords: ["massage", "spa day"],             aov: 180  },
];

function resolveAov(brandSlug: string, campaignName: string): number {
  const lower = campaignName.toLowerCase();
  for (const { keywords, aov } of AOV_OVERRIDES) {
    if (keywords.some(k => lower.includes(k))) return aov;
  }
  return BRAND_AOV_DEFAULT[brandSlug] ?? 300;
}

export type DrilldownCampaign = {
  campaignName:    string;
  campaignId:      string;
  spend:           number;
  cpl:             number | null;
  leads:           number;
  aov:             number;
  expectedRevenue: number;
  expectedRoas:    number | null;
  conversionPct:   number | null;
};

export type DrilldownBrand = {
  campaigns: DrilldownCampaign[];
  totals: {
    spend:           number;
    leads:           number;
    expectedRevenue: number;
    expectedRoas:    number | null;
    conversionPct:   number | null;
    avgCpl:          number | null;
  };
};

export type CampaignDrilldownResponse = {
  brands:     Record<string, DrilldownBrand>;
  date_from:  string;
  date_to:    string;
  fetched_at: string;
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

  const results = await Promise.all(BRAND_SLUGS.map(async (slug): Promise<[string, DrilldownBrand]> => {
    const brandId = brandIdMap[slug];
    if (!brandId) {
      return [slug, { campaigns: [], totals: { spend: 0, leads: 0, expectedRevenue: 0, expectedRoas: null, conversionPct: null, avgCpl: null } }];
    }

    // Meta campaigns data (all daily rows for the period)
    const { data: metaRows } = await supabase
      .from("meta_campaigns_daily")
      .select("campaign_id, campaign_name, spend, leads, attributed_revenue")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    // Aggregate per campaign_id
    type Agg = { name: string; spend: number; leads: number; revenue: number };
    const map = new Map<string, Agg>();
    for (const r of (metaRows ?? []) as { campaign_id: string; campaign_name: string; spend: number; leads: number; attributed_revenue: number }[]) {
      const existing = map.get(r.campaign_id);
      if (existing) {
        existing.spend   += r.spend   ?? 0;
        existing.leads   += r.leads   ?? 0;
        existing.revenue += r.attributed_revenue ?? 0;
      } else {
        map.set(r.campaign_id, {
          name:    r.campaign_name,
          spend:   r.spend   ?? 0,
          leads:   r.leads   ?? 0,
          revenue: r.attributed_revenue ?? 0,
        });
      }
    }

    // Brand-level booking conversion from crm_daily
    const { data: crmRows } = await supabase
      .from("crm_daily")
      .select("total_leads, appointments_booked")
      .eq("brand_id", brandId)
      .gte("date", from)
      .lte("date", to);

    const crmLeads  = (crmRows ?? []).reduce((s: number, r: { total_leads: number }) => s + (r.total_leads ?? 0), 0);
    const crmBooked = (crmRows ?? []).reduce((s: number, r: { appointments_booked: number }) => s + (r.appointments_booked ?? 0), 0);
    const conversionPct = crmLeads > 0 ? Math.round((crmBooked / crmLeads) * 1000) / 10 : null;

    // Build campaign rows
    const campaigns: DrilldownCampaign[] = [];
    for (const [campaignId, agg] of map) {
      const aov             = resolveAov(slug, agg.name);
      const convRate        = conversionPct !== null ? conversionPct / 100 : 0;
      const expectedRevenue = Math.round(agg.leads * convRate * aov * 100) / 100;
      const spend           = Math.round(agg.spend * 100) / 100;
      campaigns.push({
        campaignName:    agg.name,
        campaignId,
        spend,
        cpl:             agg.leads > 0 ? Math.round((agg.spend / agg.leads) * 100) / 100 : null,
        leads:           agg.leads,
        aov,
        expectedRevenue,
        expectedRoas:    spend > 0 ? Math.round((expectedRevenue / spend) * 100) / 100 : null,
        conversionPct,
      });
    }

    campaigns.sort((a, b) => b.spend - a.spend);

    const totalSpend   = campaigns.reduce((s, c) => s + c.spend,           0);
    const totalLeads   = campaigns.reduce((s, c) => s + c.leads,           0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.expectedRevenue, 0);

    return [slug, {
      campaigns,
      totals: {
        spend:           Math.round(totalSpend   * 100) / 100,
        leads:           totalLeads,
        expectedRevenue: Math.round(totalRevenue * 100) / 100,
        expectedRoas:    totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : null,
        conversionPct,
        avgCpl:          totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : null,
      },
    }];
  }));

  return NextResponse.json({
    brands:     Object.fromEntries(results),
    date_from:  from,
    date_to:    to,
    fetched_at: new Date().toISOString(),
  } satisfies CampaignDrilldownResponse);
}
