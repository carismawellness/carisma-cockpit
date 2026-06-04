import { deleteWhere, insertRows } from "./supabase-etl";

const SHEET_ID = "1j6tz8k8TRSulB35Sg4X1xSlcV_JLf-8QKx-32UUkoBc";
const VAT_RATE  = 0.18;
const PRICE_COL = "paid";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Tab name candidates ───────────────────────────────────────────────────────

function tabNamesForMonth(year: number, month: number): string[] {
  const m  = MONTH_NAMES[month - 1];
  const yy = String(year).slice(2);
  return [
    `Sales ${m} ${yy}`,
    `Sales ${m} ${year}`,
    `Sales ${m.toLowerCase()} ${yy}`,
    `Sales ${m.toUpperCase()} ${yy}`,
  ];
}

// ── Sheet fetch via gviz CSV endpoint (public sheet, no auth) ─────────────────

async function fetchByName(tabName: string): Promise<{ headers: string[]; dataRows: string[][] } | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  try {
    const resp = await fetch(url);
    if (resp.status === 400 || resp.status === 404) return null;
    if (!resp.ok) return null;
    const text = await resp.text();
    const rows  = parseCSV(text);
    if (!rows.length) return null;
    const headers = rows[0].map(h => h.trim());
    // Guard: gviz silently returns first sheet when name doesn't match
    if (!headers.some(h => h.toLowerCase() === PRICE_COL)) return null;
    return { headers, dataRows: rows.slice(1) };
  } catch {
    return null;
  }
}

// Minimal CSV parser for Sheets export (handles quoted fields)
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
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
    rows.push(cells);
  }
  return rows;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string, targetMonth?: number): string | null {
  raw = raw.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const tryBoth = (a: number, b: number, y: number): string | null => {
    // Try D/M first, then M/D — prefer the one whose month matches targetMonth.
    const dmDate = (a >= 1 && b >= 1 && b <= 12 && a <= 31)
      ? new Date(y, b - 1, a) : null;
    const mdDate = (b >= 1 && a >= 1 && a <= 12 && b <= 31)
      ? new Date(y, a - 1, b) : null;
    if (targetMonth) {
      if (dmDate && dmDate.getMonth() + 1 === targetMonth) return dmDate.toISOString().slice(0, 10);
      if (mdDate && mdDate.getMonth() + 1 === targetMonth) return mdDate.toISOString().slice(0, 10);
    }
    // No target month — fall back to D/M (European default)
    if (dmDate && !isNaN(dmDate.getTime())) return dmDate.toISOString().slice(0, 10);
    if (mdDate && !isNaN(mdDate.getTime())) return mdDate.toISOString().slice(0, 10);
    return null;
  };
  // YYYY-MM-DD (ISO)
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) { try { return new Date(+m[1], +m[2] - 1, +m[3]).toISOString().slice(0, 10); } catch { /**/ } }
  // N/N/YYYY
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) { const r = tryBoth(+m[1], +m[2], +m[3]); if (r) return r; }
  // N/N/YY
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (m) { const r = tryBoth(+m[1], +m[2], 2000 + +m[3]); if (r) return r; }
  return null;
}

function parsePrice(raw: string): number | null {
  if (!raw || /^[-—]$/.test(raw.trim())) return null;
  const cleaned = raw.replace(/[€$£,]/g, "").trim();
  const val = parseFloat(cleaned);
  return isFinite(val) && val >= 0 ? val : null;
}

// ── Row processor ─────────────────────────────────────────────────────────────

// First-match-wins lookup. Some Sales tabs have a duplicate "Sale of" header
// (col I + col J in Apr 26). Object.fromEntries would pick the LAST one (empty).
function makeColFn(headers: string[], row: string[]) {
  const norm = headers.map(h => h.toLowerCase().trim());
  return (...keys: string[]) => {
    for (const k of keys) {
      const target = k.toLowerCase().trim();
      const i = norm.findIndex(h => h === target);
      if (i !== -1 && i < row.length && row[i].trim()) return row[i].trim();
    }
    return "";
  };
}

