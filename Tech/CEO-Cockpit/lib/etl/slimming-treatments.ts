import { deleteWhere, insertRows } from "./supabase-etl";
import { cockpitCsvUrl, COCKPIT_TABS } from "../constants/cockpit-sheets";

const VAT_RATE = 0.18;

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

async function fetchCockpitCsv(): Promise<Record<string, string>[]> {
  const url = cockpitCsvUrl(COCKPIT_TABS.SLM_TRANSACTIONS.gid);
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
  return isFinite(val) && val >= 0 ? val : null;
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

export async function runSlimmingTreatments(
  dateFrom: string,
  dateTo: string,
): Promise<{ rowsInserted: number; log: string[] }> {
  const log: string[] = [];
  const allRows = await fetchCockpitCsv();
  log.push(`Fetched ${allRows.length} raw rows from Cockpit SLM_TRANSACTIONS tab`);

  const validMonths = monthsInRange(dateFrom, dateTo);
  const buckets = new Map<string, Record<string, unknown>[]>();
  let lastDate: string | null = null;

  for (const row of allRows) {
    const dateRaw   = col(row, "date");
    const priceRaw  = col(row, "price");
    const client    = col(row, "client")                  || null;
    const treatment = col(row, "treatment", "treatments") || null;
    const therapist = col(row, "therapist")               || null;

    if (!treatment) continue;
    if (therapist && /^(grand\s+)?total\b/i.test(therapist)) continue;

    const price = parsePrice(priceRaw);
    if (price === null) continue;

    const parsed = parseDate(dateRaw);
    if (parsed) lastDate = parsed;
    if (!lastDate) continue;

    const monthKey = `${lastDate.slice(0, 7)}-01`;
    if (!validMonths.has(monthKey)) continue;

    const priceEx = price > 0 ? +(price / (1 + VAT_RATE)).toFixed(2) : 0;

    if (!buckets.has(monthKey)) buckets.set(monthKey, []);
    buckets.get(monthKey)!.push({
      sheet_tab:       COCKPIT_TABS.SLM_TRANSACTIONS.name,
      month:           monthKey,
      date_of_service: lastDate,
      client,
      treatment,
      price_inc_vat:   +price.toFixed(2),
      vat_rate:        VAT_RATE,
      price_ex_vat:    priceEx,
      therapist,
    });
  }

  let totalRows = 0;
  for (const [monthKey, rows] of buckets) {
    await deleteWhere("slimming_treatments_daily", { month: monthKey });
    const n = await insertRows("slimming_treatments_daily", rows);
    totalRows += n;
    const exTotal = rows.reduce((s, r) => s + Number(r.price_ex_vat), 0);
    log.push(`  ${monthKey}: ${n} rows — €${exTotal.toFixed(2)} ex-VAT`);
  }

  log.push(`Done — ${totalRows} total rows across ${buckets.size} month(s).`);
  return { rowsInserted: totalRows, log };
}
