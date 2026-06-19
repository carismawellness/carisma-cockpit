/**
 * Klaviyo 2025 full-year backfill — Jan 1 to Dec 31 2025
 * Run: npx tsx --env-file .env.production.local Tools/klaviyo-2025-backfill.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { runKlaviyoDailyEtl } from "../lib/etl/klaviyo-daily";

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to   + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

async function main() {
  const dates = dateRange("2025-01-01", "2025-12-31");
  console.log(`Backfilling ${dates.length} days (Klaviyo 2025)`);

  let success = 0;
  let failed  = 0;

  for (const date of dates) {
    try {
      const result = await runKlaviyoDailyEtl({ date });
      process.stdout.write(`✓ ${date}: ${result.rows_upserted} rows\n`);
      success++;
    } catch (e) {
      process.stdout.write(`✗ ${date}: ${e}\n`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
}

main().catch(console.error);
