import { NextRequest, NextResponse } from "next/server";
import { lapisCsvUrl, LAPIS_TABS } from "@/lib/constants/lapis-sheets";

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
  // Try the key, then with a trailing space (Google Sheets sometimes adds them)
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

// Accepts: DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY
function parseAesDate(raw: string): Date | null {
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

async function fetchLapisCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = lapisCsvUrl(gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed (gid=${gid}): ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // Skip single-cell title rows (< 3 non-empty cells)
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

interface ServiceRevenue {
  service: string;
  revenue: number;
  txn_count: number;
}

interface PaymentType {
  type: string;
  revenue: number;
  count: number;
}

export interface AesAnalyticsResponse {
  total_revenue: number;
  staff: StaffRevenue[];
  services: ServiceRevenue[];
  payment_types: PaymentType[];
}

// ── Computation ───────────────────────────────────────────────────────────────

function computeAnalytics(
  rows: Record<string, string>[],
  dateFrom: Date,
  dateTo: Date,
): AesAnalyticsResponse {
  const staffAcc:   Record<string, { revenue: number; count: number }> = {};
  const serviceAcc: Record<string, { revenue: number; count: number }> = {};
  const paymentAcc: Record<string, { revenue: number; count: number }> = {};
  let totalRevenue = 0;

  for (const row of rows) {
    const dateRaw = stripCol(row, "Date of service");
    const d = parseAesDate(dateRaw);
    if (!d || d < dateFrom || d > dateTo) continue;

    const price = safeFloat(stripCol(row, "Price"));
    if (price <= 0) continue;

    totalRevenue += price;

    // Staff — "Sales Staf" (note: column name has a typo in the sheet)
    const staff = stripCol(row, "Sales Staf") || stripCol(row, "Sales Staff") || "Unknown";
    if (!staffAcc[staff]) staffAcc[staff] = { revenue: 0, count: 0 };
    staffAcc[staff].revenue += price;
    staffAcc[staff].count  += 1;

    // Service / treatment
    const service = stripCol(row, "Service / Products") || "Unknown";
    if (!serviceAcc[service]) serviceAcc[service] = { revenue: 0, count: 0 };
    serviceAcc[service].revenue += price;
    serviceAcc[service].count  += 1;

    // Payment type — normalise "card + cash" → "Mixed"
    const rawPay = stripCol(row, "Payment").toLowerCase();
    const payType = rawPay.includes("+") || rawPay.includes("&")
      ? "Mixed"
      : rawPay === "card" ? "Card"
      : rawPay === "cash" ? "Cash"
      : rawPay === "online" ? "Online"
      : rawPay || "Unknown";
    if (!paymentAcc[payType]) paymentAcc[payType] = { revenue: 0, count: 0 };
    paymentAcc[payType].revenue += price;
    paymentAcc[payType].count  += 1;
  }

  const staff: StaffRevenue[] = Object.entries(staffAcc)
    .map(([name, a]) => ({ name, revenue: +a.revenue.toFixed(2), txn_count: a.count }))
    .sort((a, b) => b.revenue - a.revenue);

  const services: ServiceRevenue[] = Object.entries(serviceAcc)
    .map(([service, a]) => ({ service, revenue: +a.revenue.toFixed(2), txn_count: a.count }))
    .sort((a, b) => b.revenue - a.revenue);

  const payment_types: PaymentType[] = Object.entries(paymentAcc)
    .map(([type, a]) => ({ type, revenue: +a.revenue.toFixed(2), count: a.count }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    total_revenue: +totalRevenue.toFixed(2),
    staff,
    services,
    payment_types,
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
    const rows = await fetchLapisCsv(LAPIS_TABS.AESTHETICS.gid);
    const result = computeAnalytics(rows, dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
