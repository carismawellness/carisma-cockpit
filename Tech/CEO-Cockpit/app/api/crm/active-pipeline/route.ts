/**
 * GET /api/crm/active-pipeline?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the count of UNIQUE opportunities whose lastStageChangeAt falls
 * within the requested period, per brand — queried live from GHL API.
 *
 * Matches exactly what GHL shows when you filter Opportunities by
 * "Last Stage Change Date" for the same date range.
 *
 * Previous implementation read from ghl_opportunity_stage_events (webhook
 * table) which only captured events after the webhook was wired up, causing
 * severe undercounting (~55–65% missing vs GHL ground truth).
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic    = "force-dynamic";
export const maxDuration = 300;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRAND_CONFIG: Record<string, { apiKey: string; locationId: string }> = {
  spa:        { apiKey: process.env.GHL_API_KEY ?? "",            locationId: "TrtSnBSSKBOkVVNxJ3AM" },
  aesthetics: { apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT" },
  slimming:   { apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",   locationId: "imWIWDcnmOfijW0lltPq" },
};

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

export type ActivePipelineResponse = {
  brands: Record<string, { active_opps: number }>;
  from: string;
  to: string;
  note: string;
};

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_V, Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GHL ${path} ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

type OppRow = {
  id: string;
  lastStageChangeAt?: string;
  updatedAt?: string;
};

type OppSearchResponse = {
  opportunities?: OppRow[];
  meta?: { startAfter?: number | string; startAfterId?: string };
};

async function countActiveOpps(apiKey: string, locationId: string, fromMs: number, toMs: number): Promise<number> {
  const matchedIds = new Set<string>();
  let startAfter: string | undefined;
  let startAfterId: string | undefined;

  for (let page = 0; page < 500; page++) {
    const params: Record<string, string> = { location_id: locationId, status: "all", limit: "100" };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/opportunities/search", apiKey, params)) as OppSearchResponse;
    const opps = data.opportunities ?? [];
    if (!opps.length) break;

    for (const opp of opps) {
      const rawDate = opp.lastStageChangeAt ?? opp.updatedAt;
      if (!rawDate) continue;
      const ts = new Date(rawDate).getTime();
      if (ts >= fromMs && ts <= toMs) matchedIds.add(opp.id);
    }

    // NO early exit: GHL sorts opportunities by createdAt (not lastStageChangeAt),
    // so old opportunities created before the window can still have lastStageChangeAt
    // within the window. Must scan all pages to get an accurate count.
    const next = data.meta?.startAfter;
    if (next == null) break;
    startAfter    = String(next);
    startAfterId  = data.meta?.startAfterId;
  }

  return matchedIds.size;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from") ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs   = new Date(`${to}T23:59:59.999Z`).getTime();

  const results = await Promise.all(
    BRAND_SLUGS.map(async (slug: BrandSlug) => {
      const { apiKey, locationId } = BRAND_CONFIG[slug];
      if (!apiKey) return [slug, { active_opps: 0 }] as const;
      try {
        const count = await countActiveOpps(apiKey, locationId, fromMs, toMs);
        return [slug, { active_opps: count }] as const;
      } catch (e) {
        console.error(`active-pipeline ${slug}:`, e);
        return [slug, { active_opps: 0 }] as const;
      }
    }),
  );

  return NextResponse.json({
    brands:     Object.fromEntries(results),
    from,
    to,
    note: "Unique opportunities with lastStageChangeAt in the period. Matches GHL filter: Last Stage Change Date.",
  } satisfies ActivePipelineResponse);
}
