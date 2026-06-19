/**
 * Backfill script — populates transactions_raw for Jan 2025 → Jun 2026.
 *
 * Runs the full ETL for each month directly on this machine — no Vercel,
 * no HTTP timeouts. Each month takes ~30-90s depending on transaction volume.
 *
 * Run from the CEO-Cockpit directory:
 *   npx tsx --env-file=.env.local scripts/backfill-transactions-raw.ts
 */

import { ZohoBooksClient }                       from "../lib/etl/zoho-client";
import { fetchTransactionLines }                  from "../lib/etl/zoho-line-extractor";
import { loadSpaCoaFromSupabase, COA_MAP }        from "../lib/etl/spa-ebitda";
import { runSpaEbitdaMonthFromTransactions }      from "../lib/etl/zoho-spa-transactions-ebitda";
import { loadAestheticsCoaMap }                   from "../lib/etl/aesthetics-ebitda";
import { runAestheticsEbitdaMonthFromTransactions } from "../lib/etl/zoho-aesthetics-transactions-ebitda";

// ── Months to process ──────────────────────────────────────────────────────
const MONTHS: [number, number][] = [];
for (let y = 2025; y <= 2026; y++) {
  const maxM = y === 2026 ? 6 : 12;
  for (let m = 1; m <= maxM; m++) MONTHS.push([y, m]);
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function monthKey(y: number, m: number) { return `${y}-${pad(m)}`; }
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

async function runMonth(year: number, month: number) {
  const fromDate = `${year}-${pad(month)}-01`;
  const toDate   = `${year}-${pad(month)}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const key      = monthKey(year, month);

  // ── SPA ───────────────────────────────────────────────────────────────────
  process.stdout.write(`  SPA ${key}... `);
  try {
    const spaClient = new ZohoBooksClient("spa");
    const coaMap    = (await loadSpaCoaFromSupabase()) ?? COA_MAP;
    const pull      = await fetchTransactionLines(spaClient, fromDate, toDate);
    const result    = await runSpaEbitdaMonthFromTransactions(spaClient, year, month, {
      force: true,
      coaMap,
      preLoadedLines: pull.lines,
    });
    console.log(`✓  ${result.spaRowsUpserted} spa / ${result.hqRowsUpserted} hq rows`);
  } catch (e) {
    console.log(`✗  ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Aesthetics ────────────────────────────────────────────────────────────
  process.stdout.write(`  AES ${key}... `);
  try {
    const aesClient = new ZohoBooksClient("aesthetics");
    const coaMap    = await loadAestheticsCoaMap();
    const pull      = await fetchTransactionLines(aesClient, fromDate, toDate);
    const result    = await runAestheticsEbitdaMonthFromTransactions(aesClient, year, month, {
      force: true,
      coaMap,
      preLoadedLines: pull.lines,
    });
    console.log(`✓  ${result.rowsUpserted} rows`);
  } catch (e) {
    console.log(`✗  ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nBackfilling ${MONTHS.length} months (Jan 2025 → Jun 2026)\n`);

  for (const [year, month] of MONTHS) {
    console.log(`\n[${monthKey(year, month)}]`);
    await runMonth(year, month);
  }

  console.log("\n✓ Done.\n");
})();
