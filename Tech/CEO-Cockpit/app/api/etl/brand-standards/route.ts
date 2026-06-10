/**
 * POST /api/etl/brand-standards
 *
 * Syncs the Facility / Front Desk / Mystery Guest checklist tabs from the
 * "Accounting Master" Google Sheet into Supabase brand_standards.
 * Idempotent — full re-parse + upsert ON CONFLICT (month,standard_type,item,location).
 *
 * Data is fetched via the public CSV export endpoint (NO OAuth, no refresh
 * tokens — same auth-free pattern as /api/etl/crm-agents). Requirement: the
 * sheet stays shared "Anyone with link can view".
 *
 * Trigger manually: POST {} (no body required).
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";
import { buildBrandStandards, type BrandStandardRow } from "@/lib/etl/brand-standards";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 500;

async function supabaseUpsert(
  supabaseUrl: string,
  supabaseKey: string,
  rows: BrandStandardRow[]
): Promise<void> {
  if (!rows.length) return;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Full rebuild: rows can legitimately DISAPPEAR from the parsed set (items
  // reworded in the sheet, or a location-month newly excluded as an unfilled
  // all-FALSE template). Upsert alone would leave those stale rows behind, so
  // clear the table first — but only after parsing succeeded (rows.length > 0),
  // so a fetch/parse failure can never empty the table.
  const { error: delError } = await supabase
    .from("brand_standards")
    .delete()
    .not("id", "is", null);
  if (delError) {
    throw new Error(`Supabase delete error: ${delError.message}`);
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("brand_standards")
      .upsert(chunk, { onConflict: "month,standard_type,item,location" });
    if (error) {
      throw new Error(
        `Supabase upsert error (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${error.message}`
      );
    }
  }
}

export async function POST(req: NextRequest) {
  // Optional body (unused — always a full re-sync)
  try { await req.json(); } catch { /* no body is fine */ }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }

  const logger = new ETLLogger("brand_standards");
  await logger.start();

  try {
    const { rows, warnings, tabs } = await buildBrandStandards();

    await supabaseUpsert(supabaseUrl, supabaseKey, rows);

    // Months covered + row counts per standard_type
    const monthsByType: Record<string, Set<string>> = {};
    const byType: Record<string, number> = {};
    for (const row of rows) {
      (monthsByType[row.standard_type] ??= new Set()).add(row.month);
      byType[row.standard_type] = (byType[row.standard_type] ?? 0) + 1;
    }
    const months = Object.fromEntries(
      Object.entries(monthsByType).map(([t, set]) => [t, Array.from(set).sort()])
    );

    await logger.complete(rows.length);

    return NextResponse.json({
      ok: true,
      rows_upserted: rows.length,
      months,
      by_type: byType,
      tabs,
      warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logger.fail(msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
