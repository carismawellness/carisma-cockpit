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

const BRAND_CONFIG: Record<string, { apiKey: string; locationId: string }> = {
  spa:        { apiKey: process.env.GHL_API_KEY ?? "",           locationId: "TrtSnBSSKBOkVVNxJ3AM" },
  aesthetics: { apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT" },
  slimming:   { apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",   locationId: "imWIWDcnmOfijW0lltPq" },
};

export const STAGE_ORDER = [
  "New Lead",
  "Contacted",
  "Attempted Contact",
  "Follow Up",
  "Call back",
  "Consultation Booked",
  "Booking Won",
  "Booking Lost",
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

function matchStage(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const s of STAGE_ORDER) {
    if (s.toLowerCase() === lower) return s;
  }
  // Partial match fallback
  for (const s of STAGE_ORDER) {
    if (lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower)) return s;
  }
  return name;
}

interface StageInfo {
  stageId: string;
  stageName: string;
  normalizedName: string;
}

async function fetchStages(apiKey: string, locationId: string): Promise<StageInfo[]> {
  const data = await ghlGet("/opportunities/pipelines", apiKey, { locationId }) as {
    pipelines?: Array<{
      id: string;
      stages: Array<{ id: string; name: string; position: number }>;
    }>;
  };

  const stages: StageInfo[] = [];
  for (const pipeline of data.pipelines ?? []) {
    for (const stage of pipeline.stages ?? []) {
      stages.push({
        stageId: stage.id,
        stageName: stage.name,
        normalizedName: matchStage(stage.name),
      });
    }
  }
  return stages;
}

async function fetchStageCount(
  apiKey: string,
  locationId: string,
  stageId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  try {
    const data = await ghlGet("/opportunities/search", apiKey, {
      location_id: locationId,
      pipelineStageId: stageId,
      startDate: dateFrom,
      endDate: dateTo,
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

  await Promise.all(
    Object.entries(BRAND_CONFIG).map(async ([slug, { apiKey, locationId }]) => {
      if (!apiKey) return;
      try {
        const stages = await fetchStages(apiKey, locationId);

        // Dedup: if multiple stages map to the same normalizedName, sum them
        const countsByNorm: Record<string, number> = {};
        await Promise.all(
          stages.map(async ({ stageId, normalizedName }) => {
            const count = await fetchStageCount(apiKey, locationId, stageId, dateFrom, dateTo);
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
