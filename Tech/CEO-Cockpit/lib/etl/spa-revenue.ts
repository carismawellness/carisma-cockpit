import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { ETLLogger } from "./etl-logger";
import { COCKPIT_SHEET_ID, COCKPIT_TABS } from "../constants/cockpit-sheets";

const SERVICE_GID  = COCKPIT_TABS.SPA_SERVICES.gid;
const PRODUCT_GID  = COCKPIT_TABS.SPA_RETAIL.gid;
const VAT_RATE     = 0.18;

const COCKPIT_SPA_LOCATION_MAP: Record<string, number> = {
  "HUGOS":                        2,
  "INTER":                        1,
  "RAMLA":                        4,
  "SUNNY COAST":                  6,
  "SALES POINT OF EXCELSIOR":     7,
  "HYATT":                        3,
  "LABRANDA GENERAL SALES POINT": 5,
  "SALES POINT OF NOV":           8,
};
const ALL_LOCATION_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const WHOLESALE_ACCOUNTS = new Set(["506000", "506200", "506300"]);
const DISCOUNT_ACCOUNTS  = new Set(["20000"]);
const REFUND_ACCOUNTS    = new Set(["SALREF"]);

const BRAND_MAP: Record<string, string> = {
  PHYTOMER: "product_phytomer",
  PUREST:   "product_purest",
};

// ── CSV fetch (public Cockpit sheet) ────────────────────────────────────────────

async function fetchCockpitCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = `https://docs.google.com/spreadsheets/d/${COCKPIT_SHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status} — check sheet is shared as "Anyone with the link can view"`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  // The Cockpit sheets prefix the data with a single-cell title row like
  // "Service data is from 1 Jan 2025,,,,," — skip rows with fewer than 3
  // non-empty cells until we find the real header row.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const nonEmpty = parseCSVRow(lines[i]).filter(c => c.trim()).length;
    if (nonEmpty >= 3) { headerIdx = i; break; }
  }
  const headers = parseCSVRow(lines[headerIdx]);
  return lines.slice(headerIdx + 1).map(line => {
    const cells = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

// Month name → 0-indexed number for explicit "D Month YYYY" parsing
const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseCockpitDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;

  // "4 June 2026" / "04 Jun 2026" — product sheet format
  const dmy = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const mo = MONTH_NAMES[dmy[2].toLowerCase()];
    if (mo !== undefined) return new Date(+dmy[3], mo, +dmy[1]);
  }

  for (const fmt of [
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(+y, +m - 1, +d); },
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(2000 + +y, +m - 1, +d); },
    (s: string) => new Date(s),
  ]) {
    try { const d = fmt(raw); if (!isNaN(d.getTime())) return d; } catch { /* */ }
  }
  return null;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }

// ── Cockpit data fetch — monthly aggregation (for Zoho adjustment apportionment) ─

