/**
 * GET /api/cron/ghl-opportunities-reconcile
 *
 * Nightly safety net: paginates the last 7 days of GHL opportunities
 * for each brand and upserts into ghl_opportunities. Catches any
 * webhooks that were dropped or arrived out-of-order.
 *
 * Triggered by Vercel Cron (see vercel.json).
 * Does NOT update stage events — those come from the webhook handler.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRAND_CONFIG = [
  { slug: "spa",        apiKey: process.env.GHL_API_KEY ?? "",            locationId: "TrtSnBSSKBOkVVNxJ3AM", pipelineId: "4vgVsqiN12VGdloyzyxD" },
  { slug: "aesthetics", apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT", pipelineId: "PaSsbcOAeRURF2Hc2V3F" },
  { slug: "slimming",   apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",   locationId: "imWIWDcnmOfijW0lltPq", pipelineId: "N3usvWAkWpUppJj1ggtM" },
];

const STAGE_ORDER = [
  "New Leads", "Call Back", "Contacted", "Booking Won", "Active Member",
  "Booking Lost", "No Show", "Nurturing",
];

function matchStage(name: string): string {
  const clean = name.replace(/[^\x00-\x7F]/g, "").trim();
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
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}`);
  return resp.json();
}

export async function GET(req: NextRequest) {
  // Auth: when CRON_SECRET is set, Vercel sends it as `Authorization: Bearer`
  // on cron invocations — require it (also enables manual curl triggers).
  // When it's NOT set, fall back to the x-vercel-cron header so the nightly
  // job keeps working, but warn loudly.
  const cronSecret = process.env.CRON_SECRET;
  const isLocal = !process.env.VERCEL_URL;
  const authorized = cronSecret
    ? req.headers.get("authorization") === `Bearer ${cronSecret}`
    : req.headers.get("x-vercel-cron") === "1";
  if (!cronSecret) {
    console.warn(
      "[SECURITY] CRON_SECRET is not set — cron auth falls back to the x-vercel-cron header. Set CRON_SECRET in Vercel env vars."
    );
  }
  if (!authorized && !isLocal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now      = new Date().toISOString();
  const { data: brandRows } = await sb.from("brands").select("id, slug");
  const brandIdMap: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[r.slug] = r.id;

  const summary: Record<string, number> = {};

  for (const brand of BRAND_CONFIG) {
    if (!brand.apiKey) continue;
    const brandId = brandIdMap[brand.slug];
    if (!brandId) continue;

    let upserted = 0;
    let startAfter: string | undefined;
    let startAfterId: string | undefined;

    // Paginate up to 10 pages (1,000 most recent opps) as a catch-up window
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = {
        location_id: brand.locationId,
        pipeline_id: brand.pipelineId,
        status: "all",
        limit: "100",
      };
      if (startAfter)   params.startAfter   = startAfter;
      if (startAfterId) params.startAfterId = startAfterId;

      const data = (await ghlGet("/opportunities/search", brand.apiKey, params)) as {
        opportunities?: Record<string, unknown>[];
        meta?: { startAfter?: number; startAfterId?: string };
      };
      const opps = data.opportunities ?? [];
      if (!opps.length) break;

      const rows = opps.map((opp) => ({
        ghl_opportunity_id:    opp.id as string,
        brand_id:              brandId,
        ghl_location_id:       brand.locationId,
        ghl_pipeline_id:       brand.pipelineId,
        ghl_pipeline_stage_id: (opp.pipelineStageId ?? "") as string,
        stage_normalized:      matchStage((opp.pipelineStageName ?? opp.pipelineStageId ?? "") as string),
        status:                (opp.status ?? null) as string | null,
        contact_id:            (opp.contactId ?? null) as string | null,
        assigned_to:           (opp.assignedTo ?? null) as string | null,
        monetary_value:        (opp.monetaryValue ?? null) as number | null,
        date_added:            (opp.createdAt ?? opp.dateAdded ?? now) as string,
        date_updated:          (opp.updatedAt ?? opp.dateUpdated ?? now) as string,
        raw:                   opp,
        synced_at:             now,
      }));

      const { error } = await sb.from("ghl_opportunities").upsert(rows, { onConflict: "ghl_opportunity_id" });
      if (error) { console.error(`reconcile ${brand.slug}:`, error.message); break; }

      upserted += rows.length;
      if (!data.meta?.startAfter) break;
      startAfter   = String(data.meta.startAfter);
      startAfterId = data.meta.startAfterId;
    }

    summary[brand.slug] = upserted;
  }

  console.log("GHL reconcile complete:", summary);
  return NextResponse.json({ ok: true, upserted: summary });
}
