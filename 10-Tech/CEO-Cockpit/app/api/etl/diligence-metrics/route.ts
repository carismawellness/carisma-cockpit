/**
 * POST /api/etl/diligence-metrics
 *
 * Reads the Cockpit datasheet "Service - Spa" tab and auto-computes:
 *   - cash_sales       (Payment Type = Cash, Sales Status = Sold)
 *   - discounted_cash  (Cash + Discount > 0, Sales Status = Sold)
 *   - complimentary    (Payment Type = Payment Center, Sales Status = Sold)
 *
 * Upserts only these three columns into `diligence_audit` on conflict
 * (month, location_id). total_sales, deleted_cancelled, and unattended_count
 * are written by the diligence-audit ETL (Accounting Master) and are NOT
 * touched here.
 *
 * Run this AFTER /api/etl/diligence-audit so that rows already exist and the
 * upsert correctly overwrites just the three computed fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";
import { computeDiligenceMetrics, type DiligenceMetricsRow } from "@/lib/etl/diligence-metrics";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const CHUNK_SIZE = 200;

async function upsertMetrics(
  url: string,
  key: string,
  rows: DiligenceMetricsRow[],
): Promise<void> {
  if (!rows.length) return;
  const supabase = createClient(url, key);
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
  try { await req.json(); } catch { /* body optional */ }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }

  const logger = new ETLLogger("diligence_metrics");
  await logger.start();

  try {
    const { rows, months, warnings } = await computeDiligenceMetrics();
    await upsertMetrics(supabaseUrl, supabaseKey, rows);
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
