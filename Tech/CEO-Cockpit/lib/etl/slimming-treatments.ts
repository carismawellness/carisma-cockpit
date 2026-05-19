import { deleteWhere, insertRows } from "./supabase-etl";

const SHEET_ID = "1j6tz8k8TRSulB35Sg4X1xSlcV_JLf-8QKx-32UUkoBc";
const VAT_RATE = 0.18;

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ── Tab name candidates ───────────────────────────────────────────────────────
// Sheet uses "Treatments {Month} {YY}" e.g. "Treatments April 26"
function tabNamesForMonth(year: number, month: number): string[] {
  const m  = MONTH_NAMES[month - 1];
  const yy = String(year).slice(2);
  return [
    `Treatments ${m} ${yy}`,
    `Treatments ${m} ${year}`,
    `Treatments ${m.toLowerCase()} ${yy}`,
    `Treatments ${m.toUpperCase()} ${yy}`,
  ];
}

// ── Sheet fetch (public gviz CSV) ─────────────────────────────────────────────

async function fetchByName(tabName: string): Promise<{ headers: string[]; dataRows: string[][] } | null> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    const rows = parseCSV(text);
    if (!rows.length) return null;
    const headers = rows[0].map(h => h.trim());
    const lower   = headers.map(h => h.toLowerCase());
    // Guard: gviz silently returns first sheet when name doesn't match.
    // A real Treatments tab has Price + Treatment + Therapist and must NOT have
    // "Paid" / "Sale of" / "Weight loss" (those are Sales-tab telltales).
    if (!lower.includes("price")) return null;
    if (!lower.some(h => h === "treatment" || h === "treatments")) return null;
    if (!lower.includes("therapist")) return null;
    if (lower.includes("paid") || lower.includes("sale of") || lower.includes("weight loss")) return null;
    return { headers, dataRows: rows.slice(1) };
  } catch {
    return null;
  }
}

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(raw: string): string | null {
  raw = raw.trim().replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  let m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) { try { return new Date(+m[3], +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ } }
  m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (m) { try { return new Date(2000 + +m[3], +m[2] - 1, +m[1]).toISOString().slice(0, 10); } catch { /* */ } }
  return null;
}

function parsePrice(raw: string): number | null {
  if (!raw || /^[-—]$/.test(raw.trim())) return null;
  const cleaned = raw.replace(/[€$£,]/g, "").trim();
  const val = parseFloat(cleaned);
  return isFinite(val) && val >= 0 ? val : null;
}

// First-match-wins lookup. Critical because Apr 26 has a duplicate "Therapist"
// header in column F (pivot summary) — we want column D.
function findIdx(headers: string[], ...names: string[]): number {
  const norm = headers.map(h => h.toLowerCase().trim());
  for (const n of names) {
    const i = norm.findIndex(h => h === n.toLowerCase().trim());
    if (i !== -1) return i;
  }
  return -1;
}

// ── Row processor ────────────────────────────────────────────────────────────

function processRows(
  tabName: string,
  headers: string[],
  dataRows: string[][],
  year: number,
  month: number,
): Record<string, unknown>[] {
  const dateIdx      = findIdx(headers, "Date");
  const clientIdx    = findIdx(headers, "Client");
  const treatmentIdx = findIdx(headers, "Treatment", "Treatments");
  const priceIdx     = findIdx(headers, "Price");
  const therapistIdx = findIdx(headers, "Therapist");

  if (treatmentIdx === -1 || priceIdx === -1 || therapistIdx === -1) return [];

  const monthKey = new Date(year, month - 1, 1).toISOString().slice(0, 10);
  const results: Record<string, unknown>[] = [];
  let lastDate: string | null = null;

  for (const row of dataRows) {
    const get = (i: number) => (i >= 0 && i < row.length ? row[i].trim() : "");

    const treatment = get(treatmentIdx) || null;
    let therapist   = get(therapistIdx) || null;
    const priceRaw  = get(priceIdx);
    const price     = parsePrice(priceRaw);
    const dateRaw   = get(dateIdx);
    const client    = clientIdx >= 0 ? (get(clientIdx) || null) : null;

    // Skip pivot/empty rows: no treatment, or therapist is a totals label
    if (!treatment) continue;
    if (therapist && /^(grand\s+)?total\b/i.test(therapist)) continue;
    if (price === null) continue;

    const parsed = parseDate(dateRaw);
    if (parsed) lastDate = parsed;
    const svcDate = lastDate;

    if (svcDate) {
      const d = new Date(svcDate);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    }

    const priceEx = price > 0 ? +(price / (1 + VAT_RATE)).toFixed(2) : 0;

    results.push({
      sheet_tab:       tabName,
      month:           monthKey,
      date_of_service: svcDate,
      client,
      treatment,
      price_inc_vat:   +price.toFixed(2),
      vat_rate:        VAT_RATE,
      price_ex_vat:    priceEx,
      therapist,
    });
  }
  return results;
}

// ── Date range helpers ───────────────────────────────────────────────────────

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

// ── Main run ─────────────────────────────────────────────────────────────────

export async function runSlimmingTreatments(
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
      log.push(`  ${label}: no Treatments tab found (tried ${candidates.join(", ")}) — skipping`);
      continue;
    }

    const rows = processRows(matchedName, result.headers, result.dataRows, year, month);
    if (!rows.length) { log.push(`  ${label}: 0 usable rows — skipping`); continue; }

    const incTotal = rows.reduce((s, r) => s + Number(r.price_inc_vat), 0);
    const exTotal  = rows.reduce((s, r) => s + Number(r.price_ex_vat),  0);
    log.push(`    Price (inc-VAT) total: €${incTotal.toFixed(2)}`);
    log.push(`    Price ex-VAT:          €${exTotal.toFixed(2)}`);
    log.push(`    Rows captured:         ${rows.length}`);

    const monthKey = rows[0].month as string;
    await deleteWhere("slimming_treatments_daily", { month: monthKey });
    const n = await insertRows("slimming_treatments_daily", rows);
    totalRows += n;
    processed.push(matchedName);
    log.push(`  ${label}: ${n} rows inserted`);
  }

  log.push(`Done — ${totalRows} total rows inserted across ${processed.length} tab(s).`);
  return { rowsInserted: totalRows, tabs: processed, log };
}
