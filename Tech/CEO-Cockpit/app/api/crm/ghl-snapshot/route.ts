/**
 * GET /api/crm/ghl-snapshot
 *
 * Returns live GHL counts for all 3 brands:
 *   - newLeads:  total open opportunities in the first (new-lead) stage of each pipeline
 *   - todoCount: contacts tagged "to-do"
 *
 * These are real-time snapshots — not stored in Supabase.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRAND_CONFIG: Record<string, { apiKey: string; locationId: string }> = {
  spa:        { apiKey: process.env.GHL_API_KEY ?? "",            locationId: "TrtSnBSSKBOkVVNxJ3AM" },
  aesthetics: { apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "",  locationId: "Goi7kzVK7iwe2woxUHkT" },
  slimming:   { apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",    locationId: "imWIWDcnmOfijW0lltPq"  },
};

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
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}`);
  return resp.json();
}

async function fetchNewLeads(apiKey: string, locationId: string): Promise<number> {
  // Fetch all pipelines, collect the lowest-position stage from each,
  // then count open opportunities in those stages.
  const pipelinesData = await ghlGet("/opportunities/pipelines", apiKey, { locationId }) as {
    pipelines?: Array<{ id: string; stages: Array<{ id: string; name: string; position: number }> }>;
  };

  const pipelines = pipelinesData.pipelines ?? [];
  if (pipelines.length === 0) return 0;

  let total = 0;
  for (const pipeline of pipelines) {
    if (!pipeline.stages?.length) continue;
    const sorted = [...pipeline.stages].sort((a, b) => a.position - b.position);
    const firstStageId = sorted[0].id;

    try {
      const oppData = await ghlGet("/opportunities/search", apiKey, {
        location_id: locationId,
        status: "open",
        pipelineStageId: firstStageId,
        limit: "1",
      }) as { meta?: { total?: number } };
      total += oppData.meta?.total ?? 0;
    } catch {
      // stage query failed — skip
    }
  }
  return total;
}

async function fetchTodoCount(apiKey: string, locationId: string): Promise<number> {
  try {
    const data = await ghlGet("/contacts/", apiKey, {
      locationId,
      tags: "to-do",
      limit: "1",
    }) as { meta?: { total?: number } };
    return data.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

export async function GET() {
  const result: Record<string, { newLeads: number; todoCount: number }> = {
    spa:        { newLeads: 0, todoCount: 0 },
    aesthetics: { newLeads: 0, todoCount: 0 },
    slimming:   { newLeads: 0, todoCount: 0 },
  };

  await Promise.all(
    Object.entries(BRAND_CONFIG).map(async ([slug, { apiKey, locationId }]) => {
      if (!apiKey) return;
      try {
        const [newLeads, todoCount] = await Promise.all([
          fetchNewLeads(apiKey, locationId),
          fetchTodoCount(apiKey, locationId),
        ]);
        result[slug] = { newLeads, todoCount };
      } catch {
        // leave defaults of 0 on error
      }
    })
  );

  return NextResponse.json(result);
}
