import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// ── Constants ──────────────────────────────────────────────────────────────────

const SHEET_ID    = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";
const SERVICE_GID = "683143306";
const PRODUCT_GID = "1271322967";
const VAT_RATE    = 0.18;

const LAPIS_SPA_MAP: Record<string, number> = {
  "HUGOS":                        2,
  "INTER":                        1,
  "RAMLA":                        4,
  "SUNNY COAST":                  6,
  "SALES POINT OF EXCELSIOR":     7,
  "HYATT":                        3,
  "LABRANDA GENERAL SALES POINT": 5,
  "SALES POINT OF NOV":           8,
};

const SPA_LOCATION_META: Record<number, { name: string; color: string }> = {
  1: { name: "InterContinental", color: "#1B3A4B" },
  2: { name: "Hugos",            color: "#96B2B2" },
  3: { name: "Hyatt",            color: "#B79E61" },
  4: { name: "Ramla",            color: "#8EB093" },
  5: { name: "Labranda",         color: "#E07A5F" },
  6: { name: "Sunny Coast",      color: "#4A90D9" },
  7: { name: "Excelsior",        color: "#7C3AED" },
  8: { name: "Novotel",          color: "#DC2626" },
};

// ── CSV helpers (copied verbatim from lib/etl/lapis-revenue.ts) ───────────────

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

const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseLapisDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;

  // "4 June 2026" / "04 Jun 2026" — product sheet format
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

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

// ── CSV fetch ─────────────────────────────────────────────────────────────────

async function fetchLapisCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Lapis CSV fetch failed: ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // Skip the single-cell title row (fewer than 3 non-empty cells)
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaffCombined {
  name: string;
  service_revenue: number;
  retail_revenue: number;
}

interface GuestGroup {
  location_id: number;
  name: string;
  color: string;
  hotel_revenue: number;
  non_hotel_revenue: number;
  hotel_count: number;
  non_hotel_count: number;
}

interface PaymentType {
  type: string;
  revenue: number;
  count: number;
}

interface DiscountEntry {
  location_id: number;
  name: string;
  color: string;
  gross_list_revenue: number;
  net_unit_revenue: number;
  total_discount: number;
  discount_pct: number;
  discounted_txn_count: number;
  total_txn_count: number;
}

interface SpaAnalyticsResponse {
  staff_combined: StaffCombined[];
  guest_groups: GuestGroup[];
  payment_types: PaymentType[];
  discounts: DiscountEntry[];
}

// ── Analytics computation ─────────────────────────────────────────────────────

function isHotelGuest(guestGroup: string): boolean {
  const lower = guestGroup.toLowerCase();
  return lower.includes("hotel") || lower.includes("resident");
}

