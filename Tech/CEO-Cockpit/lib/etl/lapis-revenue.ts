import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { ETLLogger } from "./etl-logger";

const SHEET_ID     = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";
const SERVICE_GID  = "683143306";
const PRODUCT_GID  = "1271322967";
const VAT_RATE     = 0.18;

const LAPIS_SPA_MAP: Record<string, number> = {
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

// ── CSV fetch (public Lapis sheet) ────────────────────────────────────────────

async function fetchLapisCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Lapis CSV fetch failed: ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  // The Lapis sheets prefix the data with a single-cell title row like
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

function parseLapisDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;
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

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }

// ── Lapis data fetch ──────────────────────────────────────────────────────────

async function fetchLapisServices(
  dateFrom: Date,
  dateTo: Date,
): Promise<Record<number, Record<string, number>>> {
  const rows   = await fetchLapisCsv(SERVICE_GID);
  const totals: Record<number, Record<string, number>> = {};

  for (const row of rows) {
    if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;
    const d = parseLapisDate(stripCol(row, "Service Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const locId = LAPIS_SPA_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) continue;
    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    const amountEx  = +(unitPrice / (1 + VAT_RATE)).toFixed(2);
    const mk        = monthKey(d);
    if (!totals[locId]) totals[locId] = {};
    totals[locId][mk] = (totals[locId][mk] ?? 0) + amountEx;
  }
  return totals;
}

async function fetchLapisProducts(
  dateFrom: Date,
  dateTo: Date,
): Promise<Record<number, Record<string, Record<string, number>>>> {
  const rows   = await fetchLapisCsv(PRODUCT_GID);
  const totals: Record<number, Record<string, Record<string, number>>> = {};

  for (const row of rows) {
    const d = parseLapisDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;
    const spa    = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const locId  = LAPIS_SPA_MAP[spa];
    if (locId === undefined) continue;
    const amount = safeFloat(stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "));
    if (amount <= 0) continue;
    const brand  = stripCol(row, "Brand").toUpperCase();
    const col2   = BRAND_MAP[brand] ?? "product_other";
    const mk     = monthKey(d);
    if (!totals[locId]) totals[locId] = {};
    if (!totals[locId][mk]) totals[locId][mk] = {};
    totals[locId][mk][col2] = (totals[locId][mk][col2] ?? 0) + amount;
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
  lapisServices: Record<number, Record<string, number>>,
  lapisProducts: Record<number, Record<string, Record<string, number>>>,
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
  for (const id of ALL_LOCATION_IDS) locServices[id] = lapisServices[id]?.[mk] ?? 0;

  const locProducts: Record<number, Record<string, number>> = {};
  for (const id of ALL_LOCATION_IDS) {
    const cols = lapisProducts[id]?.[mk] ?? {};
    locProducts[id] = {
      product_phytomer: cols.product_phytomer ?? 0,
      product_purest:   cols.product_purest   ?? 0,
      product_other:    cols.product_other     ?? 0,
    };
  }

  const allTarget = new Set([...WHOLESALE_ACCOUNTS, ...DISCOUNT_ACCOUNTS, ...REFUND_ACCOUNTS]);
  const zohoTotals = await fetchZohoRevenueAccounts(zohoClient, year, month, allTarget);

  const totalWholesale = [...WHOLESALE_ACCOUNTS].reduce((s, c) => s + Math.abs(zohoTotals[c] ?? 0), 0);
  const totalDiscount  = Math.abs(zohoTotals["20000"]  ?? 0);
  const totalRefund    = Math.abs(zohoTotals["SALREF"] ?? 0);

  const totalLapis = ALL_LOCATION_IDS.reduce(
    (s, id) => s + locServices[id] + Object.values(locProducts[id]).reduce((a, b) => a + b, 0),
    0,
  );

  const rows = ALL_LOCATION_IDS.map(id => {
    const locTotal = locServices[id] + Object.values(locProducts[id]).reduce((a, b) => a + b, 0);
    const ratio    = totalLapis > 0 ? locTotal / totalLapis : 1 / ALL_LOCATION_IDS.length;
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
      zoho_synced_at:   nowTs,
    };
  });

  const count = await upsert("spa_revenue_monthly", rows as Record<string, unknown>[], "location_id,month");
  const svcTotal  = ALL_LOCATION_IDS.reduce((s, id) => s + locServices[id], 0);
  const prodTotal = ALL_LOCATION_IDS.reduce((s, id) => s + Object.values(locProducts[id]).reduce((a, b) => a + b, 0), 0);
  log.push(`  ${mk}: services=€${svcTotal.toFixed(0)} products=€${prodTotal.toFixed(0)} wholesale=€${totalWholesale.toFixed(0)} → ${count} rows upserted`);
  return count;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runLapisRevenue(
  dateFrom: string,
  dateTo: string,
  force = false,
): Promise<{ rowsUpserted: number; log: string[] }> {
  const log: string[] = [];
  const logger = new ETLLogger("lapis_spa_revenue");
  await logger.start();

  try {
    const fromD = new Date(dateFrom);
    const toD   = new Date(dateTo);

    log.push("Fetching Lapis data (one-time fetch for full date range)…");
    const lapisServices = await fetchLapisServices(fromD, toD);
    const lapisProducts = await fetchLapisProducts(fromD, toD);
    log.push(`  → ${Object.keys(lapisServices).length} locations with service data`);

    const zohoClient = new ZohoBooksClient("spa");
    let totalUpserted = 0;

    let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (d <= toD) {
      const count = await runMonth(
        d.getFullYear(), d.getMonth() + 1,
        lapisServices, lapisProducts, zohoClient, force, log,
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
