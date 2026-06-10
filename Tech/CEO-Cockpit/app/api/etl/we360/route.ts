/**
 * POST /api/etl/we360
 *
 * Body (all optional):
 *   { date?: "YYYY-MM-DD", start_date?: "YYYY-MM-DD", end_date?: "YYYY-MM-DD" }
 *   - date            → single day
 *   - start_date/end_date → inclusive window
 *   - default         → yesterday
 *
 * Pulls We360 "detailed" productivity rows and UPSERTs into
 * we360_productivity_daily. Outcomes logged to etl_sync_log (source "we360").
 *
 * GET  /api/etl/we360  → connectivity check (auth + 1-row probe), no writes.
 */

import { NextRequest, NextResponse } from "next/server";
import { runWe360ProductivityEtl } from "@/lib/etl/we360-productivity";
import { we360DynamicReport } from "@/lib/we360/report";
import { ETLLogger } from "@/lib/etl/etl-logger";

export const maxDuration = 120;
export const dynamic     = "force-dynamic";

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const single = typeof body.date === "string" ? body.date : undefined;
  const start  = typeof body.start_date === "string" ? body.start_date : single ?? yesterday();
  const end    = typeof body.end_date   === "string" ? body.end_date   : single ?? start;

  const logger = new ETLLogger("we360");
  await logger.start();

  try {
    const result = await runWe360ProductivityEtl(start, end);
    await logger.complete(result.rowsUpserted);
    return NextResponse.json({
      status:        "ok",
      start_date:    start,
      end_date:      end,
      rows_upserted: result.rowsUpserted,
      days_covered:  result.daysCovered,
      employees:     result.employees,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logger.fail(msg.slice(0, 500));
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const probe = await we360DynamicReport({
      start_date: yesterday(),
      end_date:   yesterday(),
      mode:       "summary",
      columns:    ["first_name", "last_name", "email"],
      limit:      1,
    });
    return NextResponse.json({
      status:    "ok",
      connected: true,
      sample:    probe.data?.[0] ?? null,
      total:     probe.pagination?.total_records ?? 0,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", connected: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
