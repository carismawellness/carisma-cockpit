import { deleteWhere, insertRows } from "./supabase-etl";
import { lapisCsvUrl, LAPIS_TABS } from "../constants/lapis-sheets";

const LOW_VAT_PERSONS = new Set(["francesca", "giovanni", "kendra"]);
const DEFAULT_VAT = 0.18;
const LOW_VAT     = 0.12;

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

async function fetchLapisCsv(): Promise<Record<string, string>[]> {
  const url = lapisCsvUrl(LAPIS_TABS.AESTHETICS.gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status}`);
  const text = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (parseCSVRow(lines[i]).filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = parseCSVRow(lines[headerIdx]).map(h => h.trim().toLowerCase());
  return lines.slice(headerIdx + 1).map(line => {
    const cells = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
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
  const allRows = await fetchLapisCsv();
  log.push(`Fetched ${allRows.length} raw rows from Lapis Aesthetics tab`);

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
    const priceInc = Math.abs(parseFloat(priceRaw.replace(/[€$,]/g, "").trim()));
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
      sheet_tab:       LAPIS_TABS.AESTHETICS.name,
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
