// Per-venue / per-brand DAILY revenue feeds that come from Cockpit's
// authoritative sales sources (Lapis POS for SPA, Supabase POS tables for
// Aesthetics + Slimming). These are used by the "EBIDA Layer" daily ETL so
// the Zoho Raw Layer sheet contains revenue rows from BOTH Cockpit's sales
// pipeline AND Zoho's non-excluded revenue CoA accounts.
//
// IMPORTANT: this module is independent of lib/etl/lapis-revenue.ts (which
// rolls Lapis up to MONTHLY granularity for spa_revenue_monthly). Here we
// keep daily granularity and group by (date, venue).

import { ZohoBooksClient } from "./zoho-client";

// ── Lapis CSV (public Google Sheet, no auth) ────────────────────────────────

const LAPIS_SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";
const LAPIS_SERVICE_GID = "683143306";
const LAPIS_PRODUCT_GID = "1271322967";
const LAPIS_VAT_RATE = 0.18;

// Zoho CoA accounts that lapis-revenue.ts (Path A → spa_revenue_monthly, the
// AUTHORITATIVE Cockpit dashboard source) folds into SPA net revenue alongside
// the Lapis service+product figures. Mirrors WHOLESALE/DISCOUNT/REFUND_ACCOUNTS
// in lapis-revenue.ts exactly — keep in sync.
const LAPIS_WHOLESALE_ACCOUNTS = new Set(["506000", "506200", "506300"]);
const LAPIS_DISCOUNT_ACCOUNTS  = new Set(["20000"]);
const LAPIS_REFUND_ACCOUNTS    = new Set(["SALREF"]);

// Maps Lapis "Sales Point" / "Point of Sales" labels → Cockpit venue slug.
// (This is the inverse of LAPIS_SPA_MAP in lapis-revenue.ts, but keyed by
// slug directly so we never have to round-trip through the legacy 1-8 ID.)
const LAPIS_VENUE_TO_SLUG: Record<string, string> = {
  "HUGOS":                        "hugos",
  "INTER":                        "intercontinental",
  "RAMLA":                        "ramla",
  "SUNNY COAST":                  "sunny_coast",
  "SALES POINT OF EXCELSIOR":     "excelsior",
  "HYATT":                        "hyatt",
  "LABRANDA GENERAL SALES POINT": "labranda",
  "SALES POINT OF NOV":           "novotel",
};

// ── Generic CSV parsing (mirrors lapis-revenue.ts) ──────────────────────────

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      cells.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

