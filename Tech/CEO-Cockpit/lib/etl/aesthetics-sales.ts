import { deleteWhere, insertRows } from "./supabase-etl";
import { parseCSV } from "./csv";
import { cockpitCsvUrl, COCKPIT_TABS } from "../constants/cockpit-sheets";

const LOW_VAT_PERSONS = new Set(["francesca", "giovanni", "kendra"]);
const DEFAULT_VAT = 0.18;
const LOW_VAT     = 0.12;

// ── CSV helpers ───────────────────────────────────────────────────────────────

async function fetchCockpitCsv(): Promise<Record<string, string>[]> {
  const url = cockpitCsvUrl(COCKPIT_TABS.AESTHETICS.gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = rows[headerIdx].map(h => h.trim().toLowerCase());
  return rows.slice(headerIdx + 1).map(cells =>
    Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]))
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(raw: string): string | null {
  raw = raw.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{4})$/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  m = raw.match(/^(\d{1,2})[/\-.\\](\d{1,2})[/\-.\\](\d{2})$/);
  if (m) {
    const d = new Date(2000 + +m[3], +m[2] - 1, +m[1]);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k.toLowerCase()] ?? row[`${k.toLowerCase()} `];
    if (v?.trim()) return v.trim();
  }
  return "";
}

function monthsInRange(fromDate: string, toDate: string): Set<string> {
  const months = new Set<string>();
  const [fy, fm] = fromDate.split("-").map(Number);
  const [ty, tm] = toDate.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.add(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

const SUMMARY_RE = /\b(total|totals|subtotal|sub-total|sum|grand total)\b/i;

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runAestheticsSales(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; log: string[] }> {
  const log: string[] = [];
  const allRows = await fetchCockpitCsv();
  log.push(`Fetched ${allRows.length} raw rows from Cockpit Aesthetics tab`);

  const validMonths = monthsInRange(dateFrom, dateTo);
  const buckets = new Map<string, Record<string, unknown>[]>();
  let lastDate: string | null = null;

  for (const row of allRows) {
    const dateRaw    = col(row, "date of service");
    const priceRaw   = col(row, "price", "paid", "price sales", "total price", "amount");
    const invoice    = col(row, "invoice")                              || null;
    const customer   = col(row, "costumer", "customer")                 || null;
    const service    = col(row, "service / products", "service/products") || null;
    const payment    = col(row, "payment", "payment type")              || null;
    const salesStaff = col(row, "sales staf", "sales staff")           || null;
    const notePerson = col(row, "employee", "note")                    || null;

    if (!priceRaw || priceRaw === "-") continue;
    // Preserve the sign — negative rows are refunds and must net against revenue.
    const priceInc = parseFloat(priceRaw.replace(/[€$,]/g, "").trim());
    if (!isFinite(priceInc) || priceInc === 0) continue;
    if (SUMMARY_RE.test(notePerson ?? "") || SUMMARY_RE.test(customer ?? "") || SUMMARY_RE.test(service ?? "")) continue;
    if (!customer && !service && !invoice) continue;

    const parsed = parseDate(dateRaw);
    if (parsed) lastDate = parsed;
    if (!lastDate) continue;

    const monthKey = `${lastDate.slice(0, 7)}-01`;
    if (!validMonths.has(monthKey)) continue;

    const rate    = (notePerson && LOW_VAT_PERSONS.has(notePerson.toLowerCase())) ? LOW_VAT : DEFAULT_VAT;
    const priceEx = +(priceInc / (1 + rate)).toFixed(2);

    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey)!.push({
      sheet_tab:       COCKPIT_TABS.AESTHETICS.name,
      month:           monthKey,
      date_of_service: lastDate,
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

  let totalRows = 0;
  for (const [monthKey, rows] of buckets) {
    await deleteWhere("aesthetics_sales_daily", { month: monthKey });
    const n = await insertRows("aesthetics_sales_daily", rows);
    totalRows += n;
    const exTotal = rows.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`  ${monthKey}: ${n} rows — €${exTotal.toFixed(2)} ex-VAT`);
  }

  log.push(`Done — ${totalRows} total rows across ${buckets.size} month(s).`);
  return { rowsInserted: totalRows, log };
}
