/**
 * POST /api/etl/lead-reconciliation
 *
 * Aggregates lead counts from two already-populated Supabase tables:
 *   meta_campaigns_daily  → Meta Ads leads (action_type=lead, already synced)
 *   crm_daily             → GHL new leads (total_leads, already synced)
 *
 * Upserts the merged result into crm_lead_reconciliation so the
 * Lead Reconciliation dashboard widget always shows real numbers.
 *
 * Body (optional): { date_from?: string, date_to?: string }
 * Defaults to the last 90 days.
 *
 * Run order in nightly cron: AFTER meta-campaigns + ghl-crm.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";

export const maxDuration = 120;
export const dynamic     = "force-dynamic";

const CHUNK_SIZE = 200;

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

type ReconRow = {
  date:       string;
  brand_id:   number;
  leads_meta: number;
  leads_crm:  number;
};

async function upsertChunked(sb: ReturnType<typeof adminClient>, rows: ReconRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await sb
      .from("crm_lead_reconciliation")
      .upsert(chunk, { onConflict: "date,brand_id" });
    if (error) throw new Error(`Upsert error: ${error.message}`);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const dateFrom = typeof body.date_from === "string" ? body.date_from : defaultDateFrom();
  const dateTo   = typeof body.date_to   === "string" ? body.date_to   : defaultDateTo();

  const logger = new ETLLogger("lead_reconciliation");
  await logger.start();

  const sb = adminClient();

  // --- 1. Aggregate Meta leads per brand+date from meta_campaigns_daily ---
  const { data: metaRows, error: metaErr } = await sb
    .from("meta_campaigns_daily")
    .select("date, brand_id, leads")
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (metaErr) {
    await logger.fail(metaErr.message);
    return NextResponse.json({ status: "error", error: metaErr.message }, { status: 500 });
  }

  const metaByKey = new Map<string, number>();
  for (const r of metaRows ?? []) {
    const key = `${r.date}|${r.brand_id}`;
    metaByKey.set(key, (metaByKey.get(key) ?? 0) + (r.leads ?? 0));
  }

  // --- 2. Pull GHL new leads per brand+date from crm_daily ---
  const { data: crmRows, error: crmErr } = await sb
    .from("crm_daily")
    .select("date, brand_id, total_leads")
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (crmErr) {
    await logger.fail(crmErr.message);
    return NextResponse.json({ status: "error", error: crmErr.message }, { status: 500 });
  }

  const crmByKey = new Map<string, number>();
  for (const r of crmRows ?? []) {
    const key = `${r.date}|${r.brand_id}`;
    crmByKey.set(key, (crmByKey.get(key) ?? 0) + (r.total_leads ?? 0));
  }

  // --- 3. Merge: union of all date+brand_id pairs from both sources ---
  const allKeys = new Set([...metaByKey.keys(), ...crmByKey.keys()]);
  const reconRows: ReconRow[] = [];

  for (const key of allKeys) {
    const [date, brandIdStr] = key.split("|");
    reconRows.push({
      date,
      brand_id:   parseInt(brandIdStr, 10),
      leads_meta: metaByKey.get(key) ?? 0,
      leads_crm:  crmByKey.get(key) ?? 0,
    });
  }

  if (reconRows.length === 0) {
    await logger.complete(0);
    return NextResponse.json({
      status: "ok",
      rows_upserted: 0,
      message: "No data found in either source for the given range",
    });
  }

  try {
    await upsertChunked(sb, reconRows);
  } catch (err) {
    await logger.fail(err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  await logger.complete(reconRows.length);
  return NextResponse.json({
    status:          "ok",
    date_from:       dateFrom,
    date_to:         dateTo,
    rows_upserted:   reconRows.length,
    meta_days:       metaByKey.size,
    crm_days:        crmByKey.size,
    total_meta_leads: [...metaByKey.values()].reduce((a, b) => a + b, 0),
    total_crm_leads:  [...crmByKey.values()].reduce((a, b) => a + b, 0),
  });
}
