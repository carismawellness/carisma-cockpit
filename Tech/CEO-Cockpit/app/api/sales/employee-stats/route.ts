// /api/sales/employee-stats — per-employee revenue + commission stats.
//
// GET ?brand=spa&slug=laura-camila&from=YYYY-MM-DD&to=YYYY-MM-DD
// → { employee, rates, totals, daily, service_breakdown, retail_breakdown, brand_extras }
//
// Revenue figures are in the employee's commission_basis (default ex-VAT).
// Commission is resolved PER TRANSACTION DATE from effective-dated rate rows
// (lib/sales-employees/engine.ts) — no row covering a date => 0 + rates_set
// flag drives the "rates not set" UI state.
//
// Per-brand sources/basis (design doc "Data reality" table):
//   spa        → spa_services_by_employee_daily (price_ex_vat) +
//                spa_retail_by_employee_daily (amount_ex_vat; missing table
//                tolerated pre-migration). inc-VAT basis = ex × 1.18.
//   aesthetics → aesthetics_sales_daily (note_person); retail via keyword
//                classifier; ex = price_ex_vat, inc = price_inc_vat.
//   slimming   → slimming_sales_daily (sales_staff); retail =
//                service_type='product'; ex = price_ex_vat, inc = paid.
// Requires any authenticated session.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { normalizeName } from "@/lib/sales-employees/names";
import { isAestheticsRetail } from "@/lib/sales-employees/classify";
import { commissionForRow, computeCommission, pickRate } from "@/lib/sales-employees/engine";
import { isAdminEmail } from "@/lib/auth/admins";
import type {
  BreakdownRow,
  CommissionRate,
  CommissionRow,
  EmployeeDailyStat,
  EmployeeStatsResponse,
  RevenueKind,
  SalesEmployee,
} from "@/lib/sales-employees/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BRANDS = new Set(["spa", "aesthetics", "slimming"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPA_VAT = 0.18;

// Spa location_id → display name (mirrors SPA_LOCATION_META in
// app/api/cockpit/spa-analytics/route.ts)
const SPA_LOCATION_NAMES: Record<number, string> = {
  1: "Inter", 2: "Hugos", 3: "Hyatt", 4: "Ramla", 5: "Riviera",
  6: "Odycy", 7: "Excelsior", 8: "Novotel", 11: "Qawra (closed)", 12: "Seashells (closed)",
};

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("42p01") || m.includes("does not exist") ||
    m.includes("could not find the table") || m.includes("404");
}

/** One attributed transaction, amount already in the employee's basis. */
interface Tx extends CommissionRow {
  /** breakdown label: service/product name */
  label: string;
}

function bumpBreakdown(map: Map<string, { revenue: number; tx_count: number }>, label: string, amount: number) {
  const key = label || "Unspecified";
  const entry = map.get(key) ?? { revenue: 0, tx_count: 0 };
  entry.revenue += amount;
  entry.tx_count += 1;
  map.set(key, entry);
}

