import { NextRequest, NextResponse } from "next/server";
import { cockpitCsvUrl, COCKPIT_TABS } from "@/lib/constants/cockpit-sheets";

export const maxDuration = 30;

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

// Accepts: DD/MM/YYYY, DD-MM-YYYY, D-M-YYYY
function parseSlmDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;
  const sep = raw.includes("/") ? "/" : raw.includes("-") ? "-" : null;
  if (!sep) return null;
  const parts = raw.split(sep);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const year = y < 100 ? 2000 + y : y;
  return new Date(year, m - 1, d);
}

// ── CSV fetch ─────────────────────────────────────────────────────────────────

async function fetchCockpitCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = cockpitCsvUrl(gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit CSV fetch failed (gid=${gid}): ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (parseCSVRow(lines[i]).filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = parseCSVRow(lines[headerIdx]);
  return lines.slice(headerIdx + 1).map(line => {
    const cells = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaffRevenue {
  name: string;
  revenue: number;
  txn_count: number;
}

interface ProgramRevenue {
  program: string;
  revenue: number;
  txn_count: number;
}

export interface SlmAnalyticsResponse {
  /** Combined revenue: package sales (Paid) + individual treatments (Price) */
  total_revenue: number;
  package_revenue: number;
  treatment_revenue: number;
  staff: StaffRevenue[];
  programs: ProgramRevenue[];   // weight-loss programmes + individual treatments
}

// ── Computation ───────────────────────────────────────────────────────────────

function computeAnalytics(
  salesRows: Record<string, string>[],
  txRows:    Record<string, string>[],
  dateFrom:  Date,
  dateTo:    Date,
): SlmAnalyticsResponse {
  const staffAcc:   Record<string, { revenue: number; count: number }> = {};
  const programAcc: Record<string, { revenue: number; count: number }> = {};
  let packageRevenue   = 0;
  let treatmentRevenue = 0;

  // ── Sales - Slimming (programme packages) ────────────────────────────────
  for (const row of salesRows) {
    const d = parseSlmDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    // Revenue = "Paid" column (what the client actually paid)
    const paid = safeFloat(stripCol(row, "Paid"));
    if (paid <= 0) continue;

    packageRevenue += paid;

    // Sales rep
    const rep = stripCol(row, "Sale of") || "Unknown";
    if (!staffAcc[rep]) staffAcc[rep] = { revenue: 0, count: 0 };
    staffAcc[rep].revenue += paid;
    staffAcc[rep].count  += 1;

    // Programme type: Weight loss programme name, or Treatments if one-off
    const prog = stripCol(row, "Weight loss") || stripCol(row, "Treatments") ||
                 stripCol(row, "Medical consultation") || "Other";
    if (!programAcc[prog]) programAcc[prog] = { revenue: 0, count: 0 };
    programAcc[prog].revenue += paid;
    programAcc[prog].count  += 1;
  }

  // ── Tx - Slimming (individual treatment sessions) ────────────────────────
  for (const row of txRows) {
    const d = parseSlmDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    const price = safeFloat(stripCol(row, "Price"));
    if (price <= 0) continue;

    treatmentRevenue += price;

    // Therapist
    const therapist = stripCol(row, "Therapist") || "Unknown";
    if (!staffAcc[therapist]) staffAcc[therapist] = { revenue: 0, count: 0 };
    staffAcc[therapist].revenue += price;
    staffAcc[therapist].count  += 1;

    // Treatment type
    const treatment = stripCol(row, "Treatment") || "Unknown";
    if (!programAcc[treatment]) programAcc[treatment] = { revenue: 0, count: 0 };
    programAcc[treatment].revenue += price;
    programAcc[treatment].count  += 1;
  }

  const staff: StaffRevenue[] = Object.entries(staffAcc)
    .map(([name, a]) => ({ name, revenue: +a.revenue.toFixed(2), txn_count: a.count }))
    .sort((a, b) => b.revenue - a.revenue);

  const programs: ProgramRevenue[] = Object.entries(programAcc)
    .map(([program, a]) => ({ program, revenue: +a.revenue.toFixed(2), txn_count: a.count }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    total_revenue:     +(packageRevenue + treatmentRevenue).toFixed(2),
    package_revenue:   +packageRevenue.toFixed(2),
    treatment_revenue: +treatmentRevenue.toFixed(2),
    staff,
    programs,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateFromStr = searchParams.get("date_from");
  const dateToStr   = searchParams.get("date_to");

  if (!dateFromStr || !dateToStr) {
    return NextResponse.json(
      { error: "date_from and date_to required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const [fy, fm, fd] = dateFromStr.split("-").map(Number);
  const [ty, tm, td] = dateToStr.split("-").map(Number);
  const dateFrom = new Date(fy, fm - 1, fd);
  const dateTo   = new Date(ty, tm - 1, td);

  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime()) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    // Fetch both slimming tabs in parallel
    const [salesRows, txRows] = await Promise.all([
      fetchCockpitCsv(COCKPIT_TABS.SLM_SALES.name),
      fetchCockpitCsv(COCKPIT_TABS.SLM_TRANSACTIONS.name),
    ]);
    const result = computeAnalytics(salesRows, txRows, dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
