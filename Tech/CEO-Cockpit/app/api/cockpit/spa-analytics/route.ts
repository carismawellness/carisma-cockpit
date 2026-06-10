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

interface SpaAnalyticsResponse {
  staff_combined: StaffCombined[];
  guest_groups: GuestGroup[];
  payment_types: PaymentType[];
  payment_by_location: PaymentTypeByLocation[];
  discounts: DiscountEntry[];
}

// ── Analytics computation ─────────────────────────────────────────────────────

function isHotelGuest(guestGroup: string): boolean {
  const lower = guestGroup.toLowerCase().trim();
  if (!lower) return false;
  // "non-hotel" / "non hotel" / leading "non " must classify as NON-hotel even
  // though the literal substring "hotel" appears. Without this guard every
  // "NON-HOTEL GUEST" row gets misattributed to the hotel column.
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

  return {
    staff_combined:      staffCombined,
    guest_groups:        guestGroups,
    payment_types:       paymentTypes,
    payment_by_location: paymentByLocation,
    discounts,
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
    return NextResponse.json(mergeAnalytics(historic, live));
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

  return {
    staff_combined,
    guest_groups:        [...ggMap.values()].sort((x, y) => x.location_id - y.location_id),
    payment_types:       [...ptMap.values()].sort((x, y) => y.revenue - x.revenue),
    payment_by_location: [...pblMap.values()].sort((x, y) => x.location_id - y.location_id),
    discounts:           [...dMap.values()].sort((x, y) => x.location_id - y.location_id),
  };
}
