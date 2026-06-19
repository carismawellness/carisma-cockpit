/**
 * Slimming Meta backfill — chunked by month.
 * Run: npx tsx --env-file .env.production.local Tools/meta-backfill-slim-chunked.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

process.env.META_ACCESS_TOKEN = "EAAOLZBdYstZCMBRsd33rxEwExAmfeSjhswtx0D53Eljn7k6AKQBDTFQQL3ZA4tZCc5DQJQ8ZBiYuu958NwPdpAIhOWlvFLn5ZBvPeilCHOeOAZC6O5ckZAuDQjVE9JfeWpEZBEL9xx0VsZCkmWVRdF9NNUYZAYWiYQsxZCnbmQNn0QrmTG9SBi7fNasICAMawZAMI5fmhtQZDZD";

import { runMetaCampaignsEtl } from "../lib/etl/meta-campaigns";

const CHUNKS: Array<[string, string]> = [
  ["2025-01-01", "2025-01-31"], ["2025-02-01", "2025-02-28"],
  ["2025-03-01", "2025-03-31"], ["2025-04-01", "2025-04-30"],
  ["2025-05-01", "2025-05-31"], ["2025-06-01", "2025-06-30"],
  ["2025-07-01", "2025-07-31"], ["2025-08-01", "2025-08-31"],
  ["2025-09-01", "2025-09-30"], ["2025-10-01", "2025-10-31"],
  ["2025-11-01", "2025-11-30"], ["2025-12-01", "2025-12-31"],
  ["2026-01-01", "2026-01-31"], ["2026-02-01", "2026-02-28"],
  ["2026-03-01", "2026-03-31"], ["2026-04-01", "2026-04-30"],
  ["2026-05-01", "2026-05-31"], ["2026-06-01", "2026-06-09"],
];

async function main() {
  console.log("Slimming Meta backfill (chunked by month)");
  let total = 0;
  for (const [from, to] of CHUNKS) {
    try {
      const r = await runMetaCampaignsEtl({ dateFrom: from, dateTo: to, brandSlug: "slimming" });
      console.log(`✓ ${from} → ${to}: ${r.rows_upserted} rows`);
      total += r.rows_upserted;
    } catch (e) {
      console.error(`✗ ${from} → ${to}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }
  console.log(`\n=== Total: ${total} rows ===`);
}

main().catch(e => { console.error("✗", e); process.exit(1); });
