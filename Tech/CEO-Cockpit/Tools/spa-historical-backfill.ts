/**
 * Spa historical backfill — 2014-10-10 → 2023-08-27 (~167k transaction rows)
 *
 * Source: Sheet 1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I, tab "Sales MASTER".
 * Plan:   Tech/CEO-Cockpit/docs/spa-historical-migration-plan.md
 *
 * Lands rows into spa_transactions_raw (loss-less) then re-aggregates into the
 * existing spa_revenue_daily / spa_revenue_monthly / spa_services_by_employee_daily
 * tables tagged data_source='historic_sheet'. Idempotent on sheet_row_id.
 *
 * Prereqs (apply before running):
 *   1. supabase/migrations/070_spa_transactions_raw_and_qawra.sql applied
 *   2. CSV input — EITHER share the source sheet "Anyone with link can view"
 *      so the public export URL works, OR download the sheet as CSV manually
 *      (File → Download → Comma-separated values) and pass --csv=path/to/file.csv
 *
 * Usage:
 *   # dry-run on a single year, reading from local CSV
 *   npx tsx --env-file .env.production.local Tools/spa-historical-backfill.ts \
 *       --csv=/tmp/sales_master.csv --year=2019 --dry-run
 *
 *   # full backfill from public export URL
 *   npx tsx --env-file .env.production.local Tools/spa-historical-backfill.ts
 *
 *   # full backfill from local CSV
 *   npx tsx --env-file .env.production.local Tools/spa-historical-backfill.ts \
 *       --csv=/tmp/sales_master.csv
 */

// Strip literal "\n" that Vercel env files inject
for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { readFileSync } from "node:fs";
import { upsert, selectRaw, deleteRange } from "../lib/etl/supabase-etl";

// ── Constants ────────────────────────────────────────────────────────────────

const SHEET_ID  = "1jOdDzPFWqVL-kRPA2TjBSqK6Fj5A6KCQZShlXwESh6I";
const SHEET_GID = "1229497505";
const CSV_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const VAT_RATE  = 0.18;

// Sales Point string in column R → location slug.
// Includes both modern names and historic "X SALES POINT" labelling variants.
const SALES_POINT_TO_SLUG: Record<string, string> = {
  "INTER":                        "inter",
  "INTER SALES POINT":            "inter",
  "HUGOS":                        "hugos",
  "HUGOS SALES POINT":            "hugos",
  "HYATT":                        "hyatt",
  "HYATT SALES POINT":            "hyatt",
  "RAMLA":                        "ramla",
  "RAMLA SALES POINT":            "ramla",
  "LABRANDA":                     "labranda",
  "LABRANDA GENERAL SALES POINT": "labranda",
  "SUNNY COAST":                  "odycy",
  "EXCELSIOR":                    "excelsior",
  "SALES POINT OF EXCELSIOR":     "excelsior",
  "NOV":                          "novotel",
  "NOVOTEL":                      "novotel",
  "SALES POINT OF NOV":           "novotel",
  "QAWRA":                        "qawra",
  "SEASHELLS":                    "seashells",
  "SEASHELLS SALES POINT":        "seashells",
};

// Employee tokens that are NOT real therapists — kept in raw, excluded from
// the per-employee derived table.
const NON_THERAPIST_TOKENS = new Set([
  "", "CARISMA (SALES)", "SPA DAY", "REC", "CARISMA SPA",
]);

const PHYTOMER_SKU_RE = /^P[A-Z]{4}\d/;

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const argMap: Record<string, string | true> = {};
for (const a of args) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    argMap[k] = v ?? true;
  }
}
const DRY_RUN  = argMap["dry-run"] === true;
const ONLY_YEAR = typeof argMap["year"] === "string" ? Number(argMap["year"]) : null;
const CSV_PATH = typeof argMap["csv"]  === "string" ? (argMap["csv"] as string) : null;

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      row.push(cur); cur = "";
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      rows.push(row); row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function loadCsv(): Promise<string[][]> {
  if (CSV_PATH) {
    console.log(`Reading CSV from local file: ${CSV_PATH}`);
    return parseCsv(readFileSync(CSV_PATH, "utf-8"));
  }
  console.log(`Fetching CSV from ${CSV_URL}`);
  const resp = await fetch(CSV_URL, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(
      `CSV fetch failed: ${resp.status}. ` +
      `Either share the sheet as "Anyone with the link can view" or pass --csv=path/to/file.csv.`
    );
  }
  const text = await resp.text();
  if (text.trimStart().startsWith("<!DOCTYPE") || text.includes("<html")) {
    throw new Error(
      "CSV endpoint returned HTML (sheet is not publicly shared). " +
      "Either change sharing to Anyone-with-the-link or pass --csv=path/to/file.csv."
    );
  }
  return parseCsv(text);
}