function processRows(
  tabName: string,
  headers: string[],
  dataRows: string[][],
  year: number,
  month: number,
): Record<string, unknown>[] {
  const monthKey  = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const results: Record<string, unknown>[] = [];
  let lastDate: string | null = null;

  for (const row of dataRows) {
    const col = makeColFn(headers, row);

    // The Sales sheet ends with a totals row (all category cells empty,
    // Full price + Paid both contain the SUM totals), followed by a
    // commission summary block where therapist names ("Dr Teebi",
    // "Brunna", "Diana") sit in the Treatments column with their
    // commission amount in Paid. Without stopping here those rows look
    // like real sales and inflate the month's revenue.
    if (
      !col("Date") && !col("Client") && !col("Weight loss") &&
      !col("Treatment", "Treatments") && !col("Medical consultation") &&
      !col("Products")
    ) {
      const fullSum = parsePrice(col("Full price"));
      const paidSum = parsePrice(col("Paid"));
      if (fullSum !== null && paidSum !== null && fullSum >= 100 && paidSum >= 100) {
        break;
      }
    }

    const dateRaw  = col("Date");
    const client   = col("Client") || null;
    const treatment = col("Treatment", "Treatments") || null;
    let   therapist = col("Sale of", "Therapist") || null;
    const priceRaw  = col("Paid");
    const price     = parsePrice(priceRaw);

    if (!client && !treatment) continue;
    if (price === null && !treatment) continue;
    if (therapist && /total/i.test(therapist)) therapist = null;

    const revenue = price ?? 0;
    const parsed  = parseDate(dateRaw, month);   // pass month so M/D vs D/M resolves correctly
    if (parsed) lastDate = parsed;
    const svcDate = lastDate;

    if (svcDate) {
      const d = new Date(svcDate);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    }

    const priceEx = revenue > 0 ? +(revenue / (1 + VAT_RATE)).toFixed(2) : 0;
    results.push({
      sheet_tab:           tabName,
      month:               monthKey,
      date_of_service:     svcDate,
      client,
      service_type:        "treatment",
      service_description: treatment,
      full_price:          +revenue.toFixed(2),
      paid:                +revenue.toFixed(2),
      vat_rate:            VAT_RATE,
      price_ex_vat:        priceEx,
      sales_staff:         therapist,
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

export async function runSlimmingSales(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; tabs: string[]; log: string[] }> {
  const log: string[] = [];
  const months = monthsInRange(new Date(dateFrom), new Date(dateTo));
  let totalRows = 0;
  const processed: string[] = [];

  for (const [year, month] of months) {
    const label      = `${MONTH_NAMES[month - 1]} ${year}`;
    const candidates = tabNamesForMonth(year, month);
    let result: Awaited<ReturnType<typeof fetchByName>> = null;
    let matchedName: string | null = null;

    for (const cand of candidates) {
      result = await fetchByName(cand);
      if (result) { matchedName = cand; log.push(`  ${label}: found tab '${cand}'`); break; }
    }

    if (!matchedName || !result) {
      log.push(`  ${label}: no tab found (tried ${candidates.join(", ")}) — skipping`);
      continue;
    }

    const rows = processRows(matchedName, result.headers, result.dataRows, year, month);
    if (!rows.length) { log.push(`  ${label}: 0 usable rows — skipping`); continue; }

    const paidTotal  = rows.reduce((s, r) => s + Number(r.full_price), 0);
    const exVatTotal = rows.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`    Paid (inc-VAT) total: €${paidTotal.toFixed(2)}`);
    log.push(`    Revenue ex-VAT:       €${exVatTotal.toFixed(2)}`);
    log.push(`    Rows captured:        ${rows.length}`);

    const monthKey = rows[0].month as string;
    await deleteWhere("slimming_sales_daily", { month: monthKey });
    const n = await insertRows("slimming_sales_daily", rows);
    totalRows += n;
    processed.push(matchedName);
    log.push(`  ${label}: ${n} rows inserted`);
  }

  log.push(`Done — ${totalRows} total rows inserted across ${processed.length} tab(s).`);
  return { rowsInserted: totalRows, tabs: processed, log };
}
