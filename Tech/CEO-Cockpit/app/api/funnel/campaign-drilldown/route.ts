/**
 * GET /api/funnel/campaign-drilldown?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns per-campaign Meta metrics (spend, leads, CPL, expected revenue, ROAS)
 * grouped by brand. Booking conversion is the weighted outbound rate for the
 * brand's CRM agents, computed live from crm_agent_daily for the requested window.
 *
 * Agent → brand: Spa = juliana + vj | Aesthetics = april | Slimming = dorianne + queenee
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeLeadConversion } from "@/lib/funnel/lead-conversion";
import { resolveAov, BRAND_AOV_DEFAULT, AOV_OVERRIDES } from "@/lib/funnel/aov";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;

// Re-exported from shared lib for backwards compat — all callers should use @/lib/funnel/aov
export { BRAND_AOV_DEFAULT, AOV_OVERRIDES, resolveAov };

// Fallback SDR agents per brand if crm_agent_mapping table is empty
const FALLBACK_BRAND_AGENTS: Record<string, string[]> = {
  spa:        ["juliana", "vj"],
  aesthetics: ["april"],
  slimming:   ["dorianne", "queenee"],
};

export type DrilldownCampaign = {
  campaignName: string;
  campaignId: string;
  spend: number;
  dailySpend: number;
  cpl: number | null;
  leads: number;
  aov: number;
  expectedRevenue: number;
  expectedRoas: number | null;
  conversionPct: number | null;
};

export type DrilldownBrand = {
  campaigns: DrilldownCampaign[];
  totals: {
    spend: number;
    dailySpend: number;
    leads: number;
    expectedRevenue: number;
    expectedRoas: number | null;
    conversionPct: number | null;
    avgCpl: number | null;
  };
};

export type CampaignDrilldownResponse = {
  brands: Record<string, DrilldownBrand>;
  date_from: string;
  date_to: string;
  fetched_at: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  // Inclusive day count between `from` and `to` for daily-spend averaging.
  const dayCount = Math.max(1, Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1,
  ));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Agent mapping from DB — determines which SDR agents belong to each brand
  const { data: agentMapRows } = await supabase
    .from("crm_agent_mapping")
    .select("agent_slug, brand_slug")
    .eq("is_active", true)
    .eq("position", "sdr");

  const brandAgents: Record<string, string[]> = { spa: [], aesthetics: [], slimming: [] };
  if (agentMapRows && agentMapRows.length > 0) {
    for (const r of agentMapRows as { agent_slug: string; brand_slug: string | null }[]) {
      if (r.brand_slug && r.brand_slug in brandAgents) brandAgents[r.brand_slug].push(r.agent_slug);
    }
    for (const s of BRAND_SLUGS) {
      if (brandAgents[s].length === 0) brandAgents[s] = FALLBACK_BRAND_AGENTS[s];
    }
  } else {
    Object.assign(brandAgents, FALLBACK_BRAND_AGENTS);
  }

  // Brand ID lookup
  const { data: brandRows } = await supabase.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const b of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[b.slug] = b.id;

  const results = await Promise.all(BRAND_SLUGS.map(async (slug): Promise<[string, DrilldownBrand]> => {
    const brandId = brandIdMap[slug];
    if (!brandId) {
      return [slug, { campaigns: [], totals: { spend: 0, dailySpend: 0, leads: 0, expectedRevenue: 0, expectedRoas: null, conversionPct: null, avgCpl: null } }];
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
        existing.spend += r.spend ?? 0;
        existing.leads += r.leads ?? 0;
        existing.revenue += r.attributed_revenue ?? 0;
      } else {
        map.set(r.campaign_id, {
          name: r.campaign_name,
          spend: r.spend ?? 0,
          leads: r.leads ?? 0,
          revenue: r.attributed_revenue ?? 0,
        });
      }
    }

    // Conversion rate: brand-level GHL Lead Conv (Booking Won ÷ all leads
    // acquired in the period). Same calc used on the Pipeline Funnel widget
    // and the funnel heatmap's Booking Efficiency row.
    const leadConv = await computeLeadConversion(supabase, brandId, from, to);
    const conversionPct: number | null = leadConv.ratePct;

    // Build campaign rows
    const campaigns: DrilldownCampaign[] = [];
    for (const [campaignId, agg] of map) {
      const aov = resolveAov(slug, agg.name);
      const convRate = conversionPct !== null ? conversionPct / 100 : 0;
      const expectedRevenue = Math.round(agg.leads * convRate * aov * 100) / 100;
      const spend = Math.round(agg.spend * 100) / 100;
      campaigns.push({
        campaignName: agg.name,
        campaignId,
        spend,
        dailySpend: Math.round((spend / dayCount) * 100) / 100,
        cpl: agg.leads > 0 ? Math.round((agg.spend / agg.leads) * 100) / 100 : null,
        leads: agg.leads,
        aov,
        expectedRevenue,
        expectedRoas: spend > 0 ? Math.round((expectedRevenue / spend) * 100) / 100 : null,
        conversionPct,
      });
    }

    campaigns.sort((a, b) => b.spend - a.spend);

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.expectedRevenue, 0);

    return [slug, {
      campaigns,
      totals: {
        spend: Math.round(totalSpend * 100) / 100,
        dailySpend: Math.round((totalSpend / dayCount) * 100) / 100,
        leads: totalLeads,
        expectedRevenue: Math.round(totalRevenue * 100) / 100,
        expectedRoas: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : null,
        conversionPct,
        avgCpl: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : null,
      },
    }];
  }));

  return NextResponse.json({
    brands: Object.fromEntries(results),
    date_from: from,
    date_to: to,
    fetched_at: new Date().toISOString(),
  } satisfies CampaignDrilldownResponse);
}
