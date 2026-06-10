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
  // Count open opportunities in the "New Leads" stage of the Call Pipeline only.
  const pipelinesData = await ghlGet("/opportunities/pipelines", apiKey, { location_id: locationId }) as {
    pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string; position: number }> }>;
  };

  const callPipeline = (pipelinesData.pipelines ?? []).find(
    (p) => p.name.toLowerCase().includes("call pipeline"),
  );
  if (!callPipeline) return 0;

  const newLeadStage = callPipeline.stages.find(
    (s) => s.name.replace(/[^\x00-\x7F]/g, "").trim().toLowerCase().includes("new lead"),
  );
  if (!newLeadStage) return 0;

  try {
    const oppData = await ghlGet("/opportunities/search", apiKey, {
      location_id: locationId,
      status: "open",
      pipeline_stage_id: newLeadStage.id,
      limit: "1",
    }) as { meta?: { total?: number } };
    return oppData.meta?.total ?? 0;
  } catch {
    return 0;
  }
}

async function fetchTodoCount(apiKey: string, locationId: string): Promise<number> {
  try {
    // Find the "To-dos" smart list by name, then count contacts in it
    const listsData = await ghlGet("/contacts/smartList", apiKey, {
      locationId,
      limit: "100",
    }) as { smartLists?: Array<{ id: string; name: string }> };

    const todoList = (listsData.smartLists ?? []).find(
      (l) => l.name.replace(/[-\s]/g, "").toLowerCase() === "todos" ||
             l.name.toLowerCase().includes("to-do") ||
             l.name.toLowerCase() === "to do",
    );
    if (!todoList) return 0;

    const data = await ghlGet("/contacts/", apiKey, {
      locationId,
      smartListId: todoList.id,
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
