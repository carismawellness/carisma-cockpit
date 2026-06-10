/**
 * Reconciliation report for the spa historical backfill.
 * Prints per-year row counts and revenue from spa_transactions_raw and the
 * derived spa_revenue_daily / spa_revenue_monthly tables. Flags unknown Sales
 * Points and unmapped therapists. Compare totals against the source sheet for
 * 3-5 year/location spot checks.
 *
 * Usage:
 *   npx tsx --env-file .env.production.local Tools/qc-spa-historical.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { selectRaw } from "../lib/etl/supabase-etl";

function section(label: string) { console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`); }

async function main() {
  section("Per-year coverage (spa_transactions_raw, service_date not null)");
  // PostgREST can't run GROUP BY, so we read aggregated rows for known year buckets via month rollups.
  const monthly = (await selectRaw("spa_revenue_monthly", {
    select:      "month,location_id,services,product_phytomer,product_purest,product_other,data_source",
    data_source: "eq.historic_sheet",
    order:       "month.asc",
  })) as Array<{ month: string; location_id: number; services: number; product_phytomer: number; product_purest: number; product_other: number; data_source: string }>;

  const byYear = new Map<string, { svc: number; prod: number; rows: number }>();
  for (const m of monthly) {
    const y = m.month.slice(0, 4);
    const cur = byYear.get(y) ?? { svc: 0, prod: 0, rows: 0 };
    cur.svc  += Number(m.services);
    cur.prod += Number(m.product_phytomer) + Number(m.product_purest) + Number(m.product_other);
    cur.rows += 1;
    byYear.set(y, cur);
  }
  console.log("year    monthly_rows   services €      products €      total €");
  for (const [y, v] of [...byYear.entries()].sort()) {
    console.log(`${y}    ${String(v.rows).padStart(12)}   ${v.svc.toFixed(0).padStart(12)}   ${v.prod.toFixed(0).padStart(12)}   ${(v.svc + v.prod).toFixed(0).padStart(12)}`);
  }

  section("Bridge: continuity 2023-08 → 2025-01 (expect gap)");
  const bridge = (await selectRaw("spa_revenue_monthly", {
    select: "month,data_source,services",
    month:  "gte.2023-06-01",
    order:  "month.asc",
  })) as Array<{ month: string; data_source: string; services: number }>;
  const byMonth = new Map<string, { live: number; hist: number }>();
  for (const r of bridge) {
    const cur = byMonth.get(r.month) ?? { live: 0, hist: 0 };
    if (r.data_source === "cockpit_live") cur.live += Number(r.services);
    else                                   cur.hist += Number(r.services);
    byMonth.set(r.month, cur);
  }
  console.log("month        historic €    live €");
  for (const [m, v] of [...byMonth.entries()].sort()) {
    const flag = (v.live === 0 && v.hist === 0) ? " ← GAP" : "";
    console.log(`${m}  ${v.hist.toFixed(0).padStart(12)}   ${v.live.toFixed(0).padStart(12)}${flag}`);
  }

  section("Unknown Sales Points (location_id IS NULL in raw)");
  const unknowns = (await selectRaw("spa_transactions_raw", {
    select:      "sales_point_raw",
    location_id: "is.null",
    limit:       "5000",
  })) as Array<{ sales_point_raw: string }>;
  const upCount = new Map<string, number>();
  for (const u of unknowns) upCount.set(u.sales_point_raw, (upCount.get(u.sales_point_raw) ?? 0) + 1);
  if (upCount.size === 0) console.log("  ✓ none");
  else for (const [k, n] of [...upCount.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

  section("Top 20 unmapped therapists (canonical likely = raw)");
  const unmapped = (await selectRaw("spa_transactions_raw", {
    select: "therapist_raw,therapist_canonical",
    therapist_canonical: "not.is.null",
    limit:  "5000",
  })) as Array<{ therapist_raw: string; therapist_canonical: string }>;
  const eq = unmapped.filter(t => t.therapist_raw && t.therapist_raw.toUpperCase() === t.therapist_canonical.toUpperCase());
  const tCount = new Map<string, number>();
  for (const t of eq) tCount.set(t.therapist_raw, (tCount.get(t.therapist_raw) ?? 0) + 1);
  for (const [k, n] of [...tCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${k}: ${n}`);
  }

  section("Done. Run these in Supabase SQL editor for the heavy reconciliation:");
  console.log(`
SELECT EXTRACT(YEAR FROM service_date)::INT AS yr, COUNT(*) AS rows,
       SUM(revenue_ex_vat)::INT AS total_ex_vat
FROM spa_transactions_raw WHERE service_date IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT revenue_bucket, COUNT(*), SUM(revenue_ex_vat)::INT AS eur
FROM spa_transactions_raw GROUP BY 1 ORDER BY 1;

SELECT EXTRACT(YEAR FROM date)::INT AS yr, data_source,
       SUM(services)::INT AS services,
       SUM(product_phytomer + product_purest + product_other)::INT AS products
FROM spa_revenue_daily GROUP BY 1,2 ORDER BY 1,2;
`);
}

main().catch(e => { console.error("✗", e); process.exit(1); });
