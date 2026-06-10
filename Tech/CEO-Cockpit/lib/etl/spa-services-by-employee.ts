import { deleteWhere, insertRows } from "./supabase-etl";
import { parseCSV } from "./csv";
import { cockpitCsvUrl, COCKPIT_TABS } from "../constants/cockpit-sheets";
import { ETLLogger } from "./etl-logger";

const VAT_RATE = 0.18;

// Spa Sales Point → location_id. Copied verbatim from `spa-revenue.ts`
// (COCKPIT_SPA_LOCATION_MAP). Do not refactor — see task spec.
const SPA_LOC_MAP: Record<string, number> = {
  "HUGOS": 2, "INTER": 1, "RAMLA": 4, "SUNNY COAST": 6,
  "SALES POINT OF EXCELSIOR": 7, "HYATT": 3,
  "LABRANDA GENERAL SALES POINT": 5, "SALES POINT OF NOV": 8,
};

// ── CSV helpers ───────────────────────────────────────────────────────────────

async function fetchCockpitCsv(): Promise<Record<string, string>[]> {
  const url  = cockpitCsvUrl(COCKPIT_TABS.SPA_SERVICES.gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status} — check sheet is shared as "Anyone with the link can view"`);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  // Cockpit sheets prefix data with a title row like "Service data is from…".
  // Find the first row with ≥3 non-empty cells — that's the real header row.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const nonEmpty = rows[i].filter(c => c.trim()).length;
    if (nonEmpty >= 3) { headerIdx = i; break; }
  }
  // Preserve original header case so `stripCol` exact-name lookup works
  // (header keys like "Service Name" or "Unit Price"); tolerate trailing
  // spaces via the `${key} ` fallback inside stripCol.
  const headers = rows[headerIdx];
  return rows.slice(headerIdx + 1).map(cells =>
    Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]))
  );
}

// ── Date / value helpers ──────────────────────────────────────────────────────

// Copied from spa-revenue.ts — handles both "4 June 2026" and "D/M/YYYY"/"D/M/YY".
const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseCockpitDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;

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

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/[€$£,\s]/g, "").trim() || "0") || 0;
}

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
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

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runSpaServicesByEmployee(
  dateFrom: string,
  dateTo:   string,
): Promise<{ rowsInserted: number; log: string[] }> {
  // Observability wrapper — records start/success/fail to etl_sync_log
  // (log key "spa_services_by_employee"). Data logic lives in the inner function.
  const logger = new ETLLogger("spa_services_by_employee");
  await logger.start();
  try {
    const result = await runSpaServicesByEmployeeInner(dateFrom, dateTo);
    await logger.complete(result.rowsInserted);
    return result;
  } catch (err) {
    await logger.fail(String(err));
    throw err;
  }
}

async function runSpaServicesByEmployeeInner(
  dateFrom: string,
  dateTo:   string,
): Promise<{ rowsInserted: number; log: string[] }> {
  const log: string[] = [];
  const allRows = await fetchCockpitCsv();
  log.push(`Fetched ${allRows.length} raw rows from Cockpit "${COCKPIT_TABS.SPA_SERVICES.name}" tab`);

  const validMonths = monthsInRange(dateFrom, dateTo);
  const buckets = new Map<string, Record<string, unknown>[]>();

  let skipStatus     = 0;
  let skipCarisma    = 0;
  let skipEmployee   = 0;
  let skipBadDate    = 0;
  let skipUnknownLoc = 0;
  let skipBadPrice   = 0;
  let skipOutOfRange = 0;
  const badDateSamples: string[] = [];

  for (const row of allRows) {
    const status = stripCol(row, "Status");
    if (!["Given", "Unplanned"].includes(status)) { skipStatus++; continue; }

    const employee = stripCol(row, "Employee(s)");
    if (!employee) { skipEmployee++; continue; }
    if (employee.toUpperCase() === "CARISMA (SALES)") { skipCarisma++; continue; }

    const dateRaw = stripCol(row, "Service Date");
    const d = parseCockpitDate(dateRaw);
    if (!d) {
      skipBadDate++;
      if (badDateSamples.length < 3 && dateRaw) badDateSamples.push(dateRaw);
      continue;
    }

    const locId = SPA_LOC_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) { skipUnknownLoc++; continue; }

    const unitPrice = safeFloat(stripCol(row, "Unit Price"));
    if (unitPrice <= 0) { skipBadPrice++; continue; }

    const dateStr  = dateKey(d);
    const monthKey = `${dateStr.slice(0, 7)}-01`;
    if (!validMonths.has(monthKey)) { skipOutOfRange++; continue; }

    const priceEx     = +(unitPrice / (1 + VAT_RATE)).toFixed(2);
    const serviceName = stripCol(row, "Service Name") || null;

    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey)!.push({
      month:           monthKey,
      date_of_service: dateStr,
      location_id:     locId,
      employee_name:   employee,
      service_name:    serviceName,
      price_ex_vat:    priceEx,
    });
  }

  const badDateSuffix = badDateSamples.length
    ? ` (samples: ${badDateSamples.map(s => `"${s}"`).join(", ")})`
    : "";
  log.push(
    `Skips — status:${skipStatus} carisma_sales:${skipCarisma} empty_employee:${skipEmployee} ` +
    `bad_date:${skipBadDate}${badDateSuffix} unknown_location:${skipUnknownLoc} bad_price:${skipBadPrice} ` +
    `out_of_range:${skipOutOfRange}`,
  );

  let totalRows = 0;
  for (const [monthKey, rows] of buckets) {
    await deleteWhere("spa_services_by_employee_daily", { month: monthKey });
    const n = await insertRows("spa_services_by_employee_daily", rows);
    totalRows += n;
    const exTotal = rows.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`  ${monthKey}: ${n} rows — €${exTotal.toFixed(2)} ex-VAT`);
  }

  log.push(`Done — ${totalRows} total rows across ${buckets.size} month(s).`);
  return { rowsInserted: totalRows, log };
}
