/**
 * POST /api/etl/diligence-audit
 *
 * Syncs the "Diligence audit" tab of the Accounting Master Google Sheet into
 * Supabase `diligence_audit` (monthly per-location audit metrics: total
 * sales, deleted/cancelled, complimentary, cash sales, discounted cash,
 * unattended count).
 *
 * Full-history re-upsert every run — idempotent via
 * ON CONFLICT (month, location_id) DO UPDATE.
 *
 * Data is fetched via the zero-auth public CSV export (no OAuth, no refresh
 * tokens). Requirement: the sheet stays shared "Anyone with link can view".
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";
import { runDiligenceAudit, type DiligenceAuditRow } from "@/lib/etl/diligence-audit";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 200;

async function supabaseUpsert(
  supabaseUrl: string,
  supabaseKey: string,
  rows: DiligenceAuditRow[],
): Promise<void> {
  if (!rows.length) return;
  const supabase = createClient(supabaseUrl, supabaseKey);
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("diligence_audit")
      .upsert(chunk, { onConflict: "month,location_id" });
    if (error) {
      throw new Error(
        `Supabase upsert error (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${error.message}`
      );
    }
  }
}

export async function POST(req: NextRequest) {
  // Optional body (unused — always full-history sync)
  try { await req.json(); } catch { /* no body is fine */ }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }

  const logger = new ETLLogger("diligence_audit");
  await logger.start();

  try {
    const { rows, months, warnings } = await runDiligenceAudit();
    await supabaseUpsert(supabaseUrl, supabaseKey, rows);
    await logger.complete(rows.length);

    return NextResponse.json({
      ok: true,
      rows_upserted: rows.length,
      months,
      warnings,
    });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
