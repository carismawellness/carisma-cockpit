import { deleteWhere, insertRows } from "./supabase-etl";

const SHEET_ID = "1Mr_aRRbRf3ex--WmUJIqXwko7okCyD82KxBOXWYnW24";
const LOW_VAT_PERSONS = new Set(["francesca", "giovanni", "kendra"]);
const DEFAULT_VAT = 0.18;
const LOW_VAT     = 0.12;

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Google OAuth ──────────────────────────────────────────────────────────────

let cachedAccessToken: string | null = null;

async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken;
  const clientId     = process.env.GOOGLE_SHEETS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_SHEETS_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth credentials not set in env");
  }
  const params = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    "refresh_token",
  });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params,
  });
  if (!resp.ok) throw new Error(`Google token refresh failed: ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>;
  cachedAccessToken = data.access_token as string;
  return cachedAccessToken;
}

// ── Spreadsheet metadata: list all actual tab names ───────────────────────────

async function listTabNames(): Promise<string[]> {
  const token = await getGoogleAccessToken();
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`;
  const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  const data  = await resp.json() as { sheets?: Array<{ properties?: { title?: string } }> };
  return (data.sheets ?? []).map(s => s.properties?.title ?? "").filter(Boolean);
}

// ── Sheet fetch via Sheets API v4 ─────────────────────────────────────────────

// tabCandidates generates the naming patterns we look for; we match these
// case-insensitively against the spreadsheet's actual tab list.
function tabCandidates(year: number, month: number): string[] {
  const m  = MONTH_NAMES[month - 1];
  const yy = String(year).slice(2);
  return [
    `Sales ${m} ${yy}`,   // "Sales April 26"  ← current naming
    `Sale ${m} ${yy}`,    // "Sale April 26"
    `Sales ${m} ${year}`, // "Sales April 2026"
    `Sale ${m} ${year}`,  // "Sale April 2026"  ← old naming
  ];
}

async function fetchTab(tab: string): Promise<{ rows: Record<string, string>[]; headers: string[] } | null> {
  const token  = await getGoogleAccessToken();
  const range  = encodeURIComponent(`'${tab}'!A:Z`);
  const url    = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const resp   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const data   = await resp.json() as { values?: string[][] };
  const values = data.values ?? [];
  if (values.length < 2) return null;
  // Normalise headers to lowercase so lookups are case-insensitive
  const headers = values[0].map(h => h.trim().toLowerCase());
  const rows = values.slice(1).map(row => {
    const padded = [...row, ...Array(Math.max(0, headers.length - row.length)).fill("")];
    return Object.fromEntries(headers.map((h, i) => [h, padded[i] ?? ""]));
  });
  return { rows, headers };
}

async function fetchBestTab(
  year: number,
  month: number,
  log: string[],
  allTabs: string[],
): Promise<{ rows: Record<string, string>[]; tabName: string; headers: string[] } | null> {
  const candidates = tabCandidates(year, month);

  // Case-insensitive lookup against the spreadsheet's actual tab names.
  // This handles naming variations (casing, spacing) without guessing.
  function findActual(candidate: string): string | null {
    return allTabs.find(t => t.toLowerCase().trim() === candidate.toLowerCase().trim()) ?? null;
  }

  const PRICE_COLS = new Set(["price", "paid", "price sales", "total price", "amount"]);
  const hasPriceCol = (headers: string[]) => headers.some(h => PRICE_COLS.has(h));

  // First pass: prefer the tab that has a recognisable price column
  for (const candidate of candidates) {
    const actualTab = findActual(candidate);
    if (!actualTab) continue;
    const result = await fetchTab(actualTab);
    if (!result) continue;
    log.push(`  Found tab '${actualTab}' — columns: [${result.headers.join(", ")}]`);
    if (hasPriceCol(result.headers)) return { rows: result.rows, tabName: actualTab, headers: result.headers };
    log.push(`  (tab '${actualTab}' has no price column — checking next candidate)`);
  }

  // Second pass: fall back to the first matching tab that has any data
  for (const candidate of candidates) {
    const actualTab = findActual(candidate);
    if (!actualTab) continue;
    const result = await fetchTab(actualTab);
    if (result && result.rows.length) return { rows: result.rows, tabName: actualTab, headers: result.headers };
  }

  return null;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string, fallbackYear: number, fallbackMonth: number): string | null {
  raw = raw.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  if (!raw) return null;
  // YYYY-MM-DD (ISO)
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    try { return new Date(+m[1], +m[2] - 1, +m[3]).toISOString().slice(0, 10); } catch { /* */ }
  }
  // D/M/YYYY
  m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})$/);
  if (m) {
    try { return new Date(+m[3], +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ }
  }
  // D/M/YY (two-digit year)
  m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{2})$/);
  if (m) {
    try { return new Date(2000 + +m[3], +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ }
  }
  // D/M
  m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})$/);
  if (m) {
    try { return new Date(fallbackYear, +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ }
  }
  // day only
  m = raw.match(/^(\d{1,2})$/);
  if (m) {
    try { return new Date(fallbackYear, fallbackMonth - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ }
  }
  // "5 April [2026]" or "April 5 [2026]" (optional 2- or 4-digit year at end)
  for (let idx = 0; idx < MONTH_NAMES.length; idx++) {
    const mn = MONTH_NAMES[idx];
    const patterns = [
      new RegExp(`^${mn.slice(0, 3)}\\w*\\s+(\\d{1,2})(?:\\s+\\d{2,4})?`, "i"),
      new RegExp(`^(\\d{1,2})\\s+${mn.slice(0, 3)}\\w*(?:\\s+\\d{2,4})?`, "i"),
    ];
    for (const pat of patterns) {
      const mo = raw.match(pat);
      if (mo) {
        try { return new Date(fallbackYear, idx, +mo[1]).toISOString().slice(0, 10); } catch { /* */ }
      }
    }
  }
  return null;
}

// ── Row processor ─────────────────────────────────────────────────────────────

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) { const v = row[k]; if (v) return v.trim(); }
  return "";
}

