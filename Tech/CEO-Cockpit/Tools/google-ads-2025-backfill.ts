/**
 * Google Ads 2025 full-year backfill.
 * Run: npx tsx --env-file .env.production.local Tools/google-ads-2025-backfill.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { runGoogleCampaignsEtl } from "../lib/etl/google-campaigns";

async function main() {
  console.log("▶ Google Ads 2025 backfill: 2025-01-01 → 2025-12-31");
  const result = await runGoogleCampaignsEtl({ dateFrom: "2025-01-01", dateTo: "2025-12-31" });
  console.log(`✓ ${result.rows_upserted} rows upserted`);
  console.log("Log:", result.log);
}

main().catch(e => { console.error("✗", e.message); process.exit(1); });