async function fetchLapisCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = `https://docs.google.com/spreadsheets/d/${LAPIS_SHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Lapis CSV fetch failed: ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  // Skip the title row(s); find the first row with >=3 non-empty cells.
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

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

// Parses Lapis date strings into an ISO YYYY-MM-DD string (UTC-stable).
// Mirrors the formats lapis-revenue.ts handles: D/M/YYYY, D/M/YY, and a
// JS-native parser fallback.
function parseLapisDateIso(raw: string): string | null {
  raw = raw.trim();
  if (!raw) return null;
  const slash = raw.split("/");
  if (slash.length === 3) {
    const [d, m, y] = slash.map(s => s.trim());
    const dd = parseInt(d, 10);
    const mm = parseInt(m, 10);
    let yy = parseInt(y, 10);
    if (isFinite(dd) && isFinite(mm) && isFinite(yy)) {
      if (yy < 100) yy += 2000;
      const dt = new Date(Date.UTC(yy, mm - 1, dd));
      if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    }
  }
  const dt = new Date(raw);
  if (!isNaN(dt.getTime())) {
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()))
      .toISOString().slice(0, 10);
  }
  return null;
}

function withinWindow(iso: string, fromDate: string, toDate: string): boolean {
  return iso >= fromDate && iso <= toDate;
}

// ── Zoho P&L walk (mirrors lapis-revenue.ts fetchZohoRevenueAccounts) ────────

// Recursively collects `total` for any node whose account_code is in
// `targetCodes`. Identical traversal to lapis-revenue.ts walkPl().
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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Retries a Zoho call on rate-limit failures with linear back-off. Zoho returns
// HTTP 429 with messages like "too many requests continuously" when the daily
// request budget is hit or parallel calls saturate the org limit. Without this
// the EBIDA Layer would silently emit gross Lapis revenue (no wholesale/discount/
// refund applied) and diverge from spa_revenue_monthly.
async function withZohoRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [30_000, 60_000, 120_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e ?? "");
      const rateLimited =
        msg.includes("429") ||
        msg.toLowerCase().includes("too many requests") ||
        msg.toLowerCase().includes("rate limit");
      if (!rateLimited || attempt >= delays.length) throw e;
      const wait = delays[attempt];
      console.warn(`[${label}] Zoho rate-limited (attempt ${attempt + 1}/${delays.length + 1}), backing off ${wait / 1000}s…`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// Pulls the per-calendar-month NET Zoho adjustment that lapis-revenue.ts adds
// to SPA net revenue: + wholesale (506000/506200/506300) − discount (20000)
// − refund (SALREF). Path A always evaluates these over the FULL calendar
// month, so we do the same here regardless of the (possibly sub-month) window.
// Returns a map "YYYY-MM" → net adjustment (€, ex-VAT, can be negative).
async function fetchSpaZohoMonthlyAdjustment(
  months: string[],
): Promise<Record<string, number>> {
  const adj: Record<string, number> = {};
  const targetCodes = new Set([
    ...LAPIS_WHOLESALE_ACCOUNTS,
    ...LAPIS_DISCOUNT_ACCOUNTS,
    ...LAPIS_REFUND_ACCOUNTS,
  ]);
  const client = new ZohoBooksClient("spa");

  for (const ym of months) {
    const [yStr, mStr] = ym.split("-");
    const year  = Number(yStr);
    const month = Number(mStr);
    const lastD = daysInMonth(year, month);
    const data  = await withZohoRetry(`spa-pl-${ym}`, () => client.get("reports/profitandloss", {
      from_date:        `${ym}-01`,
      to_date:          `${ym}-${String(lastD).padStart(2, "0")}`,
      cash_based:       "false",
      comparison_value: "0",
    }));
    const totals: Record<string, number> = {};
    walkPl(data, targetCodes, totals);

    // Same sign convention as lapis-revenue.ts runMonth(): wholesale added,
    // discount + refund subtracted, all via Math.abs of the P&L total.
    const wholesale = [...LAPIS_WHOLESALE_ACCOUNTS].reduce((s, c) => s + Math.abs(totals[c] ?? 0), 0);
    const discount  = Math.abs(totals["20000"]  ?? 0);
    const refund    = Math.abs(totals["SALREF"] ?? 0);
    adj[ym] = wholesale - discount - refund;
  }
  return adj;
}

// ── SPA (Lapis) daily revenue per venue ─────────────────────────────────────

// Returns one row per (date, venue_slug) whose ex-VAT amounts SUM to the
// AUTHORITATIVE Cockpit dashboard figure (spa_revenue_monthly.net_revenue,
// built by lib/etl/lapis-revenue.ts — Path A).
//
// Path A's monthly net revenue is:
//     services + product_phytomer + product_purest + product_other   (Lapis)
//   + wholesale (Zoho 506000/506200/506300)
//   − sales_discount (Zoho 20000) − sales_refund (Zoho SALREF)
//
// We reproduce it identically, just kept at daily granularity:
//   1. Lapis service+product ex-VAT per (date, venue) — per-row service
//      rounding (`.toFixed(2)`) matches Path A exactly.
//   2. The Zoho wholesale/discount/refund NET adjustment is pulled per
//      calendar month (Path A's basis) and distributed across that month's
//      (date, venue) rows in proportion to each row's Lapis revenue, so the
//      per-day rows sum back to Path A's monthly net.
//
// Note: the Zoho wholesale/discount/refund CoA accounts are SPA-revenue CoA
// codes; they are NOT among the codes the zoho-line-extractor path treats as
// revenue for the EBIDA Layer (those flow through real invoice/creditnote
// lines), so folding them into LAPIS_REV here does not double-count.
export async function loadSpaCockpitRevenue(
  fromDate: string,
  toDate:   string,
): Promise<Array<{ date: string; venue_slug: string; amount: number }>> {
  // We need TWO views of Lapis revenue:
  //  • lapis      — per (date, venue) rows INSIDE the requested window (output)
  //  • monthTotal — per calendar-month TOTAL across the WHOLE month, even days
  //                 outside the window. This is the denominator for spreading
  //                 the Zoho adjustment: a sub-month window must receive only
  //                 its proportional slice of the month's adjustment, otherwise
  //                 summing N weekly windows applies the adjustment N times.
  const lapis: Map<string, number> = new Map();        // key = `${date}::${slug}` (in-window)
  const lapisMonthTotal: Record<string, number> = {};  // "YYYY-MM" → full-month Lapis revenue

  // The full calendar months the window touches — used to widen the month-total
  // scan beyond the window boundaries.
  const monthsTouched = new Set<string>();
  {
    const start = new Date(`${fromDate}T00:00:00Z`);
    const end   = new Date(`${toDate}T00:00:00Z`);
    const cur   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cur <= end) {
      monthsTouched.add(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  // Services CSV: "Service Date", "Sales Point", "Unit Price" (inc-VAT),
  // "Status" — only Given / Unplanned count.
  const svcRows = await fetchLapisCsv(LAPIS_SERVICE_GID);
  for (const row of svcRows) {
    const status = stripCol(row, "Status");
    if (status !== "Given" && status !== "Unplanned") continue;
    const iso = parseLapisDateIso(stripCol(row, "Service Date"));
    if (!iso) continue;
    const ym = iso.slice(0, 7);
    if (!monthsTouched.has(ym)) continue;
    const slug = LAPIS_VENUE_TO_SLUG[stripCol(row, "Sales Point")];
    if (!slug) continue;
    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    if (unitPrice === 0) continue;
    // Path A parity: each service line is rounded to 2dp ex-VAT before summing
    // (lapis-revenue.ts: `+(unitPrice / (1 + VAT_RATE)).toFixed(2)`).
    const amountEx = Math.round((unitPrice / (1 + LAPIS_VAT_RATE)) * 100) / 100;
    lapisMonthTotal[ym] = (lapisMonthTotal[ym] ?? 0) + amountEx;
    if (withinWindow(iso, fromDate, toDate)) {
      const key = `${iso}::${slug}`;
      lapis.set(key, (lapis.get(key) ?? 0) + amountEx);
    }
  }

  // Products CSV: "Date", "Point of Sales", "VAT Exclusive Amount".
  const prodRows = await fetchLapisCsv(LAPIS_PRODUCT_GID);
  for (const row of prodRows) {
    const iso = parseLapisDateIso(stripCol(row, "Date"));
    if (!iso) continue;
    const ym = iso.slice(0, 7);
    if (!monthsTouched.has(ym)) continue;
    const spaName = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const slug = LAPIS_VENUE_TO_SLUG[spaName];
    if (!slug) continue;
    const amount = safeFloat(
      stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "),
    );
    if (amount <= 0) continue;
    lapisMonthTotal[ym] = (lapisMonthTotal[ym] ?? 0) + amount;
    if (withinWindow(iso, fromDate, toDate)) {
      const key = `${iso}::${slug}`;
      lapis.set(key, (lapis.get(key) ?? 0) + amount);
    }
  }

  // Pull the Zoho wholesale/discount/refund NET adjustment per month. The
  // call has its own rate-limit retry (withZohoRetry); we deliberately do NOT
  // swallow exceptions here. Silently falling back to Lapis-only emits gross
  // revenue and diverges from spa_revenue_monthly — better to surface the
  // failure so the chunk runner retries the whole window.
  const zohoAdj: Record<string, number> = await fetchSpaZohoMonthlyAdjustment([...monthsTouched]);

  const out: Array<{ date: string; venue_slug: string; amount: number }> = [];
  for (const [key, lapisAmount] of lapis.entries()) {
    const [date, venue_slug] = key.split("::");
    const ym       = key.slice(0, 7);
    const monthSum = lapisMonthTotal[ym] ?? 0;
    const adj      = zohoAdj[ym] ?? 0;
    // Distribute the month's net Zoho adjustment in proportion to this
    // (date, venue) row's share of the WHOLE month's Lapis revenue. A
    // sub-month window therefore receives only its slice — summing all
    // windows of a month reproduces Path A's monthly net exactly.
    const share  = monthSum > 0 ? lapisAmount / monthSum : 0;
    const amount = lapisAmount + adj * share;
    const rounded = Math.round(amount * 100) / 100;
    if (rounded === 0) continue;
    out.push({ date, venue_slug, amount: rounded });
  }
  out.sort((a, b) =>
    a.date.localeCompare(b.date) || a.venue_slug.localeCompare(b.venue_slug),
  );
  return out;
}

// ── Aesthetics + Slimming daily revenue (Supabase POS tables) ───────────────

function supabaseEnv(): { base: string; key: string } | null {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  return { base, key };
}

// Pulls a (date_of_service, price_ex_vat) projection out of a Supabase POS
// table for the given window. Used by AES + both SLIM tables.
async function fetchSupabasePosDaily(
  table: string,
  fromDate: string,
  toDate:   string,
): Promise<Array<{ date_of_service: string; price_ex_vat: number }>> {
  const env = supabaseEnv();
  if (!env) return [];
  const qs = new URLSearchParams({
    select:          "date_of_service,price_ex_vat",
    date_of_service: `gte.${fromDate}`,
  });
  // PostgREST permits repeating the same column with multiple operators.
  qs.append("date_of_service", `lte.${toDate}`);
  qs.append("date_of_service", "not.is.null");

  const resp = await fetch(`${env.base}/rest/v1/${table}?${qs}`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase select ${table} failed ${resp.status}: ${text}`);
  }
  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  return rows
    .map(r => ({
      date_of_service: String(r.date_of_service ?? ""),
      price_ex_vat:    Number(r.price_ex_vat ?? 0),
    }))
    .filter(r => r.date_of_service);
}

