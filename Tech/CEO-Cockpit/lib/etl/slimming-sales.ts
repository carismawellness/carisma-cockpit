import { deleteWhere, insertRows } from "./supabase-etl";
import { parseCSV, assertCockpitHeaders, assertNonZeroOutput } from "./csv";
import { cockpitCsvUrl, COCKPIT_TABS } from "../constants/cockpit-sheets";
import { ETLLogger } from "./etl-logger";

const REQUIRED_HEADERS = ["Date", "Client", "Full price", "Paid", "Employee"] as const;

const VAT_RATE = 0.18;

// ── CSV helpers ───────────────────────────────────────────────────────────────

async function fetchCockpitCsv(): Promise<Record<string, string>[]> {
  const url = cockpitCsvUrl(COCKPIT_TABS.SLM_SALES.name);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status}`);
  const text = await resp.text();
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  assertCockpitHeaders(rows, COCKPIT_TABS.SLM_SALES.name, REQUIRED_HEADERS);
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
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
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

function parsePrice(raw: string): number | null {
  if (!raw || /^[-—]$/.test(raw.trim())) return null;
  const val = parseFloat(raw.replace(/[€$£,]/g, "").trim());
  // Negative values are refunds — carry them through so downstream SUMs net them.
  return isFinite(val) ? val : null;
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

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runSlimmingSales(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; log: string[] }> {
  // Observability wrapper — records start/success/fail to etl_sync_log
  // (log key "slimming_sales"). Data logic lives in the inner function.
  const logger = new ETLLogger("slimming_sales");
  await logger.start();
  try {
    const result = await runSlimmingSalesInner(dateFrom, dateTo);
    await logger.complete(result.rowsInserted);
    return result;
  } catch (err) {
    await logger.fail(String(err));
    throw err;
  }
}

async function runSlimmingSalesInner(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; log: string[] }> {
  const log: string[] = [];
  const allRows = await fetchCockpitCsv();
  log.push(`Fetched ${allRows.length} raw rows from Cockpit SLM_SALES tab`);

  const validMonths = monthsInRange(dateFrom, dateTo);
  const buckets = new Map<string, Record<string, unknown>[]>();
  let lastDate: string | null = null;

  for (const row of allRows) {
    const dateRaw   = col(row, "date");
    const priceRaw  = col(row, "paid");
    const client    = col(row, "client")                       || null;
    const therapist = col(row, "sale of", "therapist", "employee") || null;

    // Col D = "treatments", Col C = "weight loss"; D takes precedence when non-empty
    const colTreatments = col(row, "treatments");
    const colWeightLoss = col(row, "weight loss");
    const colMedical    = col(row, "medical consultation");
    const colProducts   = col(row, "products");

    let serviceType: string;
    let descr: string | null;
    if (colTreatments) {
      serviceType = "treatment";
      descr = colTreatments;
    } else if (colWeightLoss) {
      serviceType = "weight_loss";
      descr = colWeightLoss;
    } else if (colMedical) {
      serviceType = "medical";
      descr = colMedical;
    } else if (colProducts) {
      serviceType = "product";
      descr = colProducts;
    } else {
      serviceType = "unknown";
      descr = null;
    }

    // Skip totals/commission rows: no client, no programme AND no paid amount
    if (!client && !descr && !parsePrice(priceRaw)) continue;
    if (therapist && /total/i.test(therapist)) continue;

    const paid = parsePrice(priceRaw);
    if (paid === null && !descr) continue;
    const revenue = paid ?? 0;

    const parsed = parseDate(dateRaw);
    if (parsed) lastDate = parsed;
    if (!lastDate) continue;

    const monthKey = `${lastDate.slice(0, 7)}-01`;
    if (!validMonths.has(monthKey)) continue;

    const priceEx = +(revenue / (1 + VAT_RATE)).toFixed(2);

    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey)!.push({
      sheet_tab:           COCKPIT_TABS.SLM_SALES.name,
      month:               monthKey,
      date_of_service:     lastDate,
      client,
      service_type:        serviceType,
      service_description: descr,
      full_price:          +revenue.toFixed(2),
      paid:                +revenue.toFixed(2),
      vat_rate:            VAT_RATE,
      price_ex_vat:        priceEx,
      sales_staff:         therapist,
    });
  }

  let totalRows = 0;
  for (const [monthKey, rows] of buckets) {
    await deleteWhere("slimming_sales_daily", { month: monthKey });
    const n = await insertRows("slimming_sales_daily", rows);
    totalRows += n;
    const exTotal = rows.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`  ${monthKey}: ${n} rows — €${exTotal.toFixed(2)} ex-VAT`);
  }

  log.push(`Done — ${totalRows} total rows across ${buckets.size} month(s).`);

  assertNonZeroOutput(
    allRows.length,
    totalRows,
    COCKPIT_TABS.SLM_SALES.name,
    "all rows skipped via inline continue — check date format, price column, summary regex",
  );

  return { rowsInserted: totalRows, log };
}
