/**
 * One-shot marketing ETL backfill runner.
 * Run from CEO-Cockpit root: npx tsx --env-file .env.production.local Tools/run-marketing-etl-backfill.ts
 */

// Strip literal \n that Vercel env files inject into string values
for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { runMetaCampaignsEtl } from "../lib/etl/meta-campaigns";
import { runGoogleCampaignsEtl } from "../lib/etl/google-campaigns";
import { runKlaviyoDailyEtl } from "../lib/etl/klaviyo-daily";

const DATE_FROM = "2026-01-01";
const DATE_TO   = "2026-06-09";
const KLAVIYO_DATE = "2026-06-08";

async function main() {
  console.log("=== Marketing ETL Backfill ===");
  console.log(`Meta/Google: ${DATE_FROM} → ${DATE_TO}`);
  console.log(`Klaviyo: ${KLAVIYO_DATE}`);
  console.log("");

  // Meta
  console.log("▶ Running Meta Ads ETL...");
  try {
    const result = await runMetaCampaignsEtl({ dateFrom: DATE_FROM, dateTo: DATE_TO });
    console.log(`✓ Meta: ${result.rows_upserted} rows upserted`);
    console.log("  Log:", result.log);
  } catch (e) {
    console.error("✗ Meta failed:", e);
  }

  console.log("");

  // Google
  console.log("▶ Running Google Ads ETL...");
  try {
    const result = await runGoogleCampaignsEtl({ dateFrom: DATE_FROM, dateTo: DATE_TO });
    console.log(`✓ Google: ${result.rows_upserted} rows upserted`);
    console.log("  Log:", result.log);
  } catch (e) {
    console.error("✗ Google failed:", e);
  }

  console.log("");

  // Klaviyo
  console.log("▶ Running Klaviyo ETL...");
  try {
    const result = await runKlaviyoDailyEtl({ date: KLAVIYO_DATE });
    console.log(`✓ Klaviyo: ${result.rows_upserted} rows upserted`);
    console.log("  Log:", result.log);
  } catch (e) {
    console.error("✗ Klaviyo failed:", e);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