// ── Parsers ──────────────────────────────────────────────────────────────────

function parseSheetDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;
  // Sheet uses D/M/YYYY or DD/MM/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  // Fallback: ISO
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseSheetTime(raw: string): string | null {
  raw = raw.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
}

// Strip €, $, £, NBSP, commas, whitespace. Preserve sign. Empty → null.
function safeFloat(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[€$£\s ]/g, "").replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function safeInt(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s/g, "").trim();
  if (cleaned === "") return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function clean(raw: string | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/&amp;/g, "&");
  return t === "" ? null : t;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── Bucket logic ─────────────────────────────────────────────────────────────

function classifyBucket(serviceType: string | null, serviceName: string | null): string {
  const st  = (serviceType ?? "").trim();
  const sku = (serviceName ?? "").toUpperCase().trim();
  if (st === "Service" || st === "Spa Facilities" || st === "Add Ons" || st === "Spa Club") {
    return "services";
  }
  if (st === "Retail") {
    if (PHYTOMER_SKU_RE.test(sku))   return "product_phytomer";
    if (sku.includes("PUREST"))      return "product_purest";
    return "product_other";
  }
  return "product_other"; // safety net — flagged in QC
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface RawRow {
  sheet_row_id: number;
  zoho_id: string | null;
  service_date: string | null;
  service_time: string | null;
  service_upper_group: string | null;
  package_name: string | null;
  service_group: string | null;
  service_name: string | null;
  first_name: string | null;
  surname: string | null;
  contact_email: string | null;
  payment_type: string | null;
  room: string | null;
  duration_min: number | null;
  list_price_gross: number | null;
  discount_pct: number | null;
  net_revenue_gross: number;
  revenue_ex_vat: number;
  lead_type: string | null;
  location_id: number | null;
  sales_point_raw: string;
  therapist_raw: string | null;
  therapist_canonical: string | null;
  guest_group: string | null;
  sold_by: string | null;
  cost_amount: number | null;
  profit: number | null;
  day_of_week: string | null;
  service_type: string | null;
  discount_value: number | null;
  revenue_bucket: string;
}

async function main() {
  console.log("─".repeat(70));
  console.log("Spa historical backfill — Sales MASTER → spa_transactions_raw");
  console.log("─".repeat(70));
  console.log(`DRY_RUN=${DRY_RUN}  ONLY_YEAR=${ONLY_YEAR ?? "all"}  CSV=${CSV_PATH ?? "URL"}`);

  // ── Lookups ────────────────────────────────────────────────────────────────
  const locRows = (await selectRaw("locations", { select: "id,slug" })) as { id: number; slug: string }[];
  const slugToId: Record<string, number> = {};
  for (const r of locRows) slugToId[r.slug] = r.id;
  console.log(`Loaded ${locRows.length} locations.`);
  for (const slug of ["inter","hugos","hyatt","ramla","labranda","odycy","excelsior","novotel","qawra","seashells"]) {
    if (!slugToId[slug]) console.warn(`  ⚠ missing location slug='${slug}' — Sales Points mapping to it will be NULL.`);
  }

  const aliasRows = (await selectRaw("practitioner_name_aliases", { select: "revenue_name,canonical_name,venue" })) as
    { revenue_name: string; canonical_name: string; venue: string }[];
  const aliasMap = new Map<string, string>();
  for (const r of aliasRows) if (r.venue === "spa") aliasMap.set(r.revenue_name.toUpperCase(), r.canonical_name);
  console.log(`Loaded ${aliasMap.size} spa therapist aliases.`);

  // ── CSV ────────────────────────────────────────────────────────────────────
  const csv = await loadCsv();
  if (csv.length < 2) throw new Error("CSV is empty.");
  const header = csv[0].map(h => h.trim());
  console.log(`CSV: ${csv.length} rows (incl header), ${header.length} columns.`);

  // Column index lookup (defensive — sheet column drift over 8 years is possible)
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Missing required column '${name}'`);
    return i;
  };
  const C = {
    zoho:        idx("ZOHO ID"),
    date:        idx("Service Date"),
    time:        idx("Time of Service (Service Start Time)"),
    upper:       idx("Service Upper Group"),
    pkg:         idx("Package Name"),
    group:       idx("Service Group"),
    name:        idx("Service Name"),
    first:       idx("Name"),
    surname:     idx("Surname"),
    email:       idx("E-Mail"),
    payment:     idx("Payment Type"),
    room:        idx("Room"),
    duration:    idx("Duration (min)"),
    listPrice:   idx("List Price"),
    discountPct: idx("Discount (Indirim %)"),
    netRev:      idx("Net Revenue (Unit price)"),
    leadType:    idx("Lead Type"),
    salesPoint:  idx("Club (Sales Point)"),
    therapist:   idx("Therapist (Employee(s))"),
    guestGroup:  idx("Guest Group (Musteri Grubu)"),
    soldBy:      idx("Sold By"),
    cost:        idx("Cost Amount"),
    profit:      idx("Profit"),
    dow:         idx("Date of Week"),
    serviceType: idx("Service Type"),
    discountVal: idx("Discount Value (Formula)"),
  };

  // ── Parse rows ─────────────────────────────────────────────────────────────
  const rawRows: RawRow[] = [];
  const skipped: Record<string, number> = {};
  const unknownSalesPoints = new Map<string, number>();
  const unmappedTherapists = new Map<string, number>();
  let yearFilteredOut = 0;

  for (let r = 1; r < csv.length; r++) {
    const row = csv[r];
    if (!row || row.every(c => !c || !c.trim())) { skipped["blank_row"] = (skipped["blank_row"] ?? 0) + 1; continue; }

    const sheetRowId = r + 1; // 1-based sheet row (header was row 1)
    const dateRaw   = (row[C.date] ?? "").trim();
    const sd        = parseSheetDate(dateRaw);

    if (ONLY_YEAR != null && sd && sd.getUTCFullYear() !== ONLY_YEAR) { yearFilteredOut++; continue; }
    if (ONLY_YEAR != null && !sd)                                    { yearFilteredOut++; continue; }

    const salesPointRaw = (row[C.salesPoint] ?? "").trim();
    if (!salesPointRaw) { skipped["no_sales_point"] = (skipped["no_sales_point"] ?? 0) + 1; continue; }

    const slug = SALES_POINT_TO_SLUG[salesPointRaw.toUpperCase()];
    const locationId = slug ? (slugToId[slug] ?? null) : null;
    if (!slug) unknownSalesPoints.set(salesPointRaw, (unknownSalesPoints.get(salesPointRaw) ?? 0) + 1);

    const netRevGross = safeFloat(row[C.netRev]);
    if (netRevGross == null) { skipped["no_net_revenue"] = (skipped["no_net_revenue"] ?? 0) + 1; continue; }

    const revenueExVat = +(netRevGross / (1 + VAT_RATE)).toFixed(2);

    const therapistRaw = clean(row[C.therapist]);
    const therapistKey = (therapistRaw ?? "").toUpperCase();
    let therapistCanonical: string | null = null;
    if (therapistRaw && !NON_THERAPIST_TOKENS.has(therapistKey)) {
      therapistCanonical = aliasMap.get(therapistKey) ?? therapistRaw;
      if (!aliasMap.has(therapistKey)) {
        unmappedTherapists.set(therapistRaw, (unmappedTherapists.get(therapistRaw) ?? 0) + 1);
      }
    }

    const bucket = classifyBucket(clean(row[C.serviceType]), clean(row[C.name]));

    rawRows.push({
      sheet_row_id:        sheetRowId,
      zoho_id:             clean(row[C.zoho]),
      service_date:        sd ? dateKey(sd) : null,
      service_time:        parseSheetTime(row[C.time] ?? ""),
      service_upper_group: clean(row[C.upper]),
      package_name:        clean(row[C.pkg]),
      service_group:       clean(row[C.group]),
      service_name:        clean(row[C.name]),
      first_name:          clean(row[C.first]),
      surname:             clean(row[C.surname]),
      contact_email:       (() => { const e = clean(row[C.email]); return (e === "@" || e === "") ? null : e; })(),
      payment_type:        clean(row[C.payment]),
      room:                clean(row[C.room]),
      duration_min:        safeInt(row[C.duration]),
      list_price_gross:    safeFloat(row[C.listPrice]),
      discount_pct:        safeFloat(row[C.discountPct]),
      net_revenue_gross:   +netRevGross.toFixed(2),
      revenue_ex_vat:      revenueExVat,
      lead_type:           clean(row[C.leadType]),
      location_id:         locationId,
      sales_point_raw:     salesPointRaw,
      therapist_raw:       therapistRaw,
      therapist_canonical: therapistCanonical,
      guest_group:         clean(row[C.guestGroup]),
      sold_by:             clean(row[C.soldBy]),
      cost_amount:         safeFloat(row[C.cost]),
      profit:              safeFloat(row[C.profit]),
      day_of_week:         clean(row[C.dow]),
      service_type:        clean(row[C.serviceType]),
      discount_value:      safeFloat(row[C.discountVal]),
      revenue_bucket:      bucket,
    });
  }

  console.log(`Parsed ${rawRows.length} ingestable rows; year-filtered ${yearFilteredOut}; skipped: ${JSON.stringify(skipped)}`);
  if (unknownSalesPoints.size) {
    console.warn(`Unknown Sales Points: ${JSON.stringify(Object.fromEntries(unknownSalesPoints))}`);
  }

  // ── Per-year summary ────────────────────────────────────────────────────────
  const byYear = new Map<string, { n: number; eur: number }>();
  for (const r of rawRows) {
    const y = r.service_date ? r.service_date.slice(0, 4) : "no-date";
    const cur = byYear.get(y) ?? { n: 0, eur: 0 };
    cur.n += 1; cur.eur += r.revenue_ex_vat;
    byYear.set(y, cur);
  }
  console.log("Per-year preview:");
  for (const [y, v] of [...byYear.entries()].sort()) {
    console.log(`  ${y}: rows=${v.n.toString().padStart(7)}  ex-VAT €${v.eur.toFixed(0).padStart(10)}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY_RUN — no writes performed. Exit.");
    return;
  }

  // ── Upsert raw rows ────────────────────────────────────────────────────────
  console.log(`\nUpserting ${rawRows.length} rows → spa_transactions_raw …`);
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rawRows.length; i += CHUNK) {
    const slice = rawRows.slice(i, i + CHUNK) as unknown as Record<string, unknown>[];
    upserted += await upsert("spa_transactions_raw", slice, "sheet_row_id");
    if ((i / CHUNK) % 20 === 0) process.stdout.write(`  ${i}/${rawRows.length}\n`);
  }
  console.log(`✓ spa_transactions_raw: ${upserted} rows`);

  // ── Derive spa_revenue_daily (historic_sheet only) ─────────────────────────
  type DailyKey = string; // `${location_id}|${date}`
  type DailyAgg = { location_id: number; date: string; services: number; product_phytomer: number; product_purest: number; product_other: number };
  const dailyMap = new Map<DailyKey, DailyAgg>();
  for (const r of rawRows) {
    if (r.service_date == null || r.location_id == null) continue;
    const k = `${r.location_id}|${r.service_date}`;
    const cur = dailyMap.get(k) ?? { location_id: r.location_id, date: r.service_date, services: 0, product_phytomer: 0, product_purest: 0, product_other: 0 };
    (cur as any)[r.revenue_bucket] += r.revenue_ex_vat;
    dailyMap.set(k, cur);
  }
  const dailyRows = [...dailyMap.values()].map(a => ({
    location_id:      a.location_id,
    date:             a.date,
    services:         +a.services.toFixed(2),
    product_phytomer: +a.product_phytomer.toFixed(2),
    product_purest:   +a.product_purest.toFixed(2),
    product_other:    +a.product_other.toFixed(2),
    lapis_synced_at:  new Date().toISOString(),
    data_source:      "historic_sheet",
  }));
  console.log(`Upserting ${dailyRows.length} → spa_revenue_daily (data_source=historic_sheet) …`);
  let dailyUp = 0;
  for (let i = 0; i < dailyRows.length; i += CHUNK) {
    dailyUp += await upsert("spa_revenue_daily", dailyRows.slice(i, i + CHUNK) as unknown as Record<string, unknown>[], "location_id,date");
  }
  console.log(`✓ spa_revenue_daily: ${dailyUp} rows`);

  // ── Derive spa_revenue_monthly (historic_sheet only) ───────────────────────
  type MonthlyKey = string;
  type MonthlyAgg = { location_id: number; month: string; services: number; product_phytomer: number; product_purest: number; product_other: number };
  const monthlyMap = new Map<MonthlyKey, MonthlyAgg>();
  for (const r of rawRows) {
    if (r.service_date == null || r.location_id == null) continue;
    const mk = r.service_date.slice(0, 7) + "-01";
    const k  = `${r.location_id}|${mk}`;
    const cur = monthlyMap.get(k) ?? { location_id: r.location_id, month: mk, services: 0, product_phytomer: 0, product_purest: 0, product_other: 0 };
    (cur as any)[r.revenue_bucket] += r.revenue_ex_vat;
    monthlyMap.set(k, cur);
  }
  const monthlyRows = [...monthlyMap.values()].map(a => ({
    location_id:      a.location_id,
    month:            a.month,
    services:         +a.services.toFixed(2),
    product_phytomer: +a.product_phytomer.toFixed(2),
    product_purest:   +a.product_purest.toFixed(2),
    product_other:    +a.product_other.toFixed(2),
    wholesale:        0,                       // no Zoho data pre-2023
    sales_discount:   0,
    sales_refund:     0,
    lapis_synced_at:  new Date().toISOString(),
    zoho_synced_at:   null,
    data_source:      "historic_sheet",
  }));
  console.log(`Upserting ${monthlyRows.length} → spa_revenue_monthly (data_source=historic_sheet) …`);
  let monthlyUp = 0;
  for (let i = 0; i < monthlyRows.length; i += CHUNK) {
    monthlyUp += await upsert("spa_revenue_monthly", monthlyRows.slice(i, i + CHUNK) as unknown as Record<string, unknown>[], "location_id,month");
  }
  console.log(`✓ spa_revenue_monthly: ${monthlyUp} rows`);

  // ── Derive spa_services_by_employee_daily (historic_sheet only) ────────────
  // This table has no unique key on the natural columns, so for idempotency
  // we delete all historic_sheet rows in the parsed date range and re-insert.
  const datesPresent = rawRows.map(r => r.service_date).filter((d): d is string => d != null);
  if (datesPresent.length) {
    const minDate = datesPresent.reduce((a, b) => a < b ? a : b);
    const maxDate = datesPresent.reduce((a, b) => a > b ? a : b);
    console.log(`Clearing spa_services_by_employee_daily WHERE data_source='historic_sheet' AND date_of_service BETWEEN ${minDate} AND ${maxDate} …`);
    await deleteRange("spa_services_by_employee_daily", [
      ["data_source",     "eq.historic_sheet"],
      ["date_of_service", `gte.${minDate}`],
      ["date_of_service", `lte.${maxDate}`],
    ]);
  }
  const empRows: Record<string, unknown>[] = [];
  for (const r of rawRows) {
    if (r.service_date == null || r.location_id == null) continue;
    if (r.revenue_bucket !== "services") continue;
    if (!r.therapist_canonical) continue;
    if (NON_THERAPIST_TOKENS.has(r.therapist_canonical.toUpperCase())) continue;
    if (r.revenue_ex_vat <= 0) continue;
    empRows.push({
      month:           r.service_date.slice(0, 7) + "-01",
      date_of_service: r.service_date,
      location_id:     r.location_id,
      employee_name:   r.therapist_canonical,
      service_name:    r.service_name,
      price_ex_vat:    r.revenue_ex_vat,
      data_source:     "historic_sheet",
    });
  }
  console.log(`Inserting ${empRows.length} → spa_services_by_employee_daily (data_source=historic_sheet) …`);
  let empUp = 0;
  for (let i = 0; i < empRows.length; i += CHUNK) {
    empUp += await upsert("spa_services_by_employee_daily", empRows.slice(i, i + CHUNK), "id");
  }
  console.log(`✓ spa_services_by_employee_daily: ${empUp} rows`);

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log("\n─".repeat(35));
  console.log("Backfill complete.");
  console.log(`  spa_transactions_raw:           ${upserted}`);
  console.log(`  spa_revenue_daily:              ${dailyUp}`);
  console.log(`  spa_revenue_monthly:            ${monthlyUp}`);
  console.log(`  spa_services_by_employee_daily: ${empUp}`);
  if (unknownSalesPoints.size) {
    console.log(`\n⚠ Unknown Sales Points (location_id=NULL in raw): ${JSON.stringify(Object.fromEntries(unknownSalesPoints))}`);
  }
  if (unmappedTherapists.size) {
    const top = [...unmappedTherapists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log(`\n⚠ Top 20 unmapped therapists (canonical = raw, no alias hit):`);
    for (const [name, n] of top) console.log(`    ${name}: ${n}`);
  }
}

main().catch(e => { console.error("✗", e); process.exit(1); });
