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

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;

// Default AOV per brand (€) — sourced from carismaspa.com, carismaaesthetics.com, carismaslimming.com (Jun 2026)
const BRAND_AOV_DEFAULT: Record<string, number> = {
  spa: 129,  // Spa Deluxe / mid-tier spa day package
  aesthetics: 179,  // 1–2 area botox; most common aesthetic treatment
  slimming: 199,  // Standardised entry package (Fat Freeze / EMSculpt Starter)
};

// Keyword → AOV overrides (checked against lowercased campaign name)
const AOV_OVERRIDES: Array<{ keywords: string[]; aov: number }> = [
  // Spa
  { keywords: ["couple", "couples", "romantic"], aov: 249 },
  { keywords: ["hammam"], aov: 129 },
  { keywords: ["spa day", "body ritual", "body treatment", "ritual"], aov: 129 },
  { keywords: ["massage"], aov: 99 },
  // Aesthetics
  { keywords: ["filler", "lip filler", "dermal filler"], aov: 269 },
  { keywords: ["botox", "wrinkle", "anti-wrinkle", "injectable"], aov: 179 },
  { keywords: ["facial", "hydrafacial", "peel", "skin", "microneedling"], aov: 149 },
  { keywords: ["laser", "ipl", "hair removal"], aov: 199 },
  // Slimming
  { keywords: ["fat freeze", "coolsculpt", "cryolipolysis"], aov: 199 },
  { keywords: ["emsculpt", "hifu", "body sculpt", "velashape", "cavitation"], aov: 199 },
  { keywords: ["weight loss", "slimming plan", "glp", "ozempic", "mounjaro"], aov: 350 },
];

// Fallback SDR agents per brand if crm_agent_mapping table is empty
const FALLBACK_BRAND_AGENTS: Record<string, string[]> = {
  spa:        ["juliana", "vj"],
  aesthetics: ["april"],
  slimming:   ["dorianne", "queenee"],
};

// Planning conversion rate per brand — kept in sync with constraint-heatmap.
// Triangulated 2026-06-10 by a 9-agent analysis (data scientist + Meta
// advertiser + BCG consultant per brand). Revisit quarterly.
const BRAND_PLANNING_CONVERSION: Record<string, number> = {
  spa:        5.0,
  aesthetics: 15.0,
  slimming:   12.0,
};


function resolveAov(brandSlug: string, campaignName: string): number {
  const lower = campaignName.toLowerCase();
  for (const { keywords, aov } of AOV_OVERRIDES) {
    if (keywords.some(k => lower.includes(k))) return aov;
  }
  return BRAND_AOV_DEFAULT[brandSlug] ?? 300;
}

export type DrilldownCampaign = {
  campaignName: string;
  campaignId: string;
  spend: number;
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

    // Conversion rate: brand-level planning rate. Matches heatmap Booking
    // Efficiency. The live ratio is too noisy day-to-day for ROAS modelling.
    const conversionPct: number | null = BRAND_PLANNING_CONVERSION[slug] ?? null;

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
