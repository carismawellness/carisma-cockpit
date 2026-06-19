/**
 * GET /api/crm/active-pipeline?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the count of UNIQUE opportunities that had any pipeline stage
 * change during the selected period, per brand.
 *
 * Data source: ghl_opportunity_stage_events.changed_at (populated by GHL
 * webhook at /api/webhooks/ghl/opportunities).
 *
 * This is the "Last Stage Change Date" metric — it matches what you see in
 * GHL when you filter opportunities by "Last Stage Change Date". Use this
 * to compare against GHL's pipeline view for a given period.
 *
 * It differs from crm_lead_reconciliation (creation-date based) because:
 * - A lead created in March who moved to "Booking Won" in June counts here
 *   but not in the creation-date leads count for June.
 * - A new lead created June 4 with no stage change yet counts in the
 *   creation-date count but not here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;

export type ActivePipelineResponse = {
  brands: Record<string, { active_opps: number }>;
  from: string;
  to: string;
  note: string;
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  const supabase = getAdminClient();

  // Brand slug → brand_id lookup
  const { data: brandRows } = await supabase.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const b of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[b.slug] = b.id;

  const brands: Record<string, { active_opps: number }> = {};

  await Promise.all(
    BRAND_SLUGS.map(async (slug) => {
      const brandId = brandIdMap[slug];
      if (!brandId) { brands[slug] = { active_opps: 0 }; return; }

      // Count DISTINCT opportunities that had a stage change in the period.
      // changed_at is stored as ISO timestamp; prefix-compare with date strings.
      const { data, error } = await supabase
        .from("ghl_opportunity_stage_events")
        .select("ghl_opportunity_id")
        .eq("brand_id", brandId)
        .gte("changed_at", `${from}T00:00:00.000Z`)
        .lte("changed_at", `${to}T23:59:59.999Z`);

      if (error) {
        console.error(`active-pipeline ${slug}:`, error.message);
        brands[slug] = { active_opps: 0 };
        return;
      }

      // Deduplicate — an opportunity may have changed stage multiple times
      const uniqueOpps = new Set((data ?? []).map((r: { ghl_opportunity_id: string }) => r.ghl_opportunity_id));
      brands[slug] = { active_opps: uniqueOpps.size };
    }),
  );

  return NextResponse.json({
    brands,
    from,
    to,
    note: "Unique opportunities with any stage movement in the period. Matches GHL filter: Last Stage Change Date.",
  } satisfies ActivePipelineResponse);
}