function groupDailySum(
  rows: Array<{ date_of_service: string; price_ex_vat: number }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!isFinite(r.price_ex_vat) || r.price_ex_vat === 0) continue;
    // Defensive: date_of_service may come back as full ISO timestamp or just
    // the date — normalise to YYYY-MM-DD.
    const date = r.date_of_service.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.set(date, (out.get(date) ?? 0) + r.price_ex_vat);
  }
  return out;
}

function mapToSortedRows(
  m: Map<string, number>,
): Array<{ date: string; amount: number }> {
  const out: Array<{ date: string; amount: number }> = [];
  for (const [date, amount] of m.entries()) {
    const rounded = Math.round(amount * 100) / 100;
    if (rounded === 0) continue;
    out.push({ date, amount: rounded });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// Daily ex-VAT revenue for the Aesthetics brand.
export async function loadAesthCockpitRevenue(
  fromDate: string,
  toDate:   string,
): Promise<Array<{ date: string; amount: number }>> {
  const rows = await fetchSupabasePosDaily("aesthetics_sales_daily", fromDate, toDate);
  return mapToSortedRows(groupDailySum(rows));
}

// Daily ex-VAT revenue for the Slimming brand (sales + treatments combined).
export async function loadSlimCockpitRevenue(
  fromDate: string,
  toDate:   string,
): Promise<Array<{ date: string; amount: number }>> {
  const [salesRows, trtRows] = await Promise.all([
    fetchSupabasePosDaily("slimming_sales_daily",      fromDate, toDate),
    fetchSupabasePosDaily("slimming_treatments_daily", fromDate, toDate),
  ]);
  const combined = groupDailySum([...salesRows, ...trtRows]);
  return mapToSortedRows(combined);
}