async function fetchCockpitServices(
  dateFrom: Date,
  dateTo: Date,
): Promise<Record<number, Record<string, number>>> {
  const rows   = await fetchCockpitCsv(SERVICE_GID);
  const totals: Record<number, Record<string, number>> = {};

  for (const row of rows) {
    if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;
    const d = parseCockpitDate(stripCol(row, "Service Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const locId = COCKPIT_SPA_LOCATION_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) continue;
    // Unit Price is inc-VAT (till receipt). Store gross — EBITDA divides at read time.
    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    const mk        = monthKey(d);
    if (!totals[locId]) totals[locId] = {};
    totals[locId][mk] = (totals[locId][mk] ?? 0) + unitPrice;
  }
  return totals;
}

async function fetchCockpitProducts(
  dateFrom: Date,
  dateTo: Date,
): Promise<Record<number, Record<string, Record<string, number>>>> {
  let rows: Record<string, string>[];
  try { rows = await fetchCockpitCsv(PRODUCT_GID); } catch { return {}; }
  const totals: Record<number, Record<string, Record<string, number>>> = {};

  for (const row of rows) {
    const d = parseCockpitDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const spa    = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const locId  = COCKPIT_SPA_LOCATION_MAP[spa];
    if (locId === undefined) continue;
    // Source column is "VAT Exclusive Amount" (ex-VAT). Multiply by 1.18 to
    // store inc-VAT for consistency with the services path.
    const amountEx = safeFloat(stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "));
    if (amountEx <= 0) continue;
    const amount = +(amountEx * (1 + VAT_RATE)).toFixed(2);
    const brand  = stripCol(row, "Brand").toUpperCase();
    const col2   = BRAND_MAP[brand] ?? "product_other";
    const mk     = monthKey(d);
    if (!totals[locId]) totals[locId] = {};
    if (!totals[locId][mk]) totals[locId][mk] = {};
    totals[locId][mk][col2] = (totals[locId][mk][col2] ?? 0) + amount;
  }
  return totals;
}

// ── Cockpit data fetch — daily aggregation (for spa_revenue_daily) ──────────────

type DailyServiceTotals  = Record<number, Record<string, number>>;              // locId → dateStr → incVAT
type DailyProductTotals  = Record<number, Record<string, Record<string, number>>>; // locId → dateStr → brand → incVAT

async function fetchCockpitServicesByDay(dateFrom: Date, dateTo: Date): Promise<DailyServiceTotals> {
  const rows   = await fetchCockpitCsv(SERVICE_GID);
  const totals: DailyServiceTotals = {};
  for (const row of rows) {
    if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;
    const d = parseCockpitDate(stripCol(row, "Service Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const locId = COCKPIT_SPA_LOCATION_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) continue;
    // Unit Price is inc-VAT (till receipt). Store gross.
    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    const dk        = dateKey(d);
    if (!totals[locId]) totals[locId] = {};
    totals[locId][dk] = (totals[locId][dk] ?? 0) + unitPrice;
  }
  return totals;
}

async function fetchCockpitProductsByDay(dateFrom: Date, dateTo: Date): Promise<DailyProductTotals> {
  let rows: Record<string, string>[];
  try { rows = await fetchCockpitCsv(PRODUCT_GID); } catch { return {}; }
  const totals: DailyProductTotals = {};
  for (const row of rows) {
    const d = parseCockpitDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const spa   = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const locId = COCKPIT_SPA_LOCATION_MAP[spa];
    if (locId === undefined) continue;
    // Source column is "VAT Exclusive Amount" (ex-VAT). Multiply by 1.18 → inc-VAT.
    const amountEx = safeFloat(stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "));
    if (amountEx <= 0) continue;
    const amount = +(amountEx * (1 + VAT_RATE)).toFixed(2);
    const brand = stripCol(row, "Brand").toUpperCase();
    const col2  = BRAND_MAP[brand] ?? "product_other";
    const dk    = dateKey(d);
    if (!totals[locId]) totals[locId] = {};
    if (!totals[locId][dk]) totals[locId][dk] = {};
    totals[locId][dk][col2] = (totals[locId][dk][col2] ?? 0) + amount;
  }
  return totals;
}

// ── Zoho P&L walk ─────────────────────────────────────────────────────────────

function walkPl(obj: unknown, targetCodes: Set<string>, result: Record<string, number>): void {
  if (Array.isArray(obj)) { for (const item of obj) walkPl(item, targetCodes, result); return; }
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  const code = String(o.account_code ?? "").trim();
  if (code && targetCodes.has(code)) {
    result[code] = (result[code] ?? 0) + (parseFloat(String(o.total ?? 0)) || 0);
  }
  for (const v of Object.values(o)) { if (typeof v === "object") walkPl(v, targetCodes, result); }
}

async function fetchZohoRevenueAccounts(
  client: ZohoBooksClient,
  year: number,
  month: number,
  targetCodes: Set<string>,
): Promise<Record<string, number>> {
  const lastD   = daysInMonth(year, month);
  const fromStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const toStr   = `${year}-${String(month).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
  const data    = await client.get("reports/profitandloss", {
    from_date: fromStr, to_date: toStr, cash_based: "false", comparison_value: "0",
  });
  const result: Record<string, number> = {};
  walkPl(data, targetCodes, result);
  return result;
}

// ── Month runner ──────────────────────────────────────────────────────────────

async function runMonth(
  year: number,
  month: number,
  cockpitServices: Record<number, Record<string, number>>,
  cockpitProducts: Record<number, Record<string, Record<string, number>>>,
  zohoClient: ZohoBooksClient,
  force: boolean,
  log: string[],
): Promise<number> {
  const mk    = `${year}-${String(month).padStart(2, "0")}-01`;
  const nowTs = new Date().toISOString();

  if (!force) {
    const existing   = await select("spa_revenue_monthly", { month: mk });
    const syncedLocs = new Set(
      existing
        .filter(r => r.lapis_synced_at && r.zoho_synced_at)
        .map(r => Number(r.location_id)),
    );
    if (syncedLocs.size === ALL_LOCATION_IDS.length) {
      log.push(`  ${mk}: already synced, skipping`);
      return 0;
    }
  }

  log.push(`  Processing ${mk}…`);

  const locServices: Record<number, number> = {};
  for (const id of ALL_LOCATION_IDS) locServices[id] = cockpitServices[id]?.[mk] ?? 0;

  const locProducts: Record<number, Record<string, number>> = {};
  for (const id of ALL_LOCATION_IDS) {
    const cols = cockpitProducts[id]?.[mk] ?? {};
    locProducts[id] = {
      product_phytomer: cols.product_phytomer ?? 0,
      product_purest:   cols.product_purest   ?? 0,
      product_other:    cols.product_other     ?? 0,
    };
  }

  const allTarget = new Set([...WHOLESALE_ACCOUNTS, ...DISCOUNT_ACCOUNTS, ...REFUND_ACCOUNTS]);
  let zohoTotals: Record<string, number> = {};
  let zohoOk = false;
  try {
    zohoTotals = await fetchZohoRevenueAccounts(zohoClient, year, month, allTarget);
    zohoOk = true;
  } catch (e) {
    log.push(`  ${mk}: Zoho unavailable (${String(e).slice(0, 80)}), using 0 for wholesale/discount/refund`);
  }

  const totalWholesale = [...WHOLESALE_ACCOUNTS].reduce((s, c) => s + Math.abs(zohoTotals[c] ?? 0), 0);
  const totalDiscount  = Math.abs(zohoTotals["20000"]  ?? 0);
  const totalRefund    = Math.abs(zohoTotals["SALREF"] ?? 0);

  const totalCockpit = ALL_LOCATION_IDS.reduce(
    (s, id) => s + locServices[id] + Object.values(locProducts[id]).reduce((a, b) => a + b, 0),
    0,
  );

  const rows = ALL_LOCATION_IDS.map(id => {
    const locTotal = locServices[id] + Object.values(locProducts[id]).reduce((a, b) => a + b, 0);
    const ratio    = totalCockpit > 0 ? locTotal / totalCockpit : 1 / ALL_LOCATION_IDS.length;
    return {
      location_id:      id,
      month:            mk,
      services:         +locServices[id].toFixed(2),
      product_phytomer: +locProducts[id].product_phytomer.toFixed(2),
      product_purest:   +locProducts[id].product_purest.toFixed(2),
      product_other:    +locProducts[id].product_other.toFixed(2),
      wholesale:        +(totalWholesale / ALL_LOCATION_IDS.length).toFixed(2),
      sales_discount:   +(totalDiscount * ratio).toFixed(2),
      sales_refund:     +(totalRefund   * ratio).toFixed(2),
      lapis_synced_at:  nowTs,
      zoho_synced_at:   zohoOk ? nowTs : null,
    };
  });

  const count = await upsert("spa_revenue_monthly", rows as Record<string, unknown>[], "location_id,month");
  const svcTotal  = ALL_LOCATION_IDS.reduce((s, id) => s + locServices[id], 0);
  const prodTotal = ALL_LOCATION_IDS.reduce((s, id) => s + Object.values(locProducts[id]).reduce((a, b) => a + b, 0), 0);
  log.push(`  ${mk}: services=€${svcTotal.toFixed(0)} products=€${prodTotal.toFixed(0)} wholesale=€${totalWholesale.toFixed(0)} → ${count} rows upserted`);
  return count;
}

// ── Daily upsert — spa_revenue_daily ─────────────────────────────────────────

export async function runSpaRevenueDaily(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsUpserted: number; log: string[] }> {
  const log: string[] = [];
  const logger = new ETLLogger("spa_revenue_daily");
  await logger.start();

  try {
    const fromD = new Date(dateFrom);
    const toD   = new Date(dateTo);

    log.push("Fetching Cockpit datasheet daily spa data…");
    const [svcByDay, prodByDay] = await Promise.all([
      fetchCockpitServicesByDay(fromD, toD),
      fetchCockpitProductsByDay(fromD, toD),
    ]);

    // Collect all (locId, date) combos that have any data
    const keys = new Set<string>();
    for (const [locId, days] of Object.entries(svcByDay))  for (const dk of Object.keys(days))  keys.add(`${locId}|${dk}`);
    for (const [locId, days] of Object.entries(prodByDay)) for (const dk of Object.keys(days))  keys.add(`${locId}|${dk}`);

    const nowTs = new Date().toISOString();
    const rows  = Array.from(keys).map(k => {
      const [locIdStr, dk] = k.split("|");
      const locId = Number(locIdStr);
      const cols  = prodByDay[locId]?.[dk] ?? {};
      return {
        location_id:      locId,
        date:             dk,
        services:         +(svcByDay[locId]?.[dk] ?? 0).toFixed(2),
        product_phytomer: +(cols.product_phytomer ?? 0).toFixed(2),
        product_purest:   +(cols.product_purest   ?? 0).toFixed(2),
        product_other:    +(cols.product_other    ?? 0).toFixed(2),
        lapis_synced_at:  nowTs,
        // Explicit tag prevents drift away from the column DEFAULT — if the
        // default ever changes, live-ETL rows still land as cockpit_live.
        data_source:      "cockpit_live",
      };
    });

    const count = await upsert("spa_revenue_daily", rows as Record<string, unknown>[], "location_id,date");
    log.push(`Daily upsert: ${count} rows for ${keys.size} location-days`);

    await logger.complete(count);
    return { rowsUpserted: count, log };
  } catch (e) {
    await logger.fail(String(e));
    throw e;
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runSpaRevenue(
  dateFrom: string,
  dateTo: string,
  force = false,
): Promise<{ rowsUpserted: number; log: string[] }> {
  const log: string[] = [];
  const logger = new ETLLogger("spa_revenue");
  await logger.start();

  try {
    const fromD = new Date(dateFrom);
    const toD   = new Date(dateTo);

    log.push("Fetching Cockpit datasheet spa data (one-time fetch for full date range)…");
    const cockpitServices = await fetchCockpitServices(fromD, toD);
    const cockpitProducts = await fetchCockpitProducts(fromD, toD);
    log.push(`  → ${Object.keys(cockpitServices).length} locations with service data`);

    const zohoClient = new ZohoBooksClient("spa");
    let totalUpserted = 0;

    let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (d <= toD) {
      const count = await runMonth(
        d.getFullYear(), d.getMonth() + 1,
        cockpitServices, cockpitProducts, zohoClient, force, log,
      );
      totalUpserted += count;
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    await logger.complete(totalUpserted);
    log.push(`Done — ${totalUpserted} total rows upserted.`);
    return { rowsUpserted: totalUpserted, log };
  } catch (e) {
    await logger.fail(String(e));
    throw e;
  }
}
