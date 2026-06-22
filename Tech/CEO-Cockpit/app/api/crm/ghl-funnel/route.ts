/**
 * GET /api/crm/ghl-funnel?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&mode=cohort|flow&source=all|meta
 *
 * mode=cohort (default): leads whose date_added falls in the period, grouped by
 *   their CURRENT stage. "Of leads acquired in this window, where are they now?"
 *
 * mode=flow: stage transitions (changed_at) that occurred in the period.
 *   "How many opportunities entered each stage in this window?"
 *
 * source=meta: filter to Meta (Facebook/Instagram) leads only, based on the
 *   GHL opportunity's source field stored in the raw JSONB column.
 *   Works for both backfill records (raw->>'source') and webhook records
 *   (raw->'opportunity'->>'source').
 *
 * Falls back to the GHL snapshot API if the Supabase mirror tables are empty,
 * so the widget stays functional during migration.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { migrationExclusionDates } from "@/lib/funnel/lead-conversion";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ── GHL snapshot fallback (used when mirror tables are empty) ───────────────

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRAND_CONFIG: Record<string, { apiKey: string; locationId: string; pipelineId: string }> = {
  spa:        { apiKey: process.env.GHL_API_KEY ?? "",            locationId: "TrtSnBSSKBOkVVNxJ3AM", pipelineId: "4vgVsqiN12VGdloyzyxD" },
  aesthetics: { apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT", pipelineId: "PaSsbcOAeRURF2Hc2V3F" },
  slimming:   { apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",   locationId: "imWIWDcnmOfijW0lltPq", pipelineId: "N3usvWAkWpUppJj1ggtM" },
};

export const STAGE_ORDER = [
  "New Leads", "Call Back", "Contacted", "Booking Won", "Active Member",
  "Booking Lost", "No Show", "Nurturing",
];

function stripEmoji(name: string): string {
  return name.replace(/[^\x00-\x7F]/g, "").trim();
}

function matchStage(name: string): string {
  const clean = stripEmoji(name);
  const lower = clean.toLowerCase();
  for (const s of STAGE_ORDER) {
    if (s.toLowerCase() === lower) return s;
  }
  for (const s of STAGE_ORDER) {
    if (lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower)) return s;
  }
  return clean;
}

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_V, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function fetchGhlSnapshot(): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = { spa: {}, aesthetics: {}, slimming: {} };
  await Promise.all(
    Object.entries(BRAND_CONFIG).map(async ([slug, { apiKey, locationId, pipelineId }]) => {
      if (!apiKey) return;
      try {
        const pipelinesData = await ghlGet("/opportunities/pipelines", apiKey, { locationId }) as {
          pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
        };
        const pipeline =
          (pipelinesData.pipelines ?? []).find((p) => p.id === pipelineId) ??
          (pipelinesData.pipelines ?? []).find((p) => p.name.toLowerCase().includes("call pipeline"));
        if (!pipeline) return;

        const countsByNorm: Record<string, number> = {};
        await Promise.all(
          pipeline.stages.map(async (stage) => {
            const norm = matchStage(stage.name);
            try {
              const data = await ghlGet("/opportunities/search", apiKey, {
                location_id: locationId, pipeline_id: pipelineId,
                pipeline_stage_id: stage.id, limit: "1",
              }) as { meta?: { total?: number } };
              countsByNorm[norm] = (countsByNorm[norm] ?? 0) + (data.meta?.total ?? 0);
            } catch { /* leave 0 */ }
          }),
        );
        result[slug] = countsByNorm;
      } catch { /* leave empty */ }
    }),
  );
  return result;
}

// ── Supabase mirror queries ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

// Meta source values in GHL: Facebook Lead Ads, Instagram, Meta campaigns.
// We check both the backfill path (raw->>'source') and the webhook path
// (raw->'opportunity'->>'source') because the two ingestion paths store raw
// differently — backfill stores the opportunity object at root, webhooks nest it.
const META_SOURCE_FILTER =
  "raw->>source.ilike.%facebook%," +
  "raw->>source.ilike.%instagram%," +
  "raw->>source.ilike.%meta%," +
  "raw->opportunity->>source.ilike.%facebook%," +
  "raw->opportunity->>source.ilike.%instagram%," +
  "raw->opportunity->>source.ilike.%meta%";

