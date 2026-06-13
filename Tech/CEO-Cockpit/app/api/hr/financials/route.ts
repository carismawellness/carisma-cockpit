/**
 * GET /api/hr/financials?month=YYYY-MM
 *
 * Computes HC% = total payroll / total revenue per location and brand.
 *
 * Payroll source (same fallback chain as EBITDA salary-roster):
 *   1. transactions_raw wages for the month (Zoho-booked cash salaries)
 *   2. + salary_supplement_monthly current month (non-cash / manual supplements)
 *   3. If a venue has zero from both, fall back to most recent prior-month
 *      supplement (up to 3 months back), used as a same-period proxy.
 *
 * Revenue source (gross ex-VAT, consistent with EBITDA):
 *   spa_revenue_daily + aesthetics_sales_daily + slimming_sales_daily
 *   Includes NULL date_of_service rows anchored to the month bucket.
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

const VENUE_SLUG_TO_LOCATION: Record<string, string> = {
  inter:            "InterContinental",
  intercontinental: "InterContinental",
  hugos:            "Hugos",
  hyatt:            "Hyatt",
  ramla:            "Ramla Bay",
  labranda:         "Riviera",
  odycy:            "Odycy",
  sunny_coast:      "Odycy",
  excelsior:        "Excelsior",
  novotel:          "Novotel",
  aesthetics:       "Aesthetics Centre",
  carisma_aesthetics: "Aesthetics Centre",
  slimming:         "Slimming Centre",
  hq:               "HQ",
  management:       "HQ",
};

interface MonthBounds {
  start: string;
  end: string;
  monthStart: string;
  year: number;
  month: number;
}

function monthBounds(monthYYYYMM: string): MonthBounds | null {
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
    year:       y,
    month:      mo,
  };
}

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const monthParam = searchParams.get("month") || currentMonthYYYYMM();

  const bounds = monthBounds(monthParam);
  if (!bounds) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const pad = (n: number) => String(n).padStart(2, "0");

  // ── Partial-month detection ───────────────────────────────────────────────
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const isCurrentMonth = monthParam === currentMonthStr;
  const totalDaysInMonth = new Date(bounds.year, bounds.month, 0).getDate();
  const elapsedDays = isCurrentMonth ? now.getDate() : totalDaysInMonth;

  // ── Payroll ────────────────────────────────────────────────────────────────
  // Source 1: transactions_raw wages (Zoho-booked cash salaries)
  const { data: wageTxns, error: wageErr } = await supabase
    .from("transactions_raw")
    .select("venue, amount")
    .eq("ebitda_line", "wages")
    .gte("date", bounds.start)
    .lte("date", bounds.end);

  if (wageErr) {
    return NextResponse.json({ error: `wage query failed: ${wageErr.message}` }, { status: 500 });
  }

  const txnByVenue = new Map<string, number>();
  for (const t of wageTxns ?? []) {
    const venue = String(t.venue ?? "").trim();
    if (!venue) continue;
    txnByVenue.set(venue, (txnByVenue.get(venue) ?? 0) + Number(t.amount ?? 0));
  }

  // Source 2: salary_supplement_monthly — current month + 3 prior months fallback
  const suppMonths: string[] = [bounds.monthStart];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(bounds.year, bounds.month - 1 - i, 1);
    suppMonths.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`);
  }

  const { data: suppData } = await supabase
    .from("salary_supplement_monthly")
    .select("spa_slug, amount, month")
    .in("month", suppMonths)
    .not("spa_slug", "is", null);

  // Aggregate current-month supplements by venue
  const suppCurrentByVenue = new Map<string, number>();
  // Track most recent prior-month supplement per venue (fallback)
  const suppFallbackByVenue = new Map<string, number>();

  for (const s of suppData ?? []) {
    const venue = String(s.spa_slug ?? "").trim();
    if (!venue) continue;
    const amount = Number(s.amount ?? 0);
    if (s.month === bounds.monthStart) {
      suppCurrentByVenue.set(venue, (suppCurrentByVenue.get(venue) ?? 0) + amount);
    } else {
      const existing = suppFallbackByVenue.get(venue);
      const existingMonth = suppData?.find(
        (r) => String(r.spa_slug) === venue && r.month !== bounds.monthStart
      )?.month;
      if (!existing || (existingMonth && String(s.month) >= String(existingMonth))) {
        suppFallbackByVenue.set(venue, amount);
      }
    }
  }

  // Source 3: prior-month transactions_raw wages for extrapolation.
  // When Zoho hasn't synced the current month yet (or historical data is
  // missing), carry forward the most recent known monthly wages and prorate
  // to the elapsed portion of the queried month.
  const priorWindowStart = (() => {
    const d = new Date(bounds.year, bounds.month - 4, 1); // 3 months before queried month
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  })();
  const { data: priorWageTxns } = await supabase
    .from("transactions_raw")
    .select("venue, amount, date")
    .eq("ebitda_line", "wages")
    .gte("date", priorWindowStart)
    .lt("date", bounds.start);

  const priorWagesByVenueMonth = new Map<string, Map<string, number>>();
  for (const t of priorWageTxns ?? []) {
    const venue = String(t.venue ?? "").trim();
    if (!venue) continue;
    const monthKey = String(t.date).slice(0, 7);
    if (!priorWagesByVenueMonth.has(venue)) priorWagesByVenueMonth.set(venue, new Map());
    const m = priorWagesByVenueMonth.get(venue)!;
    m.set(monthKey, (m.get(monthKey) ?? 0) + Number(t.amount ?? 0));
  }

  interface PriorWage { amount: number; month: string }
  const priorWageFallbackByVenue = new Map<string, PriorWage>();
  for (const [venue, monthMap] of priorWagesByVenueMonth) {
    const sorted = Array.from(monthMap.keys()).sort().reverse();
    for (const m of sorted) {
      const amt = monthMap.get(m) ?? 0;
      if (amt > 0) { priorWageFallbackByVenue.set(venue, { amount: amt, month: m }); break; }
    }
  }

  // ── Combine all payroll sources ───────────────────────────────────────────
  const allVenues = new Set([
    ...txnByVenue.keys(),
    ...suppCurrentByVenue.keys(),
    ...suppFallbackByVenue.keys(),
    ...priorWageFallbackByVenue.keys(),
  ]);

  const payrollByLocation = new Map<string, number>();
  const extrapolatedLocations = new Set<string>();

  for (const venue of allVenues) {
    const txn     = txnByVenue.get(venue) ?? 0;
    const suppCur = suppCurrentByVenue.get(venue) ?? 0;
    const combined = txn + suppCur;

    let amount: number;
    let isVenueExtrapolated = false;

    if (combined > 0) {
      amount = combined;
    } else {
      // Prefer full prior-month wages over supplement-only fallback
      const prior = priorWageFallbackByVenue.get(venue);
      if (prior && prior.amount > 0) {
        if (isCurrentMonth) {
          // Pro-rate: last known monthly wages × (days elapsed / days in that month)
          const priorMonthDays = new Date(
            parseInt(prior.month.slice(0, 4)),
            parseInt(prior.month.slice(5, 7)),
            0,
          ).getDate();
          amount = prior.amount * (elapsedDays / priorMonthDays);
        } else {
          amount = prior.amount; // historical gap — full month proxy
        }
        isVenueExtrapolated = true;
      } else {
        amount = suppFallbackByVenue.get(venue) ?? 0;
        if (amount > 0) isVenueExtrapolated = true;
      }
    }

    if (amount <= 0) continue;
    const location = VENUE_SLUG_TO_LOCATION[venue];
    if (!location) continue;
    payrollByLocation.set(location, (payrollByLocation.get(location) ?? 0) + amount);
    if (isVenueExtrapolated) extrapolatedLocations.add(location);
  }

  // ── Revenue ────────────────────────────────────────────────────────────────
  // spa_revenue_daily (all rows have a date, simple range filter)
  const { data: spaRev, error: spaErr } = await supabase
    .from("spa_revenue_daily")
    .select("location_id, services, product_phytomer, product_purest, product_other")
    .gte("date", bounds.start)
    .lte("date", bounds.end);

  if (spaErr) {
    return NextResponse.json({ error: `spa revenue query: ${spaErr.message}` }, { status: 500 });
  }

  const revenueByLocation = new Map<string, number>();
  for (const r of spaRev ?? []) {
    const location = LOCATION_ID_TO_DISPLAY[r.location_id as number];
    if (!location) continue;
    // services + product_* hold inc-VAT after migration 073. Divide for ex-VAT
    // so HR financials stay consistent with aesthetics/slimming (price_ex_vat).
    const totalInc =
      Number(r.services ?? 0) +
      Number(r.product_phytomer ?? 0) +
      Number(r.product_purest ?? 0) +
      Number(r.product_other ?? 0);
    const total = totalInc / 1.18;
    revenueByLocation.set(location, (revenueByLocation.get(location) ?? 0) + total);
  }

  // aesthetics_sales_daily — include dated rows AND undated rows anchored to month
  const { data: aesRev, error: aesErr } = await supabase
    .from("aesthetics_sales_daily")
    .select("price_ex_vat, date_of_service, month")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );

  if (aesErr) {
    return NextResponse.json({ error: `aesthetics revenue query: ${aesErr.message}` }, { status: 500 });
  }

  const aesTotal = (aesRev ?? []).reduce((acc, r) => acc + Number(r.price_ex_vat ?? 0), 0);
  if (aesTotal > 0) {
    revenueByLocation.set("Aesthetics Centre", (revenueByLocation.get("Aesthetics Centre") ?? 0) + aesTotal);
  }

  // slimming_sales_daily — same pattern
  const { data: slmRev, error: slmErr } = await supabase
    .from("slimming_sales_daily")
    .select("price_ex_vat, date_of_service, month")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );

  if (slmErr) {
    return NextResponse.json({ error: `slimming revenue query: ${slmErr.message}` }, { status: 500 });
  }

  const slmTotal = (slmRev ?? []).reduce((acc, r) => acc + Number(r.price_ex_vat ?? 0), 0);
  if (slmTotal > 0) {
    revenueByLocation.set("Slimming Centre", (revenueByLocation.get("Slimming Centre") ?? 0) + slmTotal);
  }

  // ── Headcount: historical-first snapshot ─────────────────────────────────
  // Prefer the most recent snapshot ON OR BEFORE month end so we use the
  // actual headcount from that period, not today's. Falls back to the latest
  // available snapshot when no historical rows exist (e.g. months before the
  // nightly ETL started running).
  let { data: headcountRows } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .lte("snapshot_date", bounds.end)
    .order("snapshot_date", { ascending: false })
    .limit(200);

  if (!headcountRows || headcountRows.length === 0) {
    const { data: fallbackRows } = await supabase
      .from("hr_talexio_daily_snapshot")
      .select("location_name, active_headcount, snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(200);
    headcountRows = fallbackRows;
  }

  const headcountSnapshotDate = headcountRows?.[0]?.snapshot_date as string | null ?? null;
  const headcountIsHistorical = !!headcountSnapshotDate && headcountSnapshotDate <= bounds.end;

  const headcountByLocation = new Map<string, number>();
  for (const r of headcountRows ?? []) {
    const loc = r.location_name as string;
    if (!headcountByLocation.has(loc)) {
      headcountByLocation.set(loc, Number(r.active_headcount ?? 0));
    }
  }

  // ── Build byLocation rows (exclude HQ — no revenue, distorts chart) ────────
  const allLocations = new Set<string>([
    ...payrollByLocation.keys(),
    ...revenueByLocation.keys(),
  ]);

  const byLocation = Array.from(allLocations)
    .filter((loc) => loc !== "HQ")
    .map((loc) => {
      const payroll = +(payrollByLocation.get(loc) ?? 0).toFixed(2);
      const revenue = +(revenueByLocation.get(loc) ?? 0).toFixed(2);
      const hcPct = revenue > 0 ? +((payroll / revenue) * 100).toFixed(1) : 0;
      const headcount = headcountByLocation.get(loc) ?? 0;
      return { name: loc, payroll, revenue, hcPct, headcount };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // ── Aggregate byBusinessUnit (include HQ payroll in Spa brand total) ───────
  const brandTotals: Record<BrandName, { payroll: number; revenue: number }> = {
    Spa:        { payroll: 0, revenue: 0 },
    Aesthetics: { payroll: 0, revenue: 0 },
    Slimming:   { payroll: 0, revenue: 0 },
    HQ:         { payroll: 0, revenue: 0 },
  };

  // Include HQ payroll in grouping (it exists in payrollByLocation)
  const allLocationsForBU = new Set<string>([
    ...payrollByLocation.keys(),
    ...revenueByLocation.keys(),
  ]);
  for (const loc of allLocationsForBU) {
    const brand = LOCATION_TO_BRAND[loc] ?? brandForLocation(loc);
    brandTotals[brand].payroll += payrollByLocation.get(loc) ?? 0;
    brandTotals[brand].revenue += revenueByLocation.get(loc) ?? 0;
  }

  // Roll HQ payroll into Spa (HQ is a Carisma cost centre, allocated to Spa brand)
  brandTotals["Spa"].payroll += brandTotals["HQ"].payroll;
  delete (brandTotals as Record<string, unknown>)["HQ"];

  const byBusinessUnit = (["Spa", "Aesthetics", "Slimming"] as BrandName[])
    .map((brand) => {
      const { payroll, revenue } = brandTotals[brand] ?? { payroll: 0, revenue: 0 };
      return {
        name:    brand,
        payroll: +payroll.toFixed(2),
        revenue: +revenue.toFixed(2),
        hcPct:   revenue > 0 ? +((payroll / revenue) * 100).toFixed(1) : 0,
      };
    })
    .filter((b) => b.payroll > 0 || b.revenue > 0);

  const totalPayroll = (["Spa", "Aesthetics", "Slimming"] as BrandName[]).reduce(
    (a, b) => a + (brandTotals[b]?.payroll ?? 0),
    0,
  );
  const totalRevenue = byBusinessUnit.reduce((a, b) => a + b.revenue, 0);
  const totalHeadcount = Array.from(headcountByLocation.values()).reduce((a, b) => a + b, 0);

  // Flag incomplete payroll: if per-employee monthly payroll is below €500 it
  // almost certainly means Zoho wages haven't been synced for this month yet.
  const payrollPerHead = totalHeadcount > 0 ? totalPayroll / totalHeadcount : 0;
  const payrollComplete = totalHeadcount === 0 || payrollPerHead >= 500;

  const payrollExtrapolated = extrapolatedLocations.size > 0;

  return NextResponse.json({
    month: monthParam,
    byLocation,
    byBusinessUnit,
    totalRevenue:         +totalRevenue.toFixed(2),
    totalPayroll:         +totalPayroll.toFixed(2),
    totalHeadcount,
    payrollComplete,
    payrollExtrapolated,
    extrapolatedLocations: Array.from(extrapolatedLocations),
    headcountIsHistorical,
    headcountSnapshotDate,
    groupHcPct:           totalRevenue > 0 ? +((totalPayroll / totalRevenue) * 100).toFixed(1) : 0,
  });
}
