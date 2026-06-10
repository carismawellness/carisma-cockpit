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

// Default AOV per brand (€) — Jun 2026 actuals
const BRAND_AOV_DEFAULT: Record<string, number> = {
  spa:        145,  // Spa Day package (most common)
  aesthetics: 179,  // Botox / general aesthetics
  slimming:   289,  // Clinic-wide AOV
};

// Keyword → AOV overrides (checked against lowercased campaign name, first match wins)
const AOV_OVERRIDES: Array<{ keywords: string[]; aov: number }> = [
  // Spa — specific campaign types
  { keywords: ["couple", "couples", "romantic"],                              aov: 190 },
  { keywords: ["gift", "gifting", "voucher"],                                 aov: 120 },
  { keywords: ["spa day"],                                                     aov: 145 },
  { keywords: ["massage"],                                                     aov: 145 },
  { keywords: ["hammam"],                                                      aov: 129 },
  { keywords: ["model call", "model"],                                         aov:   0 },
  // Aesthetics — specific treatment campaigns
  { keywords: ["hair regrowth"],                                               aov: 500 },
  { keywords: ["ultimate facelift", "ultimate face lift", "facelift"],        aov: 250 },
  { keywords: ["lhr", "laser hair"],                                           aov: 250 },
  { keywords: ["lip and glow", "lip glow"],                                    aov: 220 },
  { keywords: ["jawline", "snatch"],                                           aov: 179 },
  { keywords: ["dr. kendra", "dr kendra", "kendra"],                          aov: 200 },
  { keywords: ["hydra facial", "hydrafacial", "4-in-1", "4 in 1"],           aov: 100 },
  { keywords: ["filler", "lip filler", "dermal filler"],                     aov: 269 },
  { keywords: ["botox", "wrinkle", "anti-wrinkle", "injectable"],            aov: 179 },
  { keywords: ["peel", "skin", "microneedling"],                              aov: 149 },
  { keywords: ["ipl"],                                                         aov: 199 },
  // Slimming — specific treatments
  { keywords: ["weight loss", "slimming plan", "glp", "ozempic", "mounjaro",
               "menopause", "baby", "pain"],                                   aov: 289 },
  { keywords: ["fat freeze", "coolsculpt", "cryolipolysis"],                 aov: 289 },
  { keywords: ["emsculpt", "muscle", "hifu", "body sculpt",
               "velashape", "cavitation"],                                     aov: 289 },
];

// CRM agents responsible for each brand (slugs in crm_agent_daily)
const BRAND_AGENTS: Record<string, string[]> = {
  spa:        ["juliana", "vj"],
  aesthetics: ["april"],
  slimming:   ["dorianne", "queenee"],
};

// Manual conversion rate overrides — takes precedence over dynamic crm_agent_daily calculation
const BRAND_CONV_OVERRIDE: Partial<Record<string, number>> = {
  spa: 10.0,  // Business assumption: conservative 10% (agent-derived ~16.6% deemed too high)
};

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

    // Conversion rate: use manual override if set, otherwise compute from crm_agent_daily
    let conversionPct: number | null = BRAND_CONV_OVERRIDE[slug] ?? null;
    if (conversionPct === undefined || conversionPct === null) {
      const agents = BRAND_AGENTS[slug] ?? [];
      if (agents.length > 0) {
        const { data: agentRows } = await supabase
          .from("crm_agent_daily")
          .select("total_booked, total_messages")
          .in("agent_slug", agents)
          .gte("date", from)
          .lte("date", to);
        const totalBooked   = (agentRows ?? []).reduce((s: number, r: { total_booked: number }) => s + (r.total_booked ?? 0), 0);
        const totalMessages = (agentRows ?? []).reduce((s: number, r: { total_messages: number }) => s + (r.total_messages ?? 0), 0);
        conversionPct = totalMessages > 0 ? Math.round((totalBooked / totalMessages) * 1000) / 10 : null;
      }
    }

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
