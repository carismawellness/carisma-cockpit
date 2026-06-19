import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionLines } from "@/lib/etl/zoho-line-extractor";
import { loadSpaCoaFromSupabase, COA_MAP } from "@/lib/etl/spa-ebitda";
import { runSpaEbitdaMonthFromTransactions } from "@/lib/etl/zoho-spa-transactions-ebitda";
import { ETLLogger } from "@/lib/etl/etl-logger";

// POST /api/etl/zoho-spa-transactions
//
// Pulls cost-side transaction lines from the SPA Zoho org and writes to
// spa_ebitda_daily, hq_ebitda_daily, and transactions_raw.
//
// Revenue-side sources (invoice, creditnote, salesreturn, customerpayment,
// vendorpayment) are skipped because:
//  - SPA revenue is authoritative in spa_revenue_daily (Cockpit datasheet)
//  - ebitda-v2 explicitly ignores revenue rows from transactions_raw
//  - Fresha syncs generate very high volumes of these records per month
//
// To stay within Vercel's 300s function limit, long date ranges are
// automatically split into 7-day chunks and processed sequentially.

export const maxDuration = 300;

const SKIP_SOURCES = ["invoice", "creditnote", "salesreturn", "customerpayment", "vendorpayment"] as const;
const CHUNK_DAYS = 7; // max days per fetchTransactionLines call

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function minDate(a: string, b: string): string { return a < b ? a : b; }

export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string, force = false;
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
    force    = body.force === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const logger = new ETLLogger("zoho_spa_transactions");
  await logger.start();
  const log: string[] = [];
  let totalSpa = 0, totalHq = 0;

  try {
    const client = new ZohoBooksClient("spa");

    log.push("Loading SPA CoA mapping…");
    const coaMap = (await loadSpaCoaFromSupabase()) ?? COA_MAP;
    log.push(`Loaded ${Object.keys(coaMap).length} mapped accounts`);

    // Split the full range into CHUNK_DAYS windows to stay within Vercel's 300s
    // limit. SPA has ~30 expenses/day across 8 venues; a full month of detail
    // calls at 300ms each would exceed the limit.
    let chunkStart = dateFrom;
    while (chunkStart <= dateTo) {
      const chunkEnd = minDate(addDays(chunkStart, CHUNK_DAYS - 1), dateTo);

      log.push(`\nPulling chunk ${chunkStart} … ${chunkEnd} (skip: ${SKIP_SOURCES.join(", ")})…`);
      const pull = await fetchTransactionLines(client, chunkStart, chunkEnd, {
        skipSources: [...SKIP_SOURCES],
      });
      log.push(...pull.log.map(s => `  ${s}`));
      log.push(`  Per source: ${JSON.stringify(pull.perSourceCount)}`);
      log.push(`  Total lines: ${pull.lines.length}`);

      // Process each calendar month that overlaps with this chunk
      const [csy, csm, csd] = chunkStart.split("-").map(Number);
      const [cey, cem, ced] = chunkEnd  .split("-").map(Number);
      const fromD = new Date(csy, csm - 1, csd);
      const toD   = new Date(cey, cem - 1, ced);
      let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
      while (d <= toD) {
        const y = d.getFullYear(), m = d.getMonth() + 1;
        const isFirst = y === fromD.getFullYear() && m === fromD.getMonth() + 1;
        const isLast  = y === toD  .getFullYear() && m === toD  .getMonth() + 1;
        const result = await runSpaEbitdaMonthFromTransactions(client, y, m, {
          force,
          coaMap,
          fromDateOverride: isFirst ? chunkStart : undefined,
          toDateOverride:   isLast  ? chunkEnd   : undefined,
          preLoadedLines:   pull.lines,
        });
        totalSpa += result.spaRowsUpserted;
        totalHq  += result.hqRowsUpserted;
        log.push(...result.log);
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }

      chunkStart = addDays(chunkEnd, 1);
    }

    await logger.complete(totalSpa + totalHq);
    log.push(`\nDone — ${totalSpa} spa rows + ${totalHq} hq row(s) upserted total`);
    return NextResponse.json({ status: "ok", spa_rows: totalSpa, hq_rows: totalHq, log: log.join("\n") });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
