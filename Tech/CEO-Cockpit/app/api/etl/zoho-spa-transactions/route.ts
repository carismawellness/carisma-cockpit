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

// Sub-line correction: account_name keywords that resolve to a sub-line.
// resolveSubLine() in the ETL checks account_name, but some Zoho accounts use
// generic names (e.g. "Administration Expenses"). This PATCH pass runs AFTER
// all rows are written so any missed rows are corrected before the route returns.
const SGA_SUB_FIX: [string[], string][] = [
  [["software", "subscription", "saas", "license", "licence", "system", "fresha"], "software"],
  [["travel", "transport", "flight", "hotel", "accommodation", "taxi", "uber", "airbnb", "parking", "car hire", "car rental", "vehicle hire", "airline", "airways"], "travel"],
  [["fuel", "petrol", "diesel", "gas station"], "fuel"],
  [["clean", "hygiene", "sanitiz", "pest"], "cleaning"],
  // Laundry runs AFTER cleaning so its keywords win over the bare "clean" match above.
  // "fresh&clean" would otherwise be reclassified from "laundry" → "cleaning" by the
  // contact_name.ilike.*clean* filter in the cleaning pass.
  [["laundry", "linen", "fresh & clean", "fresh&clean", "fresh clean"], "laundry"],
  [["insur"], "insurance"],
  [["event", "function", "catering", "hospitality"], "events"],
  [["maintenance", "repair", "service contract"], "maintenance"],
  [["telecom", "telephone", "mobile", "internet", "broadband", "phone"], "telecom"],
  [["professional", "legal", "audit", "accounting", "consultant", "advisory"], "prof_services"],
];

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}
function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
}

async function fixSgaSubLines(dateFrom: string, dateTo: string): Promise<number> {
  let total = 0;
  for (const [keywords, subLine] of SGA_SUB_FIX) {
    // Check both account_name (COA) and contact_name (vendor) — some vendors like
    // Fresha use generic COA accounts (e.g. "Service Charges") so the vendor name
    // is the only reliable signal.
    // URL-encode & so it doesn't split the query string before PostgREST sees it.
    const encKw = keywords.map(k => k.replace(/&/g, "%26"));
    const orParts = [
      ...encKw.map(k => `account_name.ilike.*${k}*`),
      ...encKw.map(k => `contact_name.ilike.*${k}*`),
    ].join(",");
    const filter = `org=eq.spa&ebitda_line=eq.sga&ebitda_sub_line=neq.${subLine}&date=gte.${dateFrom}&date=lte.${dateTo}&or=(${orParts})`;
    const resp = await fetch(`${sbUrl("transactions_raw")}?${filter}`, {
      method: "PATCH", headers: sbHeaders(), body: JSON.stringify({ ebitda_sub_line: subLine }),
    });
    if (resp.ok) { const rows = await resp.json() as unknown[]; total += rows.length; }
  }
  return total;
}

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

    // Auto-fix SGA sub_lines: resolveSubLine() misses accounts with generic COA
    // names (e.g. "Administration Expenses") where the vendor name carries the signal.
    const fixedRows = await fixSgaSubLines(dateFrom, dateTo);
    if (fixedRows) log.push(`\nSGA sub_line fix: ${fixedRows} row(s) corrected`);

    await logger.complete(totalSpa + totalHq);
    log.push(`\nDone — ${totalSpa} spa rows + ${totalHq} hq row(s) upserted total`);
    return NextResponse.json({ status: "ok", spa_rows: totalSpa, hq_rows: totalHq, sga_fixed: fixedRows, log: log.join("\n") });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
