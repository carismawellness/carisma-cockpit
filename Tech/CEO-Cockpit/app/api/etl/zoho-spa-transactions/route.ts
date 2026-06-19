import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionLines } from "@/lib/etl/zoho-line-extractor";
import { loadSpaCoaFromSupabase, COA_MAP } from "@/lib/etl/spa-ebitda";
import { runSpaEbitdaMonthFromTransactions } from "@/lib/etl/zoho-spa-transactions-ebitda";
import { ETLLogger } from "@/lib/etl/etl-logger";

// POST /api/etl/zoho-spa-transactions
//
// Pulls every invoice/bill/expense/creditnote/vendorcredit/journal line from the
// SPA Zoho org for the requested date range, applies tag-aware allocation, and
// writes monthly totals to spa_ebitda_monthly + hq_ebitda_monthly. Replaces the
// reports/profitandloss-based ETL whose tag filter was silently ignored by Zoho.

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

  const logger = new ETLLogger("zoho_spa_transactions");
  await logger.start();
  const log: string[] = [];
  let totalSpa = 0, totalHq = 0;

  try {
    const client = new ZohoBooksClient("spa");

    log.push("Loading SPA CoA mapping…");
    const coaMap = (await loadSpaCoaFromSupabase()) ?? COA_MAP;
    log.push(`Loaded ${Object.keys(coaMap).length} mapped accounts`);

    // Single full-range pull amortises rate-limit cost across all months.
    // Skip revenue-side sources (invoice, creditnote, salesreturn) — SPA revenue
    // comes from spa_revenue_daily (Cockpit datasheet) and is explicitly ignored
    // in transactions_raw reads (ebitda-v2 line 413: `if (line === "revenue") continue`).
    // Skipping these dramatically reduces transaction count for high-volume SPA org.
    log.push(`Pulling transactions ${dateFrom} … ${dateTo} (single full-range fetch, skip revenue sources)…`);
    const pull = await fetchTransactionLines(client, dateFrom, dateTo, {
      // Skip revenue-side + payment sources for SPA (high-volume Fresha sync).
      // Revenue: spa_revenue_daily is authoritative. Payments: only capture bank
      // charges (minor amounts, negligible vs SGA total). Both are explicitly
      // skipped or irrelevant in ebitda-v2 reads.
      skipSources: ["invoice", "creditnote", "salesreturn", "customerpayment", "vendorpayment"],
    });
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
      const result = await runSpaEbitdaMonthFromTransactions(client, y, m, {
        force,
        coaMap,
        fromDateOverride: isFirst ? dateFrom : undefined,
        toDateOverride:   isLast  ? dateTo   : undefined,
        preLoadedLines:   pull.lines,
      });
      totalSpa += result.spaRowsUpserted;
      totalHq  += result.hqRowsUpserted;
      log.push(...result.log);
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    await logger.complete(totalSpa + totalHq);
    log.push(`Done — ${totalSpa} spa rows + ${totalHq} hq row(s) upserted total`);
    return NextResponse.json({ status: "ok", spa_rows: totalSpa, hq_rows: totalHq, log: log.join("\n") });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