function computeAnalytics(
  serviceRows: Record<string, string>[],
  productRows: Record<string, string>[],
  dateFrom: Date,
  dateTo: Date,
): SpaAnalyticsResponse {

  // Staff accumulators
  const staffServiceRev: Record<string, number> = {};
  const staffRetailRev:  Record<string, number> = {};

  // Guest group accumulators: locId → { hotel_rev, non_hotel_rev, hotel_cnt, non_hotel_cnt }
  const guestGroupAcc: Record<number, {
    hotel_revenue: number;
    non_hotel_revenue: number;
    hotel_count: number;
    non_hotel_count: number;
  }> = {};

  // Payment type accumulators
  const paymentAcc: Record<string, { revenue: number; count: number }> = {};

  // Discount accumulators: locId → { gross_list, net_unit, discounted_cnt, total_cnt }
  const discountAcc: Record<number, {
    gross_list_revenue: number;
    net_unit_revenue: number;
    discounted_txn_count: number;
    total_txn_count: number;
  }> = {};

  // ── Process services sheet ──────────────────────────────────────────────────
  for (const row of serviceRows) {
    if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;

    const d = parseLapisDate(stripCol(row, "Service Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    const locId = LAPIS_SPA_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) continue;

    const unitPriceInc = safeFloat(stripCol(row, "Unit Price"));
    if (unitPriceInc <= 0) continue;
    const unitPriceEx = unitPriceInc / (1 + VAT_RATE);

    // Staff service revenue
    const soldBy = stripCol(row, "Sold By").replace(/\s+/g, " ").trim();
    if (soldBy) {
      staffServiceRev[soldBy] = (staffServiceRev[soldBy] ?? 0) + unitPriceEx;
    }

    // Guest group
    const guestGroup = stripCol(row, "Guest Group");
    if (!guestGroupAcc[locId]) {
      guestGroupAcc[locId] = { hotel_revenue: 0, non_hotel_revenue: 0, hotel_count: 0, non_hotel_count: 0 };
    }
    if (isHotelGuest(guestGroup)) {
      guestGroupAcc[locId].hotel_revenue += unitPriceEx;
      guestGroupAcc[locId].hotel_count   += 1;
    } else {
      guestGroupAcc[locId].non_hotel_revenue += unitPriceEx;
      guestGroupAcc[locId].non_hotel_count   += 1;
    }

    // Payment type
    const payType = stripCol(row, "Payment Type") || "Unknown";
    if (!paymentAcc[payType]) paymentAcc[payType] = { revenue: 0, count: 0 };
    paymentAcc[payType].revenue += unitPriceEx;
    paymentAcc[payType].count  += 1;

    // Discounts
    const listPriceInc = safeFloat(stripCol(row, "List Price"));
    if (!discountAcc[locId]) {
      discountAcc[locId] = { gross_list_revenue: 0, net_unit_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
    }
    discountAcc[locId].total_txn_count += 1;
    if (listPriceInc > unitPriceInc && unitPriceInc > 0) {
      const listPriceEx = listPriceInc / (1 + VAT_RATE);
      discountAcc[locId].gross_list_revenue   += listPriceEx;
      discountAcc[locId].net_unit_revenue     += unitPriceEx;
      discountAcc[locId].discounted_txn_count += 1;
    }
  }

  // ── Process products sheet ──────────────────────────────────────────────────
  for (const row of productRows) {
    const d = parseLapisDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    const pos   = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const locId = LAPIS_SPA_MAP[pos];
    if (locId === undefined) continue;

    const amount = safeFloat(stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "));
    if (amount <= 0) continue;

    const salesEmployee = stripCol(row, "Sales Employee").replace(/\s+/g, " ").trim();
    if (salesEmployee) {
      staffRetailRev[salesEmployee] = (staffRetailRev[salesEmployee] ?? 0) + amount;
    }
  }

  // ── Build staff_combined ────────────────────────────────────────────────────
  const allStaffNames = new Set([...Object.keys(staffServiceRev), ...Object.keys(staffRetailRev)]);
  const staffCombined: StaffCombined[] = Array.from(allStaffNames).map(name => ({
    name,
    service_revenue: +(staffServiceRev[name] ?? 0).toFixed(2),
    retail_revenue:  +(staffRetailRev[name]  ?? 0).toFixed(2),
  }));
  staffCombined.sort((a, b) =>
    (b.service_revenue + b.retail_revenue) - (a.service_revenue + a.retail_revenue)
  );
  const staffCombinedTop15 = staffCombined.slice(0, 15);

  // ── Build guest_groups ──────────────────────────────────────────────────────
  const guestGroups: GuestGroup[] = Object.entries(SPA_LOCATION_META).map(([idStr, meta]) => {
    const locId = Number(idStr);
    const acc   = guestGroupAcc[locId] ?? { hotel_revenue: 0, non_hotel_revenue: 0, hotel_count: 0, non_hotel_count: 0 };
    return {
      location_id:       locId,
      name:              meta.name,
      color:             meta.color,
      hotel_revenue:     +acc.hotel_revenue.toFixed(2),
      non_hotel_revenue: +acc.non_hotel_revenue.toFixed(2),
      hotel_count:       acc.hotel_count,
      non_hotel_count:   acc.non_hotel_count,
    };
  });

  // ── Build payment_types ─────────────────────────────────────────────────────
  const paymentTypes: PaymentType[] = Object.entries(paymentAcc).map(([type, acc]) => ({
    type,
    revenue: +acc.revenue.toFixed(2),
    count:   acc.count,
  }));
  paymentTypes.sort((a, b) => b.revenue - a.revenue);

  // ── Build discounts ─────────────────────────────────────────────────────────
  const discounts: DiscountEntry[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const acc   = discountAcc[locId] ?? { gross_list_revenue: 0, net_unit_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
      const totalDiscount = acc.gross_list_revenue - acc.net_unit_revenue;
      const discountPct   = acc.gross_list_revenue > 0 ? (totalDiscount / acc.gross_list_revenue) * 100 : 0;
      return {
        location_id:          locId,
        name:                 meta.name,
        color:                meta.color,
        gross_list_revenue:   +acc.gross_list_revenue.toFixed(2),
        net_unit_revenue:     +acc.net_unit_revenue.toFixed(2),
        total_discount:       +totalDiscount.toFixed(2),
        discount_pct:         +discountPct.toFixed(2),
        discounted_txn_count: acc.discounted_txn_count,
        total_txn_count:      acc.total_txn_count,
      };
    })
    .sort((a, b) => a.location_id - b.location_id);

  return {
    staff_combined: staffCombinedTop15,
    guest_groups:   guestGroups,
    payment_types:  paymentTypes,
    discounts,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateFromStr = searchParams.get("date_from");
  const dateToStr   = searchParams.get("date_to");

  if (!dateFromStr || !dateToStr) {
    return NextResponse.json(
      { error: "date_from and date_to query parameters are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  // Parse as local midnight so the full dateTo day is included in comparisons.
  const [fyear, fmo, fday] = dateFromStr.split("-").map(Number);
  const [tyear, tmo, tday] = dateToStr.split("-").map(Number);
  const dateFrom = new Date(fyear, fmo - 1, fday);
  const dateTo   = new Date(tyear, tmo - 1, tday);

  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  if (dateFrom > dateTo) {
    return NextResponse.json(
      { error: "date_from must be on or before date_to" },
      { status: 400 },
    );
  }

  try {
    const [serviceRows, productRows] = await Promise.all([
      fetchLapisCsv(SERVICE_GID),
      fetchLapisCsv(PRODUCT_GID),
    ]);

    const result = computeAnalytics(serviceRows, productRows, dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
