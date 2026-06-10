/**
 * GET /api/hr/financials?month=YYYY-MM
 *
 * Joins payroll (sourced from `transactions_raw` wages — the canonical
 * cockpit salary source after `salary_monthly` was dropped in migration 054)
 * with revenue tables (`spa_revenue_daily`, `aesthetics_sales_daily`,
 * `slimming_sales_daily`) and computes HC% = payroll / revenue * 100 per
 * location and per brand.
 *
 * Response shape (see plan doc):
 *   {
 *     month,
 *     byLocation: [{ location, payroll, revenue, hcPct, headcount }],
 *     byBrand:    [{ brand, payroll, revenue, hcPct }],
 *     totals:     { payroll, revenue, groupHcPct }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  LOCATION_ID_TO_DISPLAY,
  LOCATION_TO_BRAND,
  brandForLocation,
  type BrandName,
} from "@/lib/constants/hr-mapping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Venue slug (as stored on `transactions_raw.venue`) → canonical location
// display name (LOCATION_TO_BRAND keys).
const VENUE_SLUG_TO_LOCATION: Record<string, string> = {
  inter:            "InterContinental",
  intercontinental: "InterContinental",
  hugos:            "Hugos",
  hyatt:            "Hyatt",
  ramla:            "Ramla Bay",
  labranda:         "Labranda",
  odycy:            "Odycy",
  sunny_coast:      "Odycy",
  excelsior:        "Excelsior",
  novotel:          "Novotel",
  aesthetics:       "Aesthetics Centre",
  slimming:         "Slimming Centre",
  hq:               "HQ",
};

function monthBounds(monthYYYYMM: string): { start: string; end: string; monthStart: string } | null {
  const m = monthYYYYMM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!y || mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, mo, 0).getDate();
  return {
    start:      `${y}-${pad(mo)}-01`,
    end:        `${y}-${pad(mo)}-${pad(lastDay)}`,
    monthStart: `${y}-${pad(mo)}-01`,
  };
}

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || currentMonthYYYYMM();

  const bounds = monthBounds(month);
  if (!bounds) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // ── Payroll: aggregate wages from transactions_raw by venue slug ──────────
  const { data: wageTxns, error: wageErr } = await supabase
    .from("transactions_raw")
    .select("venue, amount")
    .eq("ebitda_line", "wages")
    .gte("date", bounds.start)
    .lte("date", bounds.end);

  if (wageErr) {
    return NextResponse.json(
      { error: `wage query failed: ${wageErr.message}` },
      { status: 500 },
    );
  }

  const payrollByLocation = new Map<string, number>();
  for (const t of wageTxns ?? []) {
    const venue = (t.venue as string | null) || "";
    const location = VENUE_SLUG_TO_LOCATION[venue];
    if (!location) continue; // split/unallocated rows
    const amount = Number(t.amount ?? 0);
    payrollByLocation.set(location, (payrollByLocation.get(location) ?? 0) + amount);
  }

  // ── Revenue: spa_revenue_daily (per location_id) ──────────────────────────
  const { data: spaRev, error: spaErr } = await supabase
    .from("spa_revenue_daily")
    .select("location_id, services, product_phytomer, product_purest, product_other")
    .gte("date", bounds.start)
    .lte("date", bounds.end);

  if (spaErr) {
    return NextResponse.json(
      { error: `spa revenue query failed: ${spaErr.message}` },
      { status: 500 },
    );
  }

  const revenueByLocation = new Map<string, number>();
  for (const r of spaRev ?? []) {
    const location = LOCATION_ID_TO_DISPLAY[r.location_id as number];
    if (!location) continue;
    const total =
      Number(r.services ?? 0) +
      Number(r.product_phytomer ?? 0) +
      Number(r.product_purest ?? 0) +
      Number(r.product_other ?? 0);
    revenueByLocation.set(location, (revenueByLocation.get(location) ?? 0) + total);
  }

  // ── Revenue: aesthetics_sales_daily (single venue) ────────────────────────
  const { data: aesRev, error: aesErr } = await supabase
    .from("aesthetics_sales_daily")
    .select("price_ex_vat")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end);

  if (aesErr) {
    return NextResponse.json(
      { error: `aesthetics revenue query failed: ${aesErr.message}` },
      { status: 500 },
    );
  }

  const aesTotal = (aesRev ?? []).reduce(
    (acc, r) => acc + Number(r.price_ex_vat ?? 0),
    0,
  );
  if (aesTotal > 0) {
    revenueByLocation.set(
      "Aesthetics Centre",
      (revenueByLocation.get("Aesthetics Centre") ?? 0) + aesTotal,
    );
  }

  // ── Revenue: slimming_sales_daily (single venue) ──────────────────────────
  const { data: slmRev, error: slmErr } = await supabase
    .from("slimming_sales_daily")
    .select("price_ex_vat")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end);

  if (slmErr) {
    return NextResponse.json(
      { error: `slimming revenue query failed: ${slmErr.message}` },
      { status: 500 },
    );
  }

  const slmTotal = (slmRev ?? []).reduce(
    (acc, r) => acc + Number(r.price_ex_vat ?? 0),
    0,
  );
  if (slmTotal > 0) {
    revenueByLocation.set(
      "Slimming Centre",
      (revenueByLocation.get("Slimming Centre") ?? 0) + slmTotal,
    );
  }

  // ── Headcount: latest snapshot ≤ end-of-month per location ────────────────
  const { data: headcountRows } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .lte("snapshot_date", bounds.end)
    .gte("snapshot_date", bounds.start)
    .order("snapshot_date", { ascending: false });

  const headcountByLocation = new Map<string, number>();
  for (const r of headcountRows ?? []) {
    const loc = r.location_name as string;
    if (!headcountByLocation.has(loc)) {
      headcountByLocation.set(loc, Number(r.active_headcount ?? 0));
    }
  }

  // ── Build byLocation rows ─────────────────────────────────────────────────
  const allLocations = new Set<string>([
    ...payrollByLocation.keys(),
    ...revenueByLocation.keys(),
    ...headcountByLocation.keys(),
  ]);

  // `name` matches the HRLocationFinancial shape consumed by the frontend.
  const byLocation = Array.from(allLocations)
    .map((loc) => {
      const payroll = +(payrollByLocation.get(loc) ?? 0).toFixed(2);
      const revenue = +(revenueByLocation.get(loc) ?? 0).toFixed(2);
      const hcPct = revenue > 0 ? +((payroll / revenue) * 100).toFixed(1) : 0;
      const headcount = headcountByLocation.get(loc) ?? 0;
      return { name: loc, payroll, revenue, hcPct, headcount };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ── Aggregate byBusinessUnit ──────────────────────────────────────────────
  const brandTotals: Record<BrandName, { payroll: number; revenue: number }> = {
    Spa:        { payroll: 0, revenue: 0 },
    Aesthetics: { payroll: 0, revenue: 0 },
    Slimming:   { payroll: 0, revenue: 0 },
    HQ:         { payroll: 0, revenue: 0 },
  };
  for (const row of byLocation) {
    const brand = LOCATION_TO_BRAND[row.name] ?? brandForLocation(row.name);
    brandTotals[brand].payroll += row.payroll;
    brandTotals[brand].revenue += row.revenue;
  }

  // `name` matches the HRBusinessUnitFinancial shape consumed by the frontend.
  const byBusinessUnit = (Object.keys(brandTotals) as BrandName[])
    .map((brand) => {
      const { payroll, revenue } = brandTotals[brand];
      return {
        name:    brand,
        payroll: +payroll.toFixed(2),
        revenue: +revenue.toFixed(2),
        hcPct:   revenue > 0 ? +((payroll / revenue) * 100).toFixed(1) : 0,
      };
    })
    .filter((b) => b.payroll > 0 || b.revenue > 0);

  const totalPayroll = byBusinessUnit.reduce((a, b) => a + b.payroll, 0);
  const totalRevenue = byBusinessUnit.reduce((a, b) => a + b.revenue, 0);

  return NextResponse.json({
    month,
    byLocation,
    byBusinessUnit,
    totalRevenue:  +totalRevenue.toFixed(2),
    groupHcPct:    totalRevenue > 0 ? +((totalPayroll / totalRevenue) * 100).toFixed(1) : 0,
  });
}
