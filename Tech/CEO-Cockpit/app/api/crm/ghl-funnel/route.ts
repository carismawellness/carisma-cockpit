/**
 * GET /api/crm/ghl-funnel?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Returns opportunity counts per pipeline stage per brand, scoped to the
 * date range. Counts opportunities CREATED in [dateFrom, dateTo], grouped
 * by their current stage. This is a cohort funnel: "Of leads acquired in
 * this period, here's their current state."
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRAND_CONFIG: Record<string, { apiKey: string; locationId: string; pipelineId: string }> = {
  spa:        { apiKey: process.env.GHL_API_KEY ?? "",           locationId: "TrtSnBSSKBOkVVNxJ3AM", pipelineId: "4vgVsqiN12VGdloyzyxD" },
  aesthetics: { apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT", pipelineId: "PaSsbcOAeRURF2Hc2V3F" },
  slimming:   { apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",   locationId: "imWIWDcnmOfijW0lltPq", pipelineId: "N3usvWAkWpUppJj1ggtM" },
};

export const STAGE_ORDER = [
  "New Leads",
  "Call Back",
  "Contacted",
  "Booking Won",
  "Active Member",
  "Booking Lost",
  "No Show",
  "Nurturing",
];

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_V,
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

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

interface StageInfo {
  stageId: string;
  stageName: string;
  normalizedName: string;
}

async function fetchStages(apiKey: string, locationId: string, pipelineId: string): Promise<StageInfo[]> {
  const data = await ghlGet("/opportunities/pipelines", apiKey, { locationId }) as {
    pipelines?: Array<{
      id: string;
      name: string;
      stages: Array<{ id: string; name: string; position: number }>;
    }>;
  };

  // Match by hardcoded pipeline ID first; fall back to name search
  const callPipeline =
    (data.pipelines ?? []).find((p) => p.id === pipelineId) ??
    (data.pipelines ?? []).find((p) => p.name.toLowerCase().includes("call pipeline"));
  if (!callPipeline) return [];

  return callPipeline.stages.map((stage) => ({
    stageId: stage.id,
    stageName: stage.name,
    normalizedName: matchStage(stage.name),
  }));
}

async function fetchStageCount(
  apiKey: string,
  locationId: string,
  stageId: string,
  pipelineId: string,
  startAfterMs: number,
  startBeforeMs: number,
): Promise<number> {
  try {
    const data = await ghlGet("/opportunities/search", apiKey, {
      location_id: locationId,
      pipeline_id: pipelineId,
      pipeline_stage_id: stageId,
      startAfter: String(startAfterMs),
      startBefore: String(startBeforeMs),
      limit: "1",
    }) as { meta?: { total?: number } };
    return data.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

// Diagnostic: try multiple date filter formats to find which one GHL accepts
async function diagnoseFilters(
  apiKey: string,
  locationId: string,
  stageId: string,
  pipelineId: string,
  dateFromIso: string,
  _dateToIso: string,
  _startAfterMs: number,
  _startBeforeMs: number,
): Promise<Record<string, number | string>> {
  const base = {
    location_id: locationId,
    pipeline_id: pipelineId,
    pipeline_stage_id: stageId,
    limit: "1",
  };
  const variants: Record<string, Record<string, string>> = {
    "noDate": base,
  };
  const out: Record<string, number | string> = {};
  for (const [name, params] of Object.entries(variants)) {
    try {
      const r = await ghlGet("/opportunities/search", apiKey, params) as { meta?: { total?: number } };
      out[name] = r.meta?.total ?? 0;
    } catch (e) {
      out[name] = e instanceof Error ? e.message.slice(0, 400) : "err";
    }
  }

  // Try POST advanced search — locationId camelCase + filters array
  const postBodies: Record<string, Record<string, unknown>> = {
    "POST_filters_pipeline_only": {
      locationId,
      filters: [
        { field: "pipeline_id", operator: "eq", value: pipelineId },
        { field: "pipeline_stage_id", operator: "eq", value: stageId },
      ],
      limit: 1,
    },
    "POST_filters_dateAdded_gte_lte": {
      locationId,
      filters: [
        { field: "pipeline_id", operator: "eq", value: pipelineId },
        { field: "pipeline_stage_id", operator: "eq", value: stageId },
        { field: "dateAdded", operator: "gte", value: dateFromIso },
        { field: "dateAdded", operator: "lte", value: dateFromIso },
      ],
      limit: 1,
    },
    "POST_filters_just_eq_op_check": {
      locationId,
      filters: [
        { field: "pipeline_stage_id", operator: "eq", value: stageId },
        { field: "dateAdded", operator: "between", value: [dateFromIso, dateFromIso] },
      ],
      limit: 1,
    },
  };
  for (const [name, body] of Object.entries(postBodies)) {
    try {
      const resp = await fetch(`${GHL_BASE}/opportunities/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_V,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const txt = await resp.text();
      if (!resp.ok) {
        out[name] = `${resp.status}: ${txt.slice(0, 800)}`;
      } else {
        const j = JSON.parse(txt);
        out[name] = j.meta?.total ?? 0;
      }
    } catch (e) {
      out[name] = e instanceof Error ? e.message.slice(0, 150) : "err";
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const dateTo   = searchParams.get("dateTo")   ?? new Date().toISOString().split("T")[0];
  const debug    = searchParams.get("debug") === "1";

  const startAfter  = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
  const startBefore = new Date(`${dateTo}T23:59:59.999Z`).getTime();

  if (debug) {
    // Diagnostic: probe filter variants on Aesthetics "Booking Won" stage
    // (large volume, easy to verify which filter returns matches)
    const aes = BRAND_CONFIG.aesthetics;
    if (!aes.apiKey) {
      return NextResponse.json({ error: "no aesthetics API key" });
    }
    const stages = await fetchStages(aes.apiKey, aes.locationId, aes.pipelineId);
    const won = stages.find((s) => s.normalizedName === "Booking Won");
    if (!won) return NextResponse.json({ error: "no won stage found", stages });
    const variants = await diagnoseFilters(
      aes.apiKey, aes.locationId, won.stageId, aes.pipelineId,
      dateFrom, dateTo, startAfter, startBefore,
    );
    return NextResponse.json({ dateFrom, dateTo, stage: "Booking Won (Aesthetics)", variants });
  }

  const result: Record<string, Record<string, number>> = {
    spa:        {},
    aesthetics: {},
    slimming:   {},
  };

  await Promise.all(
    Object.entries(BRAND_CONFIG).map(async ([slug, { apiKey, locationId, pipelineId }]) => {
      if (!apiKey) return;
      try {
        const stages = await fetchStages(apiKey, locationId, pipelineId);

        // Dedup: if multiple stages map to the same normalizedName, sum them
        const countsByNorm: Record<string, number> = {};
        await Promise.all(
          stages.map(async ({ stageId, normalizedName }) => {
            const count = await fetchStageCount(
              apiKey, locationId, stageId, pipelineId, startAfter, startBefore,
            );
            countsByNorm[normalizedName] = (countsByNorm[normalizedName] ?? 0) + count;
          }),
        );
        result[slug] = countsByNorm;
      } catch {
        // leave empty on error
      }
    }),
  );

  return NextResponse.json({ dateFrom, dateTo, brands: result });
}
