/**
 * scripts/backfill-transactions-raw-venue.ts
 *
 * Re-runs the EBITDA ETL for a given year/month range to populate the `venue`
 * column in transactions_raw.
 *
 * Run with:
 *   npx tsx scripts/backfill-transactions-raw-venue.ts [options]
 *
 * Options:
 *   --dry-run          Print months to process; don't call Zoho or touch data.
 *   --month YYYY-MM    Process a single month only.
 *   --year  YYYY       Process all months in that year up to today (default: 2026).
 *
 * Safety guarantees (built into the ETL step 6):
 *   - The ETL builds the replacement rows BEFORE deleting existing data.
 *   - If 0 rows are generated (empty period or classification bug), the existing
 *     Supabase rows are preserved and a SKIP log line is emitted.
 *   - This script additionally logs before/after row counts so any reduction
 *     is immediately visible.
 */

import { createClient } from "@supabase/supabase-js";
import { ZohoBooksClient } from "../lib/etl/zoho-client";
import { runSpaEbitdaMonthFromTransactions }          from "../lib/etl/zoho-spa-transactions-ebitda";
import { runAestheticsEbitdaMonthFromTransactions }   from "../lib/etl/zoho-aesthetics-transactions-ebitda";

const args     = process.argv.slice(2);
const dryRun   = args.includes("--dry-run");
const monthArg = args.includes("--month") ? args[args.indexOf("--month") + 1] : null;
const yearArg  = args.includes("--year")  ? Number(args[args.indexOf("--year")  + 1]) : null;
const year     = yearArg ?? 2026;

// ── Build month list ──────────────────────────────────────────────────────────
const today  = new Date();
const months: Array<{ year: number; month: number }> = [];

if (monthArg) {
  const [y, m] = monthArg.split("-").map(Number);
  months.push({ year: y, month: m });
} else {
  for (let m = 1; m <= 12; m++) {
    const d = new Date(year, m - 1, 1);
    if (d > today) break;
    months.push({ year, month: m });
  }
}

// ── Supabase client (service role — for row-count safety checks) ──────────────
const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getRowCount(fromDate: string, toDate: string): Promise<number> {
  const { count } = await supabase
    .from("transactions_raw")
    .select("*", { count: "exact", head: true })
    .gte("date", fromDate)
    .lte("date", toDate);
  return count ?? 0;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (dryRun) {
    console.log(`Dry run — would process ${months.length} month(s):`);
    months.forEach(({ year, month }) => console.log(`  ${year}-${pad(month)}`));
    return;
  }

  const spaClient   = new ZohoBooksClient("spa");
  const aesthClient = new ZohoBooksClient("aesthetics");

  for (const { year, month } of months) {
    const label    = `${year}-${pad(month)}`;
    const fromDate = `${year}-${pad(month)}-01`;
    const lastDay  = new Date(year, month, 0).getDate();
    const toDate   = `${year}-${pad(month)}-${pad(lastDay)}`;

    console.log(`\n=== ${label} ===`);

    // ── Safety: record before-count ─────────────────────────────────────────
    const before = await getRowCount(fromDate, toDate);
    console.log(`  [safety] transactions_raw rows BEFORE: ${before}`);

    // ── SPA ─────────────────────────────────────────────────────────────────
    try {
      const res = await runSpaEbitdaMonthFromTransactions(spaClient, year, month);
      res.log.slice(-2).forEach(l => console.log("  SPA  ", l));
    } catch (e) {
      console.error(`  SPA ERROR: ${e}`);
    }

    // ── Aesthetics ───────────────────────────────────────────────────────────
    try {
      const res = await runAestheticsEbitdaMonthFromTransactions(aesthClient, year, month);
      res.log.slice(-2).forEach(l => console.log("  AEST ", l));
    } catch (e) {
      console.error(`  AEST ERROR: ${e}`);
    }

    // ── Safety: record after-count and warn if data was lost ────────────────
    const after = await getRowCount(fromDate, toDate);
    console.log(`  [safety] transactions_raw rows AFTER:  ${after}`);
    if (before > 0 && after < before * 0.5) {
      console.error(
        `  ⚠️  WARNING: row count dropped from ${before} to ${after} ` +
        `(${Math.round(after / before * 100)}% of original). ` +
        `Check ETL logs above — data may be incomplete.`
      );
    } else if (after === 0 && before > 0) {
      console.error(`  ❌ CRITICAL: ALL ${before} rows were deleted and 0 were inserted!`);
    } else {
      console.log(`  [safety] OK — row count ${before} → ${after}`);
    }
  }

  console.log("\nBackfill complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