async function queryCohort(
  sb: SbClient,
  brandSlug: string,
  brandId: number,
  dateFrom: string,
  dateTo: string,
  sourceFilter?: string,
): Promise<Record<string, number>> {
  // Opportunities whose date_added is within the window, by current stage
  let query = sb
    .from("ghl_opportunities")
    .select("stage_normalized, date_added")
    .eq("brand_id", brandId)
    .neq("status", "deleted")
    .gte("date_added", dateFrom)
    .lte("date_added", dateTo + "T23:59:59Z");

  if (sourceFilter === "meta") {
    query = query.or(META_SOURCE_FILTER);
  }

  const { data, error } = await query;

  if (error) throw new Error(`cohort ${brandSlug}: ${error.message}`);

  const exclusionDates = migrationExclusionDates(brandId, dateFrom, dateTo);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { stage_normalized: string; date_added: string }[]) {
    if (exclusionDates.size > 0 && exclusionDates.has(row.date_added.slice(0, 10))) continue;
    counts[row.stage_normalized] = (counts[row.stage_normalized] ?? 0) + 1;
  }
  return counts;
}

async function queryFlow(
  sb: SbClient,
  brandSlug: string,
  brandId: number,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, number>> {
  // Stage transitions that occurred within the window
  const { data, error } = await sb
    .from("ghl_opportunity_stage_events")
    .select("to_stage_normalized")
    .eq("brand_id", brandId)
    .gte("changed_at", dateFrom)
    .lte("changed_at", dateTo + "T23:59:59Z");

  if (error) throw new Error(`flow ${brandSlug}: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { to_stage_normalized: string }[]) {
    counts[row.to_stage_normalized] = (counts[row.to_stage_normalized] ?? 0) + 1;
  }
  return counts;
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom     = searchParams.get("dateFrom") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const dateTo       = searchParams.get("dateTo")   ?? new Date().toISOString().split("T")[0];
  const rawMode      = (searchParams.get("mode") ?? "cohort") as "cohort" | "flow";
  const sourceFilter = searchParams.get("source") ?? "all"; // "all" | "meta"

  // Flow mode cannot be source-filtered (stage_events table has no source column).
  // When Meta filter is active, lock to cohort.
  const mode = sourceFilter === "meta" ? "cohort" : rawMode;

  const sb: SbClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Check if mirror tables are populated
  const { count: mirrorCount } = await sb
    .from("ghl_opportunities")
    .select("ghl_opportunity_id", { count: "exact", head: true });

  // If no data in mirror, fall back to GHL snapshot (source filter not available in snapshot)
  if (!mirrorCount || mirrorCount === 0) {
    const brands = await fetchGhlSnapshot();
    return NextResponse.json({
      dateFrom, dateTo, mode: "snapshot",
      subtitle: "Current snapshot · Call Pipeline · from GHL CRM (backfill pending)",
      sourceFilter: "all",
      brands,
    });
  }

  // Load brand ID map
  const { data: brandRows } = await sb.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[r.slug] = r.id;

  const result: Record<string, Record<string, number>> = { spa: {}, aesthetics: {}, slimming: {} };

  await Promise.all(
    Object.keys(result).map(async (slug) => {
      const brandId = brandIdMap[slug];
      if (!brandId) return;
      try {
        result[slug] = mode === "flow"
          ? await queryFlow(sb, slug, brandId, dateFrom, dateTo)
          : await queryCohort(sb, slug, brandId, dateFrom, dateTo, sourceFilter === "meta" ? "meta" : undefined);
      } catch (e) {
        console.error(`ghl-funnel ${slug}:`, (e as Error).message);
      }
    }),
  );

  const sourceLabel = sourceFilter === "meta" ? " · Meta leads only" : "";
  const subtitle = mode === "flow"
    ? `Stage transitions in selected period · Call Pipeline${sourceLabel}`
    : `Leads acquired in selected period · by current stage${sourceLabel}`;

  return NextResponse.json({ dateFrom, dateTo, mode, subtitle, sourceFilter, brands: result });
}
