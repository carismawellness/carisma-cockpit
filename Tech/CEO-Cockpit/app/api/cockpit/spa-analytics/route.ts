import { NextRequest, NextResponse } from "next/server";
import { cockpitCsvUrl, COCKPIT_TABS } from "@/lib/constants/cockpit-sheets";

export const maxDuration = 30;

// ── Constants ──────────────────────────────────────────────────────────────────

const SERVICE_GID = COCKPIT_TABS.SPA_SERVICES.gid;
const PRODUCT_GID = COCKPIT_TABS.SPA_RETAIL.gid;
const VAT_RATE    = 0.18;

const COCKPIT_SPA_LOCATION_MAP: Record<string, number> = {
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
  1:  { name: "Inter",              color: "#1B3A4B" },
  2:  { name: "Hugos",              color: "#96B2B2" },
  3:  { name: "Hyatt",              color: "#B79E61" },
  4:  { name: "Ramla",              color: "#8EB093" },
  5:  { name: "Riviera",            color: "#E07A5F" },
  6:  { name: "Odycy",              color: "#4A90D9" },
  7:  { name: "Excelsior",          color: "#7C3AED" },
  8:  { name: "Novotel",            color: "#DC2626" },
  11: { name: "Qawra (closed)",     color: "#9CA3AF" },
  12: { name: "Seashells (closed)", color: "#6B7280" },
};

// First date covered by the live Cockpit Datasheet ETL. Anything earlier comes
// from spa_transactions_raw (the 2014-2023 backfill). See
// supabase/migrations/070_spa_transactions_raw_and_qawra.sql and
// Tools/spa-historical-backfill.ts.
const LIVE_ETL_FIRST_DATE = new Date(2025, 0, 1);

// ── CSV helpers (copied verbatim from lib/etl/cockpit-revenue.ts) ───────────────

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

