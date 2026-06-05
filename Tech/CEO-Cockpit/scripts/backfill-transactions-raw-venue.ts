/**
 * scripts/backfill-transactions-raw-venue.ts
 *
 * Re-runs the EBITDA ETL for all 2026 months to backfill the new `venue`
 * column that migration 051 added to transactions_raw.
 *
 * Run with:
 *   npx tsx scripts/backfill-transactions-raw-venue.ts [--dry-run] [--month YYYY-MM]
 *
 * Flags:
 *   --dry-run        Only print which months would be processed; don't call Zoho.
 *   --month YYYY-MM  Process a single month instead of all 2026 months.
 *
 * Each ETL run deletes and re-inserts transactions_raw rows for its date window,
 * so re-running is safe and idempotent.
 */

import { ZohoBooksClient } from "../lib/etl/zoho-client";
import { runSpaEbitdaMonthFromTransactions }  from "../lib/etl/zoho-spa-transactions-ebitda";
import { runAestheticsEbitdaMonthFromTransactions } from "../lib/etl/zoho-aesthetics-transactions-ebitda";

const args = process.argv.slice(2);
const dryRun  = args.includes("--dry-run");
const monthArg = args.find(a => a.startsWith("--month"))
  ? args[args.indexOf("--month") + 1]
  : null;

// Build list of months to process
const today = new Date();
const months: Array<{ year: number; month: number }> = [];

if (monthArg) {
  const [y, m] = monthArg.split("-").map(Number);
  months.push({ year: y, month: m });
} else {
  // All 2026 months up to today
  for (let m = 1; m <= 12; m++) {
    const d = new Date(2026, m - 1, 1);
    if (d > today) break;
    months.push({ year: 2026, month: m });
  }
}

async function main() {
  if (dryRun) {
    console.log("Dry run — months that would be processed:");
    months.forEach(({ year, month }) => console.log(`  ${year}-${String(month).padStart(2, "0")}`));
    return;
  }

  const spaClient   = new ZohoBooksClient("spa");
  const aesthClient = new ZohoBooksClient("aesthetics");

  for (const { year, month } of months) {
    const label = `${year}-${String(month).padStart(2, "0")}`;
    console.log(`\n=== ${label} ===`);

    // SPA
    try {
      const res = await runSpaEbitdaMonthFromTransactions(spaClient, year, month);
      res.log.forEach(l => console.log("  SPA  ", l));
    } catch (e) {
      console.error(`  SPA ERROR: ${e}`);
    }

    // Aesthetics
    try {
      const res = await runAestheticsEbitdaMonthFromTransactions(aesthClient, year, month);
      res.log.forEach(l => console.log("  AEST ", l));
    } catch (e) {
      console.error(`  AEST ERROR: ${e}`);
    }
  }

  console.log("\nBackfill complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
