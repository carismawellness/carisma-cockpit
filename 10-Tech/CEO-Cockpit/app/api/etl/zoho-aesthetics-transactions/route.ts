import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionLines } from "@/lib/etl/zoho-line-extractor";
import { loadAestheticsCoaMap } from "@/lib/etl/aesthetics-ebitda";
import { runAestheticsEbitdaMonthFromTransactions } from "@/lib/etl/zoho-aesthetics-transactions-ebitda";
import { ETLLogger } from "@/lib/etl/etl-logger";

// POST /api/etl/zoho-aesthetics-transactions
//
// Pulls every invoice/bill/expense/creditnote/vendorcredit/journal line from the
// Aesthetics Zoho org for the requested date range, applies tag-aware allocation
// (with keyword + CoA-rule fallbacks), and writes monthly per-department totals
// to aesthetics_ebitda_monthly. Replaces the reports/profitandloss-based ETL
// whose tag_option_id filter was silently ignored by Zoho.

export const maxDuration = 300;

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

  const logger = new ETLLogger("zoho_aesthetics_transactions");
  await logger.start();
  const log: string[] = [];
  let totalRows = 0;

  try {
    const client = new ZohoBooksClient("aesthetics");

    log.push("Loading Aesthetics CoA mapping…");
    const coaMap = await loadAestheticsCoaMap();
    log.push(`Loaded ${Object.keys(coaMap).length} mapped accounts`);

    // Single full-range pull amortises rate-limit cost across all months.
    log.push(`Pulling transactions ${dateFrom} … ${dateTo} (single full-range fetch)…`);
    const pull = await fetchTransactionLines(client, dateFrom, dateTo);
    log.push(...pull.log.map(s => `  ${s}`));
    log.push(`Per source: ${JSON.stringify(pull.perSourceCount)}`);
    log.push(`Total lines: ${pull.lines.length}`);

    const fromD = new Date(dateFrom);
    const toD   = new Date(dateTo);
    let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (d <= toD) {
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const isFirst = y === fromD.getFullYear() && m === fromD.getMonth() + 1;
      const isLast  = y === toD  .getFullYear() && m === toD  .getMonth() + 1;
      const result = await runAestheticsEbitdaMonthFromTransactions(client, y, m, {
        force,
        coaMap,
        fromDateOverride: isFirst ? dateFrom : undefined,
        toDateOverride:   isLast  ? dateTo   : undefined,
        preLoadedLines:   pull.lines,
      });
      totalRows += result.rowsUpserted;
      log.push(...result.log);
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    await logger.complete(totalRows);
    log.push(`Done — ${totalRows} row(s) upserted total`);
    return NextResponse.json({ status: "ok", rows_upserted: totalRows, log: log.join("\n") });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