/** Extract 0-23 hour from a "HH:mm" / "HH:mm:ss" / "HH.mm" string. */
function parseHourOfDay(raw: string): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})[:\.](\d{1,2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseCockpitDate(raw: string): Date | null {
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

async function fetchCockpitCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = cockpitCsvUrl(gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit Datasheet fetch failed: ${resp.status}`);
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
  avg_order_value: number;
}

interface PaymentTypeByLocation {
  location_id: number;
  name: string;
  color: string;
  payment_types: Record<string, number>; // payType → revenue (ex-VAT)
}

interface DowByLocationPoint {
  day_of_week: number;   // 1 = Monday … 7 = Sunday
  day_label:   string;   // "Mon" / "Tue" / …
  by_location: Record<number, number>; // location_id → revenue (inc-VAT)
}

interface HourByLocationPoint {
  hour:        number;   // 0–23
  by_location: Record<number, number>; // location_id → revenue (inc-VAT)
}

interface TherapistRow {
  therapist:    string;
  revenue:      number;  // inc-VAT
  service_count: number;
}

interface ComplimentaryEntry {
  location_id:        number;
  name:               string;
  color:              string;
  complimentary_revenue: number;  // inc-VAT — only Payment Type === "Payment Center"
  total_revenue:       number;    // inc-VAT — all payment types
  complimentary_pct:   number;    // 0-100
  complimentary_count: number;
  total_count:         number;
}

interface SpaAnalyticsResponse {
  staff_combined: StaffCombined[];
  guest_groups: GuestGroup[];
  payment_types: PaymentType[];
  payment_by_location: PaymentTypeByLocation[];
  discounts: DiscountEntry[];
  /** Sales by day of week, broken out by club. Useful for staffing/scheduling. */
  by_day_of_week: DowByLocationPoint[];
  /** Sales by service-start hour, broken out by club. */
  by_hour_of_day: HourByLocationPoint[];
  /** Therapist utilization — sum of unit price per therapist (Column G). */
  by_therapist: TherapistRow[];
  /** Complimentary breakdown per club (Payment Type === 'Payment Center'). */
  complimentary: ComplimentaryEntry[];
  // Optional. Populated only when the requested date range straddles
  // 2025-01-01 AND part of it falls in a known data-gap window (e.g. the
  // 2023-09 → 2024-12 hole between the historic backfill and live ETL).
  // The UI surfaces this so users don't read a silent zero as "no activity".
  gaps?: { date_from: string; date_to: string; reason: string }[];
}

// ── Analytics computation ─────────────────────────────────────────────────────

function isHotelGuest(guestGroup: string): boolean {
  const lower = guestGroup.toLowerCase().trim();
  if (!lower) return false;
  // Audited Guest Group tokens from the historic sheet + live Cockpit Datasheet:
  //   HOTEL GUEST, NON-HOTEL GUEST, RESIDENT, WALK-IN, MEMBER, COMP, (blank)
  // The "non-hotel" / "non hotel" / leading "non " guard catches the only
  // false-positive case: NON-HOTEL GUEST contains the substring "hotel".
  // If a new separator ever appears (NON_HOTEL, NON.HOTEL), add it here.
  if (lower.includes("non-hotel") || lower.includes("non hotel") || lower.startsWith("non ")) return false;
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

  // Payment type by location accumulators
  const paymentByLocAcc: Record<number, Record<string, number>> = {};

  // Discount accumulators: locId → { gross_list, net_unit, all_net, discounted_cnt, total_cnt }
  const discountAcc: Record<number, {
    gross_list_revenue: number;
    net_unit_revenue: number;
    all_net_revenue: number;
    discounted_txn_count: number;
    total_txn_count: number;
  }> = {};

  // Day-of-week accumulators: dow (1=Mon…7=Sun) → locId → revenue (inc-VAT)
  const dowAcc: Record<number, Record<number, number>> = {};
  // Hour-of-day accumulators: hour (0-23) → locId → revenue (inc-VAT)
  const hourAcc: Record<number, Record<number, number>> = {};
  // Therapist utilization: therapist name → { revenue inc-VAT, service count }
  const therapistAcc: Record<string, { revenue: number; service_count: number }> = {};
  // Complimentary (Payment Type === "Payment Center"): locId → { comp_revenue, comp_count }
  const complimentaryAcc: Record<number, { comp_revenue: number; comp_count: number }> = {};

  // ── Process services sheet ──────────────────────────────────────────────────
  for (const row of serviceRows) {
    if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;

    const d = parseCockpitDate(stripCol(row, "Service Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    const unitPriceInc = safeFloat(stripCol(row, "Unit Price"));
    if (unitPriceInc <= 0) continue;
    const unitPriceEx = unitPriceInc / (1 + VAT_RATE);

    // Staff service revenue — accumulate for all rows regardless of Sales Point
    const soldBy = stripCol(row, "Sold By").replace(/\s+/g, " ").trim();
    if (soldBy) {
      staffServiceRev[soldBy] = (staffServiceRev[soldBy] ?? 0) + unitPriceEx;
    }

    const locId = COCKPIT_SPA_LOCATION_MAP[stripCol(row, "Sales Point")];
    if (locId === undefined) continue;

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
    if (!paymentByLocAcc[locId]) paymentByLocAcc[locId] = {};
    paymentByLocAcc[locId][payType] = (paymentByLocAcc[locId][payType] ?? 0) + unitPriceEx;

    // Discounts
    const listPriceInc = safeFloat(stripCol(row, "List Price"));
    if (!discountAcc[locId]) {
      discountAcc[locId] = { gross_list_revenue: 0, net_unit_revenue: 0, all_net_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
    }
    discountAcc[locId].total_txn_count  += 1;
    discountAcc[locId].all_net_revenue  += unitPriceEx;
    if (listPriceInc > unitPriceInc && unitPriceInc > 0) {
      const listPriceEx = listPriceInc / (1 + VAT_RATE);
      discountAcc[locId].gross_list_revenue   += listPriceEx;
      discountAcc[locId].net_unit_revenue     += unitPriceEx;
      discountAcc[locId].discounted_txn_count += 1;
    }

    // ── New cuts: by day of week, by hour, by therapist, complimentary ────
    // Day of week: 1 = Monday … 7 = Sunday (ISO).
    const jsDow = d.getDay();             // 0 = Sun … 6 = Sat
    const isoDow = jsDow === 0 ? 7 : jsDow;
    if (!dowAcc[isoDow]) dowAcc[isoDow] = {};
    dowAcc[isoDow][locId] = (dowAcc[isoDow][locId] ?? 0) + unitPriceInc;

    // Hour of day from the "Time of Service (Service Start Time)" column.
    // Format usually "HH:mm" or "HH:mm:ss"; tolerant of "HH.mm".
    const timeRaw = stripCol(row, "Time of Service (Service Start Time)")
                 || stripCol(row, "Service Start Time")
                 || stripCol(row, "Time of Service");
    const hour = parseHourOfDay(timeRaw);
    if (hour !== null) {
      if (!hourAcc[hour]) hourAcc[hour] = {};
      hourAcc[hour][locId] = (hourAcc[hour][locId] ?? 0) + unitPriceInc;
    }

    // Therapist — Column G is "Therapist (Employee(s))" in the historic /
    // master sheet. Fall back to "Employee(s)" / "Therapist" / "Sold By"
    // so the cut doesn't blow up if the live tab renames the column.
    const therapist = (
      stripCol(row, "Therapist (Employee(s))") ||
      stripCol(row, "Employee(s)") ||
      stripCol(row, "Therapist") ||
      stripCol(row, "Sold By")
    ).replace(/\s+/g, " ").trim();
    if (therapist) {
      const cur = therapistAcc[therapist] ?? { revenue: 0, service_count: 0 };
      cur.revenue       += unitPriceInc;
      cur.service_count += 1;
      therapistAcc[therapist] = cur;
    }

    // Complimentary — Payment Type === "Payment Center" (case-insensitive,
    // ignoring trailing whitespace).
    if (!complimentaryAcc[locId]) complimentaryAcc[locId] = { comp_revenue: 0, comp_count: 0 };
    if (payType.replace(/\s+/g, " ").trim().toLowerCase() === "payment center") {
      complimentaryAcc[locId].comp_revenue += unitPriceInc;
      complimentaryAcc[locId].comp_count   += 1;
    }
  }

  // ── Process products sheet ──────────────────────────────────────────────────
  for (const row of productRows) {
    const d = parseCockpitDate(stripCol(row, "Date"));
    if (!d || d < dateFrom || d > dateTo) continue;

    const pos   = stripCol(row, "Point of Sales") || stripCol(row, "Point of Sales ");
    const locId = COCKPIT_SPA_LOCATION_MAP[pos];
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

  // ── Build payment_by_location ───────────────────────────────────────────────
  const paymentByLocation: PaymentTypeByLocation[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const rawTypes = paymentByLocAcc[locId] ?? {};
      return {
        location_id:   locId,
        name:          meta.name,
        color:         meta.color,
        payment_types: Object.fromEntries(
          Object.entries(rawTypes).map(([t, v]) => [t, +v.toFixed(2)])
        ),
      };
    })
    .filter((loc) => Object.keys(loc.payment_types).length > 0)
    .sort((a, b) => a.location_id - b.location_id);

  // ── Build discounts ─────────────────────────────────────────────────────────
  const discounts: DiscountEntry[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const acc   = discountAcc[locId] ?? { gross_list_revenue: 0, net_unit_revenue: 0, all_net_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
      const totalDiscount = acc.gross_list_revenue - acc.net_unit_revenue;
      const discountPct   = acc.all_net_revenue > 0 ? (totalDiscount / acc.all_net_revenue) * 100 : 0;
      const avgOrderValue = acc.total_txn_count > 0 ? acc.all_net_revenue / acc.total_txn_count : 0;
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
        avg_order_value:      +avgOrderValue.toFixed(2),
      };
    })
    .sort((a, b) => a.location_id - b.location_id);

  // ── Build by_day_of_week / by_hour_of_day ──────────────────────────────────
  const DOW_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const by_day_of_week: DowByLocationPoint[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    const byLoc: Record<number, number> = {};
    const rec = dowAcc[dow] ?? {};
    for (const [k, v] of Object.entries(rec)) byLoc[Number(k)] = +v.toFixed(2);
    by_day_of_week.push({ day_of_week: dow, day_label: DOW_LABELS[dow], by_location: byLoc });
  }

  const by_hour_of_day: HourByLocationPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const byLoc: Record<number, number> = {};
    const rec = hourAcc[h] ?? {};
    for (const [k, v] of Object.entries(rec)) byLoc[Number(k)] = +v.toFixed(2);
    by_hour_of_day.push({ hour: h, by_location: byLoc });
  }

  // ── Build by_therapist (sorted desc by revenue) ────────────────────────────
  const by_therapist: TherapistRow[] = Object.entries(therapistAcc)
    .map(([therapist, v]) => ({
      therapist,
      revenue:       +v.revenue.toFixed(2),
      service_count: v.service_count,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Build complimentary ────────────────────────────────────────────────────
  const complimentary: ComplimentaryEntry[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const comp  = complimentaryAcc[locId] ?? { comp_revenue: 0, comp_count: 0 };
      const totalAcc = discountAcc[locId] ?? { all_net_revenue: 0, total_txn_count: 0 };
      // total revenue is ex-VAT in discountAcc; convert to inc-VAT for parity
      // with complimentary (which we stored inc-VAT above).
      const totalRevenueInc = totalAcc.all_net_revenue * (1 + VAT_RATE);
      const pct = totalRevenueInc > 0 ? (comp.comp_revenue / totalRevenueInc) * 100 : 0;
      return {
        location_id:           locId,
        name:                  meta.name,
        color:                 meta.color,
        complimentary_revenue: +comp.comp_revenue.toFixed(2),
        total_revenue:         +totalRevenueInc.toFixed(2),
        complimentary_pct:     +pct.toFixed(2),
        complimentary_count:   comp.comp_count,
        total_count:           totalAcc.total_txn_count,
      };
    })
    .sort((a, b) => a.location_id - b.location_id);

  return {
    staff_combined:      staffCombined,
    guest_groups:        guestGroups,
    payment_types:       paymentTypes,
    payment_by_location: paymentByLocation,
    discounts,
    by_day_of_week,
    by_hour_of_day,
    by_therapist,
    complimentary,
  };
}

// ── Historic-sheet path (pre-2025) ────────────────────────────────────────────
//
// For dates before 2025-01-01 the live Cockpit Datasheet has no rows. We re-
// compute the same five analytics outputs from spa_transactions_raw, the
// loss-less landing table populated by Tools/spa-historical-backfill.ts.
// Idempotent: re-runs produce identical results.

interface RawAnalyticsRow {
  location_id:         number;
  service_date:        string;
  net_revenue_gross:   number;   // VAT-incl
  revenue_ex_vat:      number;
  list_price_gross:    number | null;
  sold_by:             string | null;
  therapist_canonical: string | null;
  guest_group:         string | null;
  payment_type:        string | null;
  revenue_bucket:      string;
}

async function fetchHistoricRawRows(dateFrom: Date, dateTo: Date): Promise<RawAnalyticsRow[]> {
  const baseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key     = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");

  const cleanBaseUrl = baseUrl.replace(/\\n.*/g, "").trim();
  const cleanKey     = key.replace(/\\n.*/g, "").trim();
  const fromStr = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}-${String(dateFrom.getDate()).padStart(2, "0")}`;
  const toStr   = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, "0")}-${String(dateTo.getDate()).padStart(2, "0")}`;

  const select = "location_id,service_date,net_revenue_gross,revenue_ex_vat,list_price_gross,sold_by,therapist_canonical,guest_group,payment_type,revenue_bucket";
  const out: RawAnalyticsRow[] = [];
  const PAGE = 10000;
  let offset = 0;

  while (true) {
    const url = `${cleanBaseUrl}/rest/v1/spa_transactions_raw?` +
      `select=${select}&service_date=gte.${fromStr}&service_date=lte.${toStr}` +
      `&location_id=not.is.null&limit=${PAGE}&offset=${offset}&order=service_date.asc`;
    const resp = await fetch(url, {
      headers: { apikey: cleanKey, Authorization: `Bearer ${cleanKey}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase fetch spa_transactions_raw failed ${resp.status}: ${text.slice(0, 200)}`);
    }
    const batch = await resp.json() as RawAnalyticsRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
    offset += batch.length;
  }
  return out;
}

function computeAnalyticsFromRaw(
  rawRows: RawAnalyticsRow[],
  dateFrom: Date,
  dateTo: Date,
): SpaAnalyticsResponse {
  // Same accumulator shapes as computeAnalytics — keeping the output structure
  // identical so the frontend renders without changes.
  const staffServiceRev: Record<string, number> = {};
  const staffRetailRev:  Record<string, number> = {};
  const guestGroupAcc:   Record<number, { hotel_revenue: number; non_hotel_revenue: number; hotel_count: number; non_hotel_count: number }> = {};
  const paymentAcc:      Record<string, { revenue: number; count: number }> = {};
  const paymentByLocAcc: Record<number, Record<string, number>> = {};
  const discountAcc:     Record<number, { gross_list_revenue: number; net_unit_revenue: number; all_net_revenue: number; discounted_txn_count: number; total_txn_count: number }> = {};

  // dateFrom/dateTo are inclusive day boundaries; service_date is a YYYY-MM-DD string.
  const fromIso = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}-${String(dateFrom.getDate()).padStart(2, "0")}`;
  const toIso   = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, "0")}-${String(dateTo.getDate()).padStart(2, "0")}`;

  for (const r of rawRows) {
    if (!r.service_date) continue;
    if (r.service_date < fromIso || r.service_date > toIso) continue;
    const locId = r.location_id;

    const unitPriceInc = Number(r.net_revenue_gross) || 0;
    const unitPriceEx  = Number(r.revenue_ex_vat)    || 0;
    if (unitPriceInc <= 0) continue;

    if (r.revenue_bucket === "services") {
      // Staff service revenue: prefer the canonical therapist (matches
      // spa_services_by_employee_daily); fall back to sold_by, then skip.
      const name = (r.therapist_canonical ?? r.sold_by ?? "").replace(/\s+/g, " ").trim();
      if (name && name !== "CARISMA (SALES)" && name !== "SPA DAY" && name !== "REC" && name !== "CARISMA SPA") {
        staffServiceRev[name] = (staffServiceRev[name] ?? 0) + unitPriceEx;
      }

      // Guest group
      const gg = (r.guest_group ?? "").trim();
      if (!guestGroupAcc[locId]) {
        guestGroupAcc[locId] = { hotel_revenue: 0, non_hotel_revenue: 0, hotel_count: 0, non_hotel_count: 0 };
      }
      if (isHotelGuest(gg)) {
        guestGroupAcc[locId].hotel_revenue += unitPriceEx;
        guestGroupAcc[locId].hotel_count   += 1;
      } else {
        guestGroupAcc[locId].non_hotel_revenue += unitPriceEx;
        guestGroupAcc[locId].non_hotel_count   += 1;
      }

      // Payment type
      const payType = (r.payment_type ?? "").trim() || "Unknown";
      if (!paymentAcc[payType]) paymentAcc[payType] = { revenue: 0, count: 0 };
      paymentAcc[payType].revenue += unitPriceEx;
      paymentAcc[payType].count  += 1;
      if (!paymentByLocAcc[locId]) paymentByLocAcc[locId] = {};
      paymentByLocAcc[locId][payType] = (paymentByLocAcc[locId][payType] ?? 0) + unitPriceEx;

      // Discounts — only when list_price > unit_price (matches CSV path)
      const listPriceInc = Number(r.list_price_gross) || 0;
      if (!discountAcc[locId]) {
        discountAcc[locId] = { gross_list_revenue: 0, net_unit_revenue: 0, all_net_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
      }
      discountAcc[locId].total_txn_count += 1;
      discountAcc[locId].all_net_revenue += unitPriceEx;
      if (listPriceInc > unitPriceInc && unitPriceInc > 0) {
        const listPriceEx = listPriceInc / (1 + VAT_RATE);
        discountAcc[locId].gross_list_revenue   += listPriceEx;
        discountAcc[locId].net_unit_revenue     += unitPriceEx;
        discountAcc[locId].discounted_txn_count += 1;
      }
    } else {
      // Retail bucket → staff retail revenue. Use sold_by (historic sheet has
      // no separate Sales Employee column).
      const name = (r.sold_by ?? "").replace(/\s+/g, " ").trim();
      if (name && name !== "CARISMA (SALES)" && name !== "CARISMA SPA") {
        staffRetailRev[name] = (staffRetailRev[name] ?? 0) + unitPriceEx;
      }
    }
  }

  // Reuse the same output-shape construction as computeAnalytics.
  return buildAnalyticsResponse({
    staffServiceRev,
    staffRetailRev,
    guestGroupAcc,
    paymentAcc,
    paymentByLocAcc,
    discountAcc,
  });
}

interface AccBundle {
  staffServiceRev: Record<string, number>;
  staffRetailRev:  Record<string, number>;
  guestGroupAcc:   Record<number, { hotel_revenue: number; non_hotel_revenue: number; hotel_count: number; non_hotel_count: number }>;
  paymentAcc:      Record<string, { revenue: number; count: number }>;
  paymentByLocAcc: Record<number, Record<string, number>>;
  discountAcc:     Record<number, { gross_list_revenue: number; net_unit_revenue: number; all_net_revenue: number; discounted_txn_count: number; total_txn_count: number }>;
}

function buildAnalyticsResponse(acc: AccBundle): SpaAnalyticsResponse {
  const allStaffNames = new Set([...Object.keys(acc.staffServiceRev), ...Object.keys(acc.staffRetailRev)]);
  const staffCombined: StaffCombined[] = Array.from(allStaffNames).map(name => ({
    name,
    service_revenue: +(acc.staffServiceRev[name] ?? 0).toFixed(2),
    retail_revenue:  +(acc.staffRetailRev[name]  ?? 0).toFixed(2),
  }));
  staffCombined.sort((a, b) => (b.service_revenue + b.retail_revenue) - (a.service_revenue + a.retail_revenue));

  const guestGroups: GuestGroup[] = Object.entries(SPA_LOCATION_META).map(([idStr, meta]) => {
    const locId = Number(idStr);
    const a     = acc.guestGroupAcc[locId] ?? { hotel_revenue: 0, non_hotel_revenue: 0, hotel_count: 0, non_hotel_count: 0 };
    return {
      location_id:       locId,
      name:              meta.name,
      color:             meta.color,
      hotel_revenue:     +a.hotel_revenue.toFixed(2),
      non_hotel_revenue: +a.non_hotel_revenue.toFixed(2),
      hotel_count:       a.hotel_count,
      non_hotel_count:   a.non_hotel_count,
    };
  });

  const paymentTypes: PaymentType[] = Object.entries(acc.paymentAcc).map(([type, a]) => ({
    type,
    revenue: +a.revenue.toFixed(2),
    count:   a.count,
  }));
  paymentTypes.sort((a, b) => b.revenue - a.revenue);

  const paymentByLocation: PaymentTypeByLocation[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const rawTypes = acc.paymentByLocAcc[locId] ?? {};
      return {
        location_id:   locId,
        name:          meta.name,
        color:         meta.color,
        payment_types: Object.fromEntries(
          Object.entries(rawTypes).map(([t, v]) => [t, +v.toFixed(2)])
        ),
      };
    })
    .filter((loc) => Object.keys(loc.payment_types).length > 0)
    .sort((a, b) => a.location_id - b.location_id);

  const discounts: DiscountEntry[] = Object.entries(SPA_LOCATION_META)
    .map(([idStr, meta]) => {
      const locId = Number(idStr);
      const a     = acc.discountAcc[locId] ?? { gross_list_revenue: 0, net_unit_revenue: 0, all_net_revenue: 0, discounted_txn_count: 0, total_txn_count: 0 };
      const totalDiscount = a.gross_list_revenue - a.net_unit_revenue;
      const discountPct   = a.all_net_revenue > 0 ? (totalDiscount / a.all_net_revenue) * 100 : 0;
      const avgOrderValue = a.total_txn_count > 0 ? a.all_net_revenue / a.total_txn_count : 0;
      return {
        location_id:          locId,
        name:                 meta.name,
        color:                meta.color,
        gross_list_revenue:   +a.gross_list_revenue.toFixed(2),
        net_unit_revenue:     +a.net_unit_revenue.toFixed(2),
        total_discount:       +totalDiscount.toFixed(2),
        discount_pct:         +discountPct.toFixed(2),
        discounted_txn_count: a.discounted_txn_count,
        total_txn_count:      a.total_txn_count,
        avg_order_value:      +avgOrderValue.toFixed(2),
      };
    })
    .sort((a, b) => a.location_id - b.location_id);

  return {
    staff_combined:      staffCombined,
    guest_groups:        guestGroups,
    payment_types:       paymentTypes,
    payment_by_location: paymentByLocation,
    discounts,
    // The historic-sheet path doesn't have time-of-day / payment-type / therapist
    // detail in the audited columns yet, so we return empty arrays. The UI
    // gracefully renders the "no data" branch for these sections in pre-2025
    // periods.
    by_day_of_week:      [],
    by_hour_of_day:      [],
    by_therapist:        [],
    complimentary:       [],
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

  // Route to the right source based on the selected range.
  //   dateTo   <  2025-01-01            → historic (spa_transactions_raw)
  //   dateFrom >= 2025-01-01            → live    (Cockpit Datasheet CSV)
  //   straddle (rare; the 2024 gap means this is unusual) → both, merged
  const useHistoric = dateTo   <  LIVE_ETL_FIRST_DATE;
  const useLive     = dateFrom >= LIVE_ETL_FIRST_DATE;

  try {
    if (useHistoric) {
      const rawRows = await fetchHistoricRawRows(dateFrom, dateTo);
      return NextResponse.json(computeAnalyticsFromRaw(rawRows, dateFrom, dateTo));
    }

    if (useLive) {
      const [serviceRows, productRows] = await Promise.all([
        fetchCockpitCsv(SERVICE_GID),
        fetchCockpitCsv(PRODUCT_GID),
      ]);
      return NextResponse.json(computeAnalytics(serviceRows, productRows, dateFrom, dateTo));
    }

    // Straddle: split the range at 2024-12-31 and merge the two responses.
    const histTo = new Date(LIVE_ETL_FIRST_DATE.getTime() - 86_400_000);
    const [rawRows, serviceRows, productRows] = await Promise.all([
      fetchHistoricRawRows(dateFrom, histTo),
      fetchCockpitCsv(SERVICE_GID),
      fetchCockpitCsv(PRODUCT_GID),
    ]);
    const historic = computeAnalyticsFromRaw(rawRows, dateFrom, histTo);
    const live     = computeAnalytics(serviceRows, productRows, LIVE_ETL_FIRST_DATE, dateTo);
    const merged   = mergeAnalytics(historic, live);

    // Surface the 2023-09 → 2024-12 data hole if the historic side overlapped
    // it. Without this the merged response looks like "0 spa activity all of
    // 2024" instead of "we don't have 2024 data yet".
    const HISTORIC_LAST_DATE = new Date(2023, 7, 27); // 2023-08-27 (verified via spa_transactions_raw)
    if (dateFrom < LIVE_ETL_FIRST_DATE && histTo > HISTORIC_LAST_DATE) {
      const gapFromMs = Math.max(dateFrom.getTime(), HISTORIC_LAST_DATE.getTime() + 86_400_000);
      const gapToMs   = histTo.getTime();
      if (gapToMs >= gapFromMs) {
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        merged.gaps = [{
          date_from: fmt(new Date(gapFromMs)),
          date_to:   fmt(new Date(gapToMs)),
          reason:    "Spa data not yet imported for this range (historic sheet ends 2023-08-27; live ETL starts 2025-01-01).",
        }];
      }
    }
    return NextResponse.json(merged);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Sum two analytics responses (used for date ranges straddling 2025-01-01).
function mergeAnalytics(a: SpaAnalyticsResponse, b: SpaAnalyticsResponse): SpaAnalyticsResponse {
  // staff_combined: sum by name
  const staffMap = new Map<string, StaffCombined>();
  for (const s of [...a.staff_combined, ...b.staff_combined]) {
    const cur = staffMap.get(s.name) ?? { name: s.name, service_revenue: 0, retail_revenue: 0 };
    cur.service_revenue = +(cur.service_revenue + s.service_revenue).toFixed(2);
    cur.retail_revenue  = +(cur.retail_revenue  + s.retail_revenue ).toFixed(2);
    staffMap.set(s.name, cur);
  }
  const staff_combined = [...staffMap.values()].sort(
    (x, y) => (y.service_revenue + y.retail_revenue) - (x.service_revenue + x.retail_revenue),
  );

  // guest_groups, payment_by_location, discounts: keyed by location_id, sum numeric fields
  const ggMap = new Map<number, GuestGroup>();
  for (const g of [...a.guest_groups, ...b.guest_groups]) {
    const cur = ggMap.get(g.location_id) ?? { ...g, hotel_revenue: 0, non_hotel_revenue: 0, hotel_count: 0, non_hotel_count: 0 };
    cur.hotel_revenue     = +(cur.hotel_revenue     + g.hotel_revenue    ).toFixed(2);
    cur.non_hotel_revenue = +(cur.non_hotel_revenue + g.non_hotel_revenue).toFixed(2);
    cur.hotel_count       += g.hotel_count;
    cur.non_hotel_count   += g.non_hotel_count;
    ggMap.set(g.location_id, cur);
  }

  // payment_types: sum by type
  const ptMap = new Map<string, PaymentType>();
  for (const p of [...a.payment_types, ...b.payment_types]) {
    const cur = ptMap.get(p.type) ?? { type: p.type, revenue: 0, count: 0 };
    cur.revenue = +(cur.revenue + p.revenue).toFixed(2);
    cur.count  += p.count;
    ptMap.set(p.type, cur);
  }

  const pblMap = new Map<number, PaymentTypeByLocation>();
  for (const p of [...a.payment_by_location, ...b.payment_by_location]) {
    const cur = pblMap.get(p.location_id) ?? { ...p, payment_types: {} };
    for (const [t, v] of Object.entries(p.payment_types)) {
      cur.payment_types[t] = +((cur.payment_types[t] ?? 0) + v).toFixed(2);
    }
    pblMap.set(p.location_id, cur);
  }

  // Discounts: recover each side's `all_net_revenue` (the sum of unitPriceEx
  // across ALL txns, not just discounted ones) from its avg_order_value, sum,
  // then re-derive discount_pct and avg_order_value from the merged totals.
  //
  //   side.all_net_revenue = side.avg_order_value × side.total_txn_count
  //   merged.all_net       = a.all_net + b.all_net
  //   merged.discount_pct  = merged.total_discount / merged.all_net × 100
  //   merged.avg_order_value = merged.all_net / merged.total_txn_count
  const dMap = new Map<number, DiscountEntry & { _allNet?: number }>();
  for (const d of [...a.discounts, ...b.discounts]) {
    const cur = dMap.get(d.location_id) ?? { ...d, gross_list_revenue: 0, net_unit_revenue: 0, total_discount: 0, discount_pct: 0, discounted_txn_count: 0, total_txn_count: 0, avg_order_value: 0, _allNet: 0 };
    cur.gross_list_revenue   = +(cur.gross_list_revenue   + d.gross_list_revenue  ).toFixed(2);
    cur.net_unit_revenue     = +(cur.net_unit_revenue     + d.net_unit_revenue    ).toFixed(2);
    cur.total_discount       = +(cur.total_discount       + d.total_discount      ).toFixed(2);
    cur.discounted_txn_count += d.discounted_txn_count;
    cur.total_txn_count      += d.total_txn_count;
    cur._allNet              = (cur._allNet ?? 0) + d.avg_order_value * d.total_txn_count;
    dMap.set(d.location_id, cur);
  }
  for (const cur of dMap.values()) {
    const allNet = cur._allNet ?? 0;
    cur.discount_pct    = allNet > 0 ? +((cur.total_discount / allNet) * 100).toFixed(2) : 0;
    cur.avg_order_value = cur.total_txn_count > 0 ? +(allNet / cur.total_txn_count).toFixed(2) : 0;
    delete cur._allNet;
  }

  // Merge the new dimensions — additive sums per (location, day-of-week / hour /
  // therapist). Pre-2025 (historic) returns empty arrays so it's an additive no-op.
  const mergedDow: DowByLocationPoint[] = [];
  for (let dow = 1; dow <= 7; dow++) {
    const aRec = a.by_day_of_week.find((p) => p.day_of_week === dow)?.by_location ?? {};
    const bRec = b.by_day_of_week.find((p) => p.day_of_week === dow)?.by_location ?? {};
    const merged: Record<number, number> = { ...aRec };
    for (const [k, v] of Object.entries(bRec)) merged[+k] = +(((merged[+k] ?? 0) + v).toFixed(2));
    mergedDow.push({ day_of_week: dow, day_label: ["", "Mon","Tue","Wed","Thu","Fri","Sat","Sun"][dow], by_location: merged });
  }

  const mergedHour: HourByLocationPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const aRec = a.by_hour_of_day.find((p) => p.hour === h)?.by_location ?? {};
    const bRec = b.by_hour_of_day.find((p) => p.hour === h)?.by_location ?? {};
    const merged: Record<number, number> = { ...aRec };
    for (const [k, v] of Object.entries(bRec)) merged[+k] = +(((merged[+k] ?? 0) + v).toFixed(2));
    mergedHour.push({ hour: h, by_location: merged });
  }

  const thMap = new Map<string, TherapistRow>();
  for (const t of [...a.by_therapist, ...b.by_therapist]) {
    const cur = thMap.get(t.therapist) ?? { therapist: t.therapist, revenue: 0, service_count: 0 };
    cur.revenue       = +(cur.revenue + t.revenue).toFixed(2);
    cur.service_count = cur.service_count + t.service_count;
    thMap.set(t.therapist, cur);
  }

  const compMap = new Map<number, ComplimentaryEntry>();
  for (const c of [...a.complimentary, ...b.complimentary]) {
    const cur = compMap.get(c.location_id) ?? { ...c, complimentary_revenue: 0, total_revenue: 0, complimentary_pct: 0, complimentary_count: 0, total_count: 0 };
    cur.complimentary_revenue = +(cur.complimentary_revenue + c.complimentary_revenue).toFixed(2);
    cur.total_revenue         = +(cur.total_revenue + c.total_revenue).toFixed(2);
    cur.complimentary_count   = cur.complimentary_count + c.complimentary_count;
    cur.total_count           = cur.total_count + c.total_count;
    cur.complimentary_pct     = cur.total_revenue > 0 ? +((cur.complimentary_revenue / cur.total_revenue) * 100).toFixed(2) : 0;
    compMap.set(c.location_id, cur);
  }

  return {
    staff_combined,
    guest_groups:        [...ggMap.values()].sort((x, y) => x.location_id - y.location_id),
    payment_types:       [...ptMap.values()].sort((x, y) => y.revenue - x.revenue),
    payment_by_location: [...pblMap.values()].sort((x, y) => x.location_id - y.location_id),
    discounts:           [...dMap.values()].sort((x, y) => x.location_id - y.location_id),
    by_day_of_week:      mergedDow,
    by_hour_of_day:      mergedHour,
    by_therapist:        [...thMap.values()].sort((x, y) => y.revenue - x.revenue),
    complimentary:       [...compMap.values()].sort((x, y) => x.location_id - y.location_id),
  };
}
