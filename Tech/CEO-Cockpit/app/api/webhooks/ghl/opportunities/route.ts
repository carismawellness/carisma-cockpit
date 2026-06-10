/**
 * POST /api/webhooks/ghl/opportunities
 *
 * Receives GHL opportunity webhook events for all three brands.
 * Brand is identified by locationId in the payload.
 *
 * Supported events:
 *   OpportunityCreate       → upsert row + synthetic stage event
 *   OpportunityStageUpdate  → upsert row + stage event
 *   OpportunityStatusUpdate → update status only
 *   OpportunityDelete       → soft-delete (status = "deleted")
 *
 * Auth: GHL signs payloads with HMAC-SHA256. Set GHL_WEBHOOK_SECRET_SPA,
 * GHL_WEBHOOK_SECRET_AESTHETICS, GHL_WEBHOOK_SECRET_SLIMMING env vars to
 * the signing key for each location (or use a single shared key in
 * GHL_WEBHOOK_SECRET if all three share one).
 *
 * Register webhook URL in each GHL account's Settings → Notifications:
 *   https://<your-domain>/api/webhooks/ghl/opportunities
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GHL location → brand slug + signing secret
const LOCATION_MAP: Record<string, { slug: string; secret: string }> = {
  TrtSnBSSKBOkVVNxJ3AM: { slug: "spa",        secret: process.env.GHL_WEBHOOK_SECRET_SPA        ?? process.env.GHL_WEBHOOK_SECRET ?? "" },
  Goi7kzVK7iwe2woxUHkT: { slug: "aesthetics",  secret: process.env.GHL_WEBHOOK_SECRET_AESTHETICS ?? process.env.GHL_WEBHOOK_SECRET ?? "" },
  imWIWDcnmOfijW0lltPq: { slug: "slimming",    secret: process.env.GHL_WEBHOOK_SECRET_SLIMMING   ?? process.env.GHL_WEBHOOK_SECRET ?? "" },
};

const STAGE_ORDER = [
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

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!secret) {
    // DELIBERATE FAIL-OPEN: no signing secret configured for this location, so
    // the payload is accepted UNVERIFIED. Failing closed here would silently
    // kill the live GHL lead pipeline if the env var is genuinely unset in
    // prod. Set GHL_WEBHOOK_SECRET (or the per-brand _SPA/_AESTHETICS/_SLIMMING
    // variants) in Vercel to enable HMAC verification and close this gap.
    console.error(
      "[SECURITY] GHL webhook accepted WITHOUT signature verification — GHL_WEBHOOK_SECRET is not configured. Set it in Vercel env vars."
    );
    return true;
  }
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature.replace(/^sha256=/, ""), "hex"));
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

async function getBrandId(sb: SbClient, slug: string): Promise<number | null> {
  const { data } = await sb.from("brands").select("id").eq("slug", slug).single();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-ghl-signature") ?? req.headers.get("x-hook-signature");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const locationId = (payload.locationId ?? payload.location_id ?? "") as string;
  const brand = LOCATION_MAP[locationId];
  if (!brand) {
    return NextResponse.json({ error: `Unknown locationId: ${locationId}` }, { status: 400 });
  }

  if (!verifySignature(rawBody, signature, brand.secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const sb: SbClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const brandId = await getBrandId(sb, brand.slug);
  if (!brandId) {
    return NextResponse.json({ error: `Brand ${brand.slug} not in DB` }, { status: 500 });
  }

  const eventType  = (payload.type ?? payload.event ?? "") as string;
  const opp        = (payload.opportunity ?? payload) as Record<string, unknown>;
  const oppId      = (opp.id ?? opp.opportunityId ?? payload.id ?? payload.opportunityId ?? "") as string;
  const stageId    = (opp.pipelineStageId ?? opp.pipeline_stage_id ?? "") as string;
  const stageName  = (opp.pipelineStageName ?? opp.stage_name ?? "") as string;
  const normalized = matchStage(stageName || stageId);
  const now        = new Date().toISOString();

  if (eventType === "OpportunityCreate" || eventType === "OpportunityStageUpdate") {
    const { data: existing } = await sb
      .from("ghl_opportunities")
      .select("stage_normalized, last_stage_change_at")
      .eq("ghl_opportunity_id", oppId)
      .single();

    const prevStage: string | null = existing?.stage_normalized ?? null;
    const stageChanged = !prevStage || prevStage !== normalized;

    await sb.from("ghl_opportunities").upsert({
      ghl_opportunity_id:    oppId,
      brand_id:              brandId,
      ghl_location_id:       locationId,
      ghl_pipeline_id:       (opp.pipelineId ?? opp.pipeline_id ?? "") as string,
      ghl_pipeline_stage_id: stageId,
      stage_normalized:      normalized,
      status:                (opp.status ?? null) as string | null,
      contact_id:            (opp.contactId ?? null) as string | null,
      assigned_to:           (opp.assignedTo ?? null) as string | null,
      monetary_value:        (opp.monetaryValue ?? null) as number | null,
      date_added:            (opp.createdAt ?? opp.dateAdded ?? now) as string,
      date_updated:          now,
      last_stage_change_at:  stageChanged ? now : (existing?.last_stage_change_at ?? now),
      raw:                   payload,
      synced_at:             now,
    }, { onConflict: "ghl_opportunity_id" });

    if (stageChanged) {
      await sb.from("ghl_opportunity_stage_events").insert({
        ghl_opportunity_id:    oppId,
        brand_id:              brandId,
        from_stage_normalized: prevStage,
        to_stage_normalized:   normalized,
        changed_at:            now,
        source:                "webhook",
        raw:                   payload,
      });
    }

  } else if (eventType === "OpportunityStatusUpdate") {
    await sb.from("ghl_opportunities")
      .update({ status: (opp.status ?? payload.status ?? null) as string | null, date_updated: now, synced_at: now })
      .eq("ghl_opportunity_id", oppId);

  } else if (eventType === "OpportunityDelete") {
    await sb.from("ghl_opportunities")
      .update({ status: "deleted", date_updated: now, synced_at: now })
      .eq("ghl_opportunity_id", oppId);
  }

  return NextResponse.json({ ok: true });
}