function breakdownRows(map: Map<string, { revenue: number; tx_count: number }>): BreakdownRow[] {
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, revenue: +v.revenue.toFixed(2), tx_count: v.tx_count }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function GET(req: NextRequest) {
  // Any authenticated session (middleware also enforces, but verify server-side)
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const brand = params.get("brand") ?? "";
  const slug = params.get("slug") ?? "";
  let from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!BRANDS.has(brand)) {
    return NextResponse.json({ error: "brand must be spa|aesthetics|slimming" }, { status: 400 });
  }
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }

  // Enforce 6-month lookback for non-admin users — server-side security gate.
  if (!isAdminEmail(user.email)) {
    const earliest = new Date();
    earliest.setMonth(earliest.getMonth() - 6);
    earliest.setHours(0, 0, 0, 0);
    const earliestStr = earliest.toISOString().slice(0, 10);
    if (from < earliestStr) from = earliestStr;
  }

  const db = getAdminClient();

  // ── Employee + rates ────────────────────────────────────────────────────────
  const { data: empData, error: empErr } = await db
    .from("sales_employees")
    .select("*")
    .eq("brand_slug", brand)
    .eq("slug", slug)
    .maybeSingle();
  if (empErr) {
    return NextResponse.json(
      { error: empErr.message, ...(isMissingTable(empErr.message) ? { migration_missing: true } : {}) },
      { status: 500 },
    );
  }
  if (!empData) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const employee = empData as SalesEmployee;

  const { data: rateData, error: rateErr } = await db
    .from("sales_employee_commission_rates")
    .select("id, employee_id, service_rate, retail_rate, effective_from")
    .eq("employee_id", employee.id)
    .order("effective_from", { ascending: false });
  if (rateErr) return NextResponse.json({ error: rateErr.message }, { status: 500 });
  const rateRows: CommissionRate[] = (rateData ?? []).map((r) => ({
    id: r.id,
    employee_id: r.employee_id,
    service_rate: Number(r.service_rate),
    retail_rate: Number(r.retail_rate),
    effective_from: r.effective_from,
  }));

  // Names this employee answers to in revenue data
  const names = new Set<string>([normalizeName(employee.display_name)]);
  for (const alias of employee.aliases ?? []) {
    const n = normalizeName(alias);
    if (n) names.add(n);
  }
  const matches = (raw: string | null) => names.has(normalizeName(raw));
  const incBasis = employee.commission_basis === "inc_vat";

  // ── Collect transactions per brand ──────────────────────────────────────────
  const txs: Tx[] = [];
  const serviceBreakdown = new Map<string, { revenue: number; tx_count: number }>();
  const retailBreakdown = new Map<string, { revenue: number; tx_count: number }>();
  const brandExtras: Record<string, unknown> = {};

  try {
    if (brand === "spa") {
      const byLocation = new Map<string, number>();

      type SvcRow = {
        employee_name: string | null; price_ex_vat: number | null;
        service_name: string | null; location_id: number | null; date_of_service: string | null;
      };
      const svcRows = await fetchAll<SvcRow>(
        (off, lim) =>
          db.from("spa_services_by_employee_daily")
            .select("employee_name, price_ex_vat, service_name, location_id, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "spa_services_by_employee_daily",
      );
      for (const r of svcRows) {
        if (!r.date_of_service || !matches(r.employee_name)) continue;
        const ex = Number(r.price_ex_vat ?? 0);
        const amount = incBasis ? +(ex * (1 + SPA_VAT)).toFixed(2) : ex;
        const label = (r.service_name ?? "").trim();
        txs.push({ date: r.date_of_service, kind: "service", amount, label });
        bumpBreakdown(serviceBreakdown, label, amount);
        const locName = SPA_LOCATION_NAMES[r.location_id ?? -1] ?? "Other";
        byLocation.set(locName, (byLocation.get(locName) ?? 0) + amount);
      }

      // Retail table may not exist yet — degrade to "no retail" pre-migration
      type RetRow = {
        employee_name: string | null; amount_ex_vat: number | null;
        product_name: string | null; location_id: number | null; date: string | null;
      };
      try {
        const retRows = await fetchAll<RetRow>(
          (off, lim) =>
            db.from("spa_retail_by_employee_daily")
              .select("employee_name, amount_ex_vat, product_name, location_id, date")
              .gte("date", from)
              .lte("date", to)
              .range(off, off + lim - 1),
          "spa_retail_by_employee_daily",
        );
        for (const r of retRows) {
          if (!r.date || !matches(r.employee_name)) continue;
          const ex = Number(r.amount_ex_vat ?? 0);
          const amount = incBasis ? +(ex * (1 + SPA_VAT)).toFixed(2) : ex;
          const label = (r.product_name ?? "").trim();
          txs.push({ date: r.date, kind: "retail", amount, label });
          bumpBreakdown(retailBreakdown, label, amount);
          const locName = SPA_LOCATION_NAMES[r.location_id ?? -1] ?? "Other";
          byLocation.set(locName, (byLocation.get(locName) ?? 0) + amount);
        }
      } catch (e) {
        if (!isMissingTable(String(e))) throw e;
      }

      brandExtras.by_location = Array.from(byLocation.entries())
        .map(([name, revenue]) => ({ name, revenue: +revenue.toFixed(2) }))
        .sort((a, b) => b.revenue - a.revenue);
    } else if (brand === "aesthetics") {
      const paymentMix = new Map<string, number>();

      type AesRow = {
        note_person: string | null; service_product: string | null;
        price_ex_vat: number | null; price_inc_vat: number | null;
        payment_method: string | null; date_of_service: string | null;
      };
      const rows = await fetchAll<AesRow>(
        (off, lim) =>
          db.from("aesthetics_sales_daily")
            .select("note_person, service_product, price_ex_vat, price_inc_vat, payment_method, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "aesthetics_sales_daily",
      );
      for (const r of rows) {
        if (!r.date_of_service || !matches(r.note_person)) continue;
        const amount = incBasis ? Number(r.price_inc_vat ?? 0) : Number(r.price_ex_vat ?? 0);
        const kind: RevenueKind = isAestheticsRetail(r.service_product) ? "retail" : "service";
        const label = (r.service_product ?? "").trim();
        txs.push({ date: r.date_of_service, kind, amount, label });
        bumpBreakdown(kind === "retail" ? retailBreakdown : serviceBreakdown, label, amount);
        const pay = (r.payment_method ?? "").trim() || "Unknown";
        paymentMix.set(pay, (paymentMix.get(pay) ?? 0) + amount);
      }

      brandExtras.payment_mix = Array.from(paymentMix.entries())
        .map(([type, revenue]) => ({ type, revenue: +revenue.toFixed(2) }))
        .sort((a, b) => b.revenue - a.revenue);
    } else {
      const categoryMix = new Map<string, number>();
      let paidSum = 0;
      let fullPriceSum = 0;

      type SlmRow = {
        sales_staff: string | null; service_type: string | null;
        service_description: string | null; price_ex_vat: number | null;
        paid: number | null; full_price: number | null; date_of_service: string | null;
      };
      const rows = await fetchAll<SlmRow>(
        (off, lim) =>
          db.from("slimming_sales_daily")
            .select("sales_staff, service_type, service_description, price_ex_vat, paid, full_price, date_of_service")
            .gte("date_of_service", from)
            .lte("date_of_service", to)
            .range(off, off + lim - 1),
        "slimming_sales_daily",
      );
      for (const r of rows) {
        if (!r.date_of_service || !matches(r.sales_staff)) continue;
        const amount = incBasis ? Number(r.paid ?? 0) : Number(r.price_ex_vat ?? 0);
        const kind: RevenueKind = r.service_type === "product" ? "retail" : "service";
        const label = (r.service_description ?? "").trim();
        txs.push({ date: r.date_of_service, kind, amount, label });
        bumpBreakdown(kind === "retail" ? retailBreakdown : serviceBreakdown, label, amount);
        const cat = (r.service_type ?? "").trim() || "other";
        categoryMix.set(cat, (categoryMix.get(cat) ?? 0) + amount);
        paidSum += Number(r.paid ?? 0);
        fullPriceSum += Number(r.full_price ?? 0);
      }

      brandExtras.category_mix = Array.from(categoryMix.entries())
        .map(([category, revenue]) => ({ category, revenue: +revenue.toFixed(2) }))
        .sort((a, b) => b.revenue - a.revenue);
      brandExtras.collected_vs_full = {
        paid: +paidSum.toFixed(2),
        full_price: +fullPriceSum.toFixed(2),
      };
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  // ── Totals + daily series ───────────────────────────────────────────────────
  const commission = computeCommission(txs, rateRows);

  let serviceRevenue = 0, retailRevenue = 0, serviceTx = 0, retailTx = 0;
  const dailyMap = new Map<string, EmployeeDailyStat>();
  for (const tx of txs) {
    if (tx.kind === "retail") { retailRevenue += tx.amount; retailTx += 1; }
    else { serviceRevenue += tx.amount; serviceTx += 1; }

    const day = dailyMap.get(tx.date) ?? {
      date: tx.date, service_revenue: 0, retail_revenue: 0, commission: 0,
    };
    if (tx.kind === "retail") day.retail_revenue += tx.amount;
    else day.service_revenue += tx.amount;
    day.commission += commissionForRow(rateRows, tx.date, tx.kind, tx.amount);
    dailyMap.set(tx.date, day);
  }
  const daily = Array.from(dailyMap.values())
    .map((d) => ({
      date: d.date,
      service_revenue: +d.service_revenue.toFixed(2),
      retail_revenue: +d.retail_revenue.toFixed(2),
      commission: +d.commission.toFixed(2),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalRevenue = serviceRevenue + retailRevenue;
  const totalTx = serviceTx + retailTx;

  // Rate snapshot shown in the UI = rate applicable at the end of the period
  const periodRate = pickRate(rateRows, to);

  const response: EmployeeStatsResponse = {
    employee: {
      slug: employee.slug,
      display_name: employee.display_name,
      brand_slug: employee.brand_slug,
      role: employee.role,
      location_id: employee.location_id ?? null,
      is_active: employee.is_active,
      commission_basis: employee.commission_basis,
      rates_set: rateRows.length > 0,
      employee_type: (employee as SalesEmployee & { employee_type?: string }).employee_type ?? "therapist",
    },
    rates: periodRate
      ? {
          service_rate: periodRate.service_rate,
          retail_rate: periodRate.retail_rate,
          effective_from: periodRate.effective_from,
        }
      : null,
    totals: {
      service_revenue: +serviceRevenue.toFixed(2),
      retail_revenue: +retailRevenue.toFixed(2),
      total_revenue: +totalRevenue.toFixed(2),
      service_tx: serviceTx,
      retail_tx: retailTx,
      total_tx: totalTx,
      commission_service: commission.commission_service,
      commission_retail: commission.commission_retail,
      commission_total: commission.commission_total,
      avg_ticket: totalTx > 0 ? +(totalRevenue / totalTx).toFixed(2) : 0,
      active_days: dailyMap.size,
    },
    daily,
    service_breakdown: breakdownRows(serviceBreakdown),
    retail_breakdown: breakdownRows(retailBreakdown),
    brand_extras: brandExtras,
  };

  return NextResponse.json(response);
}
