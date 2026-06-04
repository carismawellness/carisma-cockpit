/**
 * Targeted backfill — Jan 2026 to Jun 2026 only.
 * Run: npx tsx --env-file=.env.local scripts/backfill-2026.ts
 */

import { ZohoBooksClient }                         from "../lib/etl/zoho-client";
import { fetchTransactionLines }                    from "../lib/etl/zoho-line-extractor";
import { loadSpaCoaFromSupabase, COA_MAP }          from "../lib/etl/spa-ebitda";
import { runSpaEbitdaMonthFromTransactions }        from "../lib/etl/zoho-spa-transactions-ebitda";
import { loadAestheticsCoaMap }                     from "../lib/etl/aesthetics-ebitda";
import { runAestheticsEbitdaMonthFromTransactions } from "../lib/etl/zoho-aesthetics-transactions-ebitda";

function pad(n: number) { return String(n).padStart(2, "0"); }
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

// Only the missing months
const SPA_MISSING:       [number, number][] = [[2026,1]];
const AESTHETICS_MISSING:[number, number][] = [[2026,1],[2026,2],[2026,3],[2026,5]];

(async () => {
  const spaCoaMap = (await loadSpaCoaFromSupabase()) ?? COA_MAP;
  const aesCoaMap = await loadAestheticsCoaMap();

  console.log("\nSPA missing months:");
  for (const [y, m] of SPA_MISSING) {
    const df = `${y}-${pad(m)}-01`;
    const dt = `${y}-${pad(m)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    process.stdout.write(`  SPA ${y}-${pad(m)}... `);
    try {
      const client = new ZohoBooksClient("spa");
      const pull   = await fetchTransactionLines(client, df, dt);
      const result = await runSpaEbitdaMonthFromTransactions(client, y, m, { force: true, coaMap: spaCoaMap, preLoadedLines: pull.lines });
      console.log(`✓  ${result.spaRowsUpserted} spa / ${result.hqRowsUpserted} hq rows`);
    } catch (e) { console.log(`✗  ${e instanceof Error ? e.message : String(e)}`); }
  }

  console.log("\nAesthetics missing months:");
  for (const [y, m] of AESTHETICS_MISSING) {
    const df = `${y}-${pad(m)}-01`;
    const dt = `${y}-${pad(m)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    process.stdout.write(`  AES ${y}-${pad(m)}... `);
    try {
      const client = new ZohoBooksClient("aesthetics");
      const pull   = await fetchTransactionLines(client, df, dt);
      const result = await runAestheticsEbitdaMonthFromTransactions(client, y, m, { force: true, coaMap: aesCoaMap, preLoadedLines: pull.lines });
      console.log(`✓  ${result.rowsUpserted} rows`);
    } catch (e) { console.log(`✗  ${e instanceof Error ? e.message : String(e)}`); }
  }

  console.log("\n✓ Done.\n");
})();
