/**
 * GET /api/crm/speed-to-lead?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&brand=spa
 *
 * Aggregates the crm_speed_to_lead fact table (one row per opportunity) into
 * per-brand and per-agent speed-to-lead summaries + SLA bucket distributions,
 * scoped to leads CREATED in [dateFrom, dateTo].
 *
 * Metric = business-hours minutes (Mon–Sat 09:00–19:00 Malta) from lead
 * creation to first move out of "New Leads". See the design doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { median, mean, STL_BUCKETS, type StlBucket } from "@/lib/utils/business-hours";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

type FactRow = {
  brand_id: number;
  agent_name: string | null;
  business_minutes: number | null;
  bucket: StlBucket;
  source: "exact" | "approx_backfill";
  responded: boolean;
};

type Summary = {
  total: number;
  responded: number;
  pending: number;
  approx: number;
  median_min: number;
  mean_min: number;
  within_sla_pct: number; // % of responded leads answered in <5 business-min
  buckets: Record<StlBucket, number>;
};

function summarize(rows: FactRow[]): Summary {
  const buckets: Record<StlBucket, number> = { "<5": 0, "5-30": 0, "30-60": 0, "60-240": 0, ">240": 0, pending: 0 };
  const respondedMins: number[] = [];
  let pending = 0;
  let approx = 0;
  for (const r of rows) {
    buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
    if (r.source === "approx_backfill") approx++;
    if (r.responded && r.business_minutes !== null) respondedMins.push(r.business_minutes);
    else pending++;
  }
  const within = respondedMins.filter((m) => m < 5).length;
  return {
    total: rows.length,
    responded: respondedMins.length,
    pending,
    approx,
    median_min: Math.round(median(respondedMins) * 100) / 100,
    mean_min: Math.round(mean(respondedMins) * 100) / 100,
    within_sla_pct: respondedMins.length ? Math.round((within / respondedMins.length) * 1000) / 10 : 0,
    buckets,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get("dateTo") ?? new Date().toISOString().slice(0, 10);
  const brandParam = searchParams.get("brand"); // optional slug

  const sb: SbClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // brand id ↔ slug
  const { data: brandRows } = await sb.from("brands").select("id, slug");
  const idToSlug: Record<number, string> = {};
  const slugToId: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) { idToSlug[r.id] = r.slug; slugToId[r.slug] = r.id; }

  // Pull fact rows for leads created in the window (paged).
  const all: FactRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    let q = sb
      .from("crm_speed_to_lead")
      .select("brand_id, agent_name, business_minutes, bucket, source, responded")
      .gte("lead_created_at", dateFrom)
      .lte("lead_created_at", dateTo + "T23:59:59Z")
      .order("lead_created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (brandParam && slugToId[brandParam]) q = q.eq("brand_id", slugToId[brandParam]);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as FactRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // ── Per-brand summaries ──
  const brands: Record<string, Summary> = {};
  for (const slug of ["spa", "aesthetics", "slimming"]) {
    if (brandParam && brandParam !== slug) continue;
    const bid = slugToId[slug];
    brands[slug] = summarize(all.filter((r) => r.brand_id === bid));
  }

  // ── Per-agent summaries (across the selected brand scope) ──
  const byAgent = new Map<string, FactRow[]>();
  for (const r of all) {
    const key = r.agent_name && r.agent_name.trim() ? r.agent_name.trim() : "Unassigned";
    const arr = byAgent.get(key);
    if (arr) arr.push(r);
    else byAgent.set(key, [r]);
  }
  const agents = Array.from(byAgent.entries())
    .map(([agent_name, rows]) => ({ agent_name, ...summarize(rows) }))
    // surface the worst responders first, but keep "Unassigned" out of the top spot only by count tie-break
    .sort((a, b) => b.median_min - a.median_min || b.total - a.total);

  return NextResponse.json({
    dateFrom,
    dateTo,
    bucketOrder: STL_BUCKETS,
    brands,
    agents,
  });
}
