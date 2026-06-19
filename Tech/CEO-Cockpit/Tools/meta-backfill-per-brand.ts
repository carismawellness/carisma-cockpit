/**
 * Meta Ads backfill — uses per-brand tokens (since each brand's ad account
 * lives in a different Business Portfolio).
 * Run: npx tsx --env-file .env.production.local Tools/meta-backfill-per-brand.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

const PER_BRAND_TOKENS: Record<string, string> = {
  spa:        "EAASq9dA8ZAiMBRkY9ZBqZAdvXq5UyHK8aXnU5kRY71I2Nl81ux5N0iZC7krQEme6oVSKeDdzJUtpkk4RsdIEqKS9WK7T1h4riR3sMK4QZCZCHQzuKVSaFpsMFxCZBApOfoGl0ANBvm2ltjsriyDVtrguv6UUChdrYcUsz8E5IhAhJOe4mcIHpZAeFc9dkH4kho0g2wZDZD",
  aesthetics: "EAAPDSkGikgQBRlpPU6rmHWSPcz6w64AyGZCC5I9PC4gT91kRhZAZBzhiMqIkByvFGAZBZCmtfQpOHvEcyZCOZApQEFjtdUPRMnOforIPRPJ5ZBk7p5NPYMPwV5SQlAkuxGJyU00mzF97dfHeV7NtBnCZB5fAcv095rJYEwLrhoZBLZBHYrgZA0K0sJJ2MZAkxQZADrUFuOdAZDZD",
};

const DATE_FROM = "2025-01-01";
const DATE_TO   = "2026-06-09";

import { runMetaCampaignsEtl } from "../lib/etl/meta-campaigns";

async function main() {
  console.log(`Meta Ads backfill: ${DATE_FROM} → ${DATE_TO}`);
  let totalRows = 0;
  for (const [slug, token] of Object.entries(PER_BRAND_TOKENS)) {
    console.log(`\n▶ Running brand: ${slug}`);
    process.env.META_ACCESS_TOKEN = token;
    try {
      const result = await runMetaCampaignsEtl({
        dateFrom: DATE_FROM,
        dateTo:   DATE_TO,
        brandSlug: slug as "spa" | "aesthetics" | "slimming",
      });
      console.log(`✓ [${slug}] ${result.rows_upserted} rows`);
      console.log(`  log: ${result.log.slice(0, 300)}`);
      totalRows += result.rows_upserted;
    } catch (e) {
      console.error(`✗ [${slug}] failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`\n=== Total: ${totalRows} rows ===`);
}

main().catch(e => { console.error("✗", e); process.exit(1); });
