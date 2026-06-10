/**
 * GET /api/crm/ghl-funnel?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Returns opportunity counts per pipeline stage per brand.
 * Counts leads created in the given date range, grouped by current stage.
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
): Promise<number> {
  try {
    const data = await ghlGet("/opportunities/search", apiKey, {
      location_id: locationId,
      pipeline_id: pipelineId,
      pipeline_stage_id: stageId,
      limit: "1",
    }) as { meta?: { total?: number } };
    return data.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") ?? new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const dateTo   = searchParams.get("dateTo")   ?? new Date().toISOString().split("T")[0];

  const result: Record<string, Record<string, number>> = {
    spa:        {},
    aesthetics: {},
    slimming:   {},
  };
  const debug: Record<string, { hasKey: boolean; stages: number; err?: string }> = {};

  await Promise.all(
    Object.entries(BRAND_CONFIG).map(async ([slug, { apiKey, locationId, pipelineId }]) => {
      debug[slug] = { hasKey: !!apiKey, stages: 0 };
      if (!apiKey) return;
      try {
        const stages = await fetchStages(apiKey, locationId, pipelineId);
        debug[slug].stages = stages.length;

        // Dedup: if multiple stages map to the same normalizedName, sum them
        const countsByNorm: Record<string, number> = {};
        await Promise.all(
          stages.map(async ({ stageId, normalizedName }) => {
            const count = await fetchStageCount(apiKey, locationId, stageId, pipelineId);
            countsByNorm[normalizedName] = (countsByNorm[normalizedName] ?? 0) + count;
          }),
        );
        result[slug] = countsByNorm;
      } catch (e) {
        debug[slug].err = e instanceof Error ? e.message : String(e);
      }
    }),
  );

  return NextResponse.json({ dateFrom, dateTo, brands: result, debug });
}
