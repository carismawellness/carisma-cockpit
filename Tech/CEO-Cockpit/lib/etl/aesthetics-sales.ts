import { deleteWhere, insertRows } from "./supabase-etl";

const SHEET_ID = "1Mr_aRRbRf3ex--WmUJIqXwko7okCyD82KxBOXWYnW24";
const LOW_VAT_PERSONS = new Set(["francesca", "giovanni"]);
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

// ── Sheet fetch via Sheets API v4 ─────────────────────────────────────────────

function tabNameFor(year: number, month: number): string {
  return `Sale ${MONTH_NAMES[month - 1]} ${year}`;
}

async function fetchTab(tab: string): Promise<Record<string, string>[]> {
  const token  = await getGoogleAccessToken();
  const range  = encodeURIComponent(`'${tab}'!A:Z`);
  const url    = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const resp   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(`Sheets API error ${resp.status} for tab ${tab}`);
  const data   = await resp.json() as { values?: string[][] };
  const values = data.values ?? [];
  if (values.length < 2) return [];
  // Normalise headers to lowercase so lookups are case-insensitive
  const headers = values[0].map(h => h.trim().toLowerCase());
  return values.slice(1).map(row => {
    const padded = [...row, ...Array(Math.max(0, headers.length - row.length)).fill("")];
    return Object.fromEntries(headers.map((h, i) => [h, padded[i] ?? ""]));
  });
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string, fallbackYear: number, fallbackMonth: number): string | null {
  raw = raw.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  // D/M/YYYY
  let m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})$/);
  if (m) {
    try { return new Date(+m[3], +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ }
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
  // "5 April" or "April 5"
  for (let idx = 0; idx < MONTH_NAMES.length; idx++) {
    const mn = MONTH_NAMES[idx];
    const patterns = [
      new RegExp(`^${mn.slice(0, 3)}\\w*\\s+(\\d{1,2})`, "i"),
      new RegExp(`^(\\d{1,2})\\s+${mn.slice(0, 3)}\\w*`, "i"),
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

function processTab(tab: string, rawRows: Record<string, string>[], year: number, month: number): Record<string, unknown>[] {
  const monthKey = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const results: Record<string, unknown>[] = [];

  for (const row of rawRows) {
    const invoice     = col(row, "invoice")      || null;
    const customer    = col(row, "costumer", "customer") || null;
    const service     = col(row, "service / products", "service/products") || null;
    const dateRaw     = col(row, "date of service");
    const priceRaw    = col(row, "paid");
    const payment     = col(row, "payment")      || null;
    const salesStaff  = col(row, "sales staf", "sales staff") || null;
    const note        = col(row, "note");

    if (!priceRaw || priceRaw === "-") continue;
    const priceInc = Math.abs(parseFloat(priceRaw.replace(/[€$,]/g, "").trim()));
    if (!isFinite(priceInc) || priceInc === 0) continue;

    const notePerson = note.trim() || null;
    if (notePerson?.toLowerCase() === "total") continue;
    if (!customer && !service && !invoice) continue;

    const rate    = (notePerson && LOW_VAT_PERSONS.has(notePerson.toLowerCase())) ? LOW_VAT : DEFAULT_VAT;
    const priceEx = +(priceInc / (1 + rate)).toFixed(2);
    const svcDate = parseDate(dateRaw, year, month);

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
  const log: string[] = [];
  const months = monthsInRange(new Date(dateFrom), new Date(dateTo));
  let totalRows = 0;
  const processed: string[] = [];

  for (const [year, month] of months) {
    const tab = tabNameFor(year, month);
    log.push(`Fetching ${tab}…`);
    const rawRows = await fetchTab(tab);
    if (!rawRows.length) { log.push(`  ${tab}: not found or empty — skipping`); continue; }
    if (rawRows[0]) log.push(`  ${tab}: columns = [${Object.keys(rawRows[0]).join(", ")}]`);
    const rows = processTab(tab, rawRows, year, month);
    if (!rows.length) { log.push(`  ${tab}: 0 usable rows — skipping`); continue; }
    await deleteWhere("aesthetics_sales_daily", { sheet_tab: tab });
    const n = await insertRows("aesthetics_sales_daily", rows);
    totalRows += n;
    processed.push(tab);
    log.push(`  ${tab}: ${n} rows inserted`);
  }

  log.push(`Done — ${totalRows} total rows inserted across ${processed.length} tab(s).`);
  return { rowsInserted: totalRows, tabs: processed, log };
}
