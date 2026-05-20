// Per-venue / per-brand DAILY revenue feeds that come from Cockpit's
// authoritative sales sources (Lapis POS for SPA, Supabase POS tables for
// Aesthetics + Slimming). These are used by the "EBIDA Layer" daily ETL so
// the Zoho Raw Layer sheet contains revenue rows from BOTH Cockpit's sales
// pipeline AND Zoho's non-excluded revenue CoA accounts.
//
// IMPORTANT: this module is independent of lib/etl/lapis-revenue.ts (which
// rolls Lapis up to MONTHLY granularity for spa_revenue_monthly). Here we
// keep daily granularity and group by (date, venue).

// ── Lapis CSV (public Google Sheet, no auth) ────────────────────────────────

const LAPIS_SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";
const LAPIS_SERVICE_GID = "683143306";
const LAPIS_PRODUCT_GID = "1271322967";
const LAPIS_VAT_RATE = 0.18;

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

// ── SPA (Lapis) daily revenue per venue ─────────────────────────────────────

// Returns one row per (date, venue_slug) with the ex-VAT net revenue from
// Lapis. Net revenue = services + products (both ex-VAT). Discounts and
// refunds are NOT subtracted here — those live on Zoho CoA accounts and are
// already pulled by the zoho-line-extractor path in zoho-transactions-daily.
// Subtracting them here would double-count.
export async function loadSpaCockpitRevenue(
  fromDate: string,
  toDate:   string,
): Promise<Array<{ date: string; venue_slug: string; amount: number }>> {
  const acc: Map<string, number> = new Map(); // key = `${date}::${slug}`

  // Services CSV: "Service Date", "Sales Point", "Unit Price" (inc-VAT),
  // "Status" — only Given / Unplanned count.
  const svcRows = await fetchLapisCsv(LAPIS_SERVICE_GID);
  for (const row of svcRows) {
    const status = stripCol(row, "Status");
    if (status !== "Given" && status !== "Unplanned") continue;
    const iso = parseLapisDateIso(stripCol(row, "Service Date"));
    if (!iso || !withinWindow(iso, fromDate, toDate)) continue;
    const slug = LAPIS_VENUE_TO_SLUG[stripCol(row, "Sales Point")];
    if (!slug) continue;
    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    if (unitPrice === 0) continue;
    const amountEx = unitPrice / (1 + LAPIS_VAT_RATE);
    const key = `${iso}::${slug}`;
    acc.set(key, (acc.get(key) ?? 0) + amountEx);
  }

  // Products CSV: "Date", "Point of Sales", "VAT Exclusive Amount".
  const prodRows = await fetchLapisCsv(LAPIS_PRODUCT_GID);
  for (const row of prodRows) {
    const iso = parseLapisDateIso(stripCol(row, "Date"));
    if (!iso || !withinWindow(iso, fromDate, toDate)) continue;
    const spaName = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const slug = LAPIS_VENUE_TO_SLUG[spaName];
    if (!slug) continue;
    const amount = safeFloat(
      stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "),
    );
    if (amount <= 0) continue;
    const key = `${iso}::${slug}`;
    acc.set(key, (acc.get(key) ?? 0) + amount);
  }

  const out: Array<{ date: string; venue_slug: string; amount: number }> = [];
  for (const [key, amount] of acc.entries()) {
    const [date, venue_slug] = key.split("::");
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
