/**
 * GET /api/hr/revpah?month=YYYY-MM
 *
 * Revenue per available hour by location.
 *
 *  - Revenue source: same queries as `/api/hr/financials`.
 *  - Available-hours: headcount × 8h × workdays_in_month from the most
 *    recent `hr_talexio_daily_snapshot` in or before the month.
 *    (hr_shifts_daily is per-day only and would give near-zero RevPAH
 *    for past months with sparse ETL runs — headcount estimate is more
 *    reliable for a monthly view.)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  LOCATION_ID_TO_DISPLAY,
  LOCATION_TO_BRAND,
} from "@/lib/constants/hr-mapping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface MonthBounds {
  start: string;
  end: string;
  monthStart: string;
  workdays: number;
}

function monthBounds(monthYYYYMM: string): MonthBounds | null {
  const m = monthYYYYMM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!y || mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, mo, 0).getDate();
  let workdays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(y, mo - 1, d).getDay();
    if (day !== 0 && day !== 6) workdays++;
  }
  return {
    start:      `${y}-${pad(mo)}-01`,
    end:        `${y}-${pad(mo)}-${pad(lastDay)}`,
    monthStart: `${y}-${pad(mo)}-01`,
    workdays,
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

  // ── Revenue by location (same logic as /api/hr/financials) ───────────────
  const revenueByLocation = new Map<string, number>();

  const { data: spaRev, error: spaErr } = await supabase
    .from("spa_revenue_daily")
    .select("location_id, services, product_phytomer, product_purest, product_other")
    .gte("date", bounds.start)
    .lte("date", bounds.end);
  if (spaErr) {
    return NextResponse.json({ error: `spa revenue: ${spaErr.message}` }, { status: 500 });
  }
  for (const r of spaRev ?? []) {
    const loc = LOCATION_ID_TO_DISPLAY[r.location_id as number];
    if (!loc) continue;
    const total =
      Number(r.services ?? 0) +
      Number(r.product_phytomer ?? 0) +
      Number(r.product_purest ?? 0) +
      Number(r.product_other ?? 0);
    revenueByLocation.set(loc, (revenueByLocation.get(loc) ?? 0) + total);
  }

  // aesthetics — include NULL date_of_service rows anchored to month bucket
  const { data: aesRev } = await supabase
    .from("aesthetics_sales_daily")
    .select("price_ex_vat, date_of_service, month")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );
  const aesTotal = (aesRev ?? []).reduce((a, r) => a + Number(r.price_ex_vat ?? 0), 0);
  if (aesTotal > 0) {
    revenueByLocation.set("Aesthetics Centre", aesTotal);
  }

  // slimming — same pattern
  const { data: slmRev } = await supabase
    .from("slimming_sales_daily")
    .select("price_ex_vat, date_of_service, month")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );
  const slmTotal = (slmRev ?? []).reduce((a, r) => a + Number(r.price_ex_vat ?? 0), 0);
  if (slmTotal > 0) {
    revenueByLocation.set("Slimming Centre", slmTotal);
  }

  // ── Headcount: most recent snapshot per location (no date upper bound) ──────
  // The Talexio ETL may have first run after the requested month (e.g. deployed
  // in June for a May report). Restricting to snapshot_date <= month_end would
  // return 0 rows → revpah = 0 for every location. Headcount changes slowly so
  // using the most recent available snapshot is accurate enough for any month.
  const { data: snap } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(200);

  // Keep only the most recent snapshot per location
  const headcountByLocation = new Map<string, number>();
  for (const r of snap ?? []) {
    const loc = r.location_name as string;
    if (!headcountByLocation.has(loc)) {
      headcountByLocation.set(loc, Number(r.active_headcount ?? 0));
    }
  }

  // ── Build rows ────────────────────────────────────────────────────────────
  const allLocations = new Set<string>([
    ...revenueByLocation.keys(),
    ...headcountByLocation.keys(),
  ]);

  const rows = Array.from(allLocations)
    .filter((loc) => loc !== "HQ")
    .map((loc) => {
      const revenue = +(revenueByLocation.get(loc) ?? 0).toFixed(2);
      const headcount = headcountByLocation.get(loc) ?? 0;
      // available hours = headcount × 8h/day × workdays in month
      const availableHours = headcount * 8 * bounds.workdays;
      const revpah = availableHours > 0 ? +(revenue / availableHours).toFixed(2) : null;
      const brand = LOCATION_TO_BRAND[loc] ?? "Spa";
      return { location: loc, revenue, availableHours, headcount, revpah, brand };
    })
    .filter((r) => r.revenue > 0 || r.headcount > 0)
    .sort((a, b) => (b.revpah ?? -1) - (a.revpah ?? -1));

  const validRevpahs = rows.map((r) => r.revpah).filter((v): v is number => v !== null);
  const avgRevpah =
    validRevpahs.length > 0
      ? +(validRevpahs.reduce((a, b) => a + b, 0) / validRevpahs.length).toFixed(2)
      : null;

  return NextResponse.json({
    month,
    byLocation: rows.map((r) => ({
      location:       r.location,
      revpah:         r.revpah ?? 0,
      revenue:        r.revenue,
      availableHours: r.availableHours,
      headcount:      r.headcount,
      dataSource:     "estimated" as const,
    })),
    avgRevPAH: avgRevpah ?? 0,
  });
}