const SUMMARY_PATTERN = /\b(total|totals|subtotal|sub-total|sum|grand total)\b/i;

function isSummaryText(s: string | null): boolean {
  return !!s && SUMMARY_PATTERN.test(s);
}

function processTab(tab: string, rawRows: Record<string, string>[], year: number, month: number): Record<string, unknown>[] {
  const monthKey = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const results: Record<string, unknown>[] = [];
  let lastDate: string | null = null;

  for (const row of rawRows) {
    const invoice     = col(row, "invoice")      || null;
    const customer    = col(row, "costumer", "customer") || null;
    const service     = col(row, "service / products", "service/products") || null;
    const dateRaw     = col(row, "date of service");
    const priceRaw    = col(row, "price", "paid", "price sales", "total price", "amount");
    const payment     = col(row, "payment")      || null;
    const salesStaff  = col(row, "sales staf", "sales staff") || null;
    const note        = col(row, "note");

    if (!priceRaw || priceRaw === "-") continue;
    const priceInc = Math.abs(parseFloat(priceRaw.replace(/[€$,]/g, "").trim()));
    if (!isFinite(priceInc) || priceInc === 0) continue;

    const notePerson = note.trim() || null;
    // Skip summary/totals rows
    if (isSummaryText(notePerson) || isSummaryText(customer) || isSummaryText(service)) continue;
    if (!customer && !service && !invoice) continue;

    const rate    = (notePerson && LOW_VAT_PERSONS.has(notePerson.toLowerCase())) ? LOW_VAT : DEFAULT_VAT;
    const priceEx = +(priceInc / (1 + rate)).toFixed(2);

    // Carry forward the last parsed date when the cell is blank or unparseable
    const parsed = parseDate(dateRaw, year, month);
    if (parsed) lastDate = parsed;
    const svcDate = lastDate;

    results.push({
      sheet_tab:       tab,
      month:           monthKey,
      date_of_service: svcDate,
      invoice,
      customer,
      service_product: service,
      price_inc_vat:   +priceInc.toFixed(2),
      vat_rate:        rate,
      price_ex_vat:    priceEx,
      payment_method:  payment,
      sales_staff:     salesStaff,
      note_person:     notePerson,
    });
  }
  return results;
}

// ── Date range helpers ────────────────────────────────────────────────────────

function monthsInRange(dateFrom: Date, dateTo: Date): [number, number][] {
  const months: [number, number][] = [];
  let y = dateFrom.getFullYear(), m = dateFrom.getMonth() + 1;
  const ey = dateTo.getFullYear(), em = dateTo.getMonth() + 1;
  while (y < ey || (y === ey && m <= em)) {
    months.push([y, m]);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runAestheticsSales(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; tabs: string[]; log: string[] }> {
  // Force a fresh OAuth token each run so stale cached tokens don't cause failures
  cachedAccessToken = null;

  const log: string[] = [];
  const months = monthsInRange(new Date(dateFrom), new Date(dateTo));
  let totalRows = 0;
  const processed: string[] = [];

  // Fetch the spreadsheet's actual tab names once so we can match case-insensitively
  const allTabs = await listTabNames();
  log.push(`Spreadsheet tabs: [${allTabs.join(", ")}]`);

  for (const [year, month] of months) {
    const label    = `${MONTH_NAMES[month - 1]} ${year}`;
    const monthKey = new Date(year, month - 1, 1).toISOString().slice(0, 10);
    log.push(`Fetching ${label}…`);
    const found = await fetchBestTab(year, month, log, allTabs);
    if (!found) { log.push(`  ${label}: no tab found — skipping`); continue; }
    const { rows: rawRows, tabName } = found;
    const rows = processTab(tabName, rawRows, year, month);
    if (!rows.length) { log.push(`  ${tabName}: 0 usable rows — skipping`); continue; }
    // Delete ALL rows for this month (regardless of tab name) so stale data
    // from any previously-used tab name is always replaced with fresh data.
    await deleteWhere("aesthetics_sales_daily", { month: monthKey });
    const n = await insertRows("aesthetics_sales_daily", rows);
    totalRows += n;
    processed.push(tabName);
    log.push(`  ${tabName}: ${n} rows inserted`);
  }

  log.push(`Done — ${totalRows} total rows inserted across ${processed.length} tab(s).`);
  return { rowsInserted: totalRows, tabs: processed, log };
}
