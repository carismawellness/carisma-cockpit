/**
 * GET /api/hr/revpah?month=YYYY-MM
 *
 * Revenue per available hour by location.
 *
 *  - Revenue: spa_revenue_daily + aesthetics_sales_daily + slimming_sales_daily
 *    (populated from the Cockpit Google Sheet, same as all other revenue surfaces)
 *
 *  - Therapist headcount (spa locations): distinct employee_name values in
 *    spa_services_by_employee_daily for the month. This counts only therapists
 *    who actually performed services — the only staff who generate direct revenue.
 *
 *  - Headcount (aesthetics/slimming): falls back to most recent Talexio snapshot
 *    since those brands don't have per-employee service tables yet.
 *
 *  RevPAH = revenue / (therapist_count × 8h × workdays_in_month)
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

  // ── Therapist headcount: spa locations from service records ─────────────────
  // Count distinct therapists who performed services in the month per location.
  // This is more accurate than total headcount from Talexio because it only
  // counts revenue-generating staff, not managers/receptionists/admin.
  const { data: svcRows } = await supabase
    .from("spa_services_by_employee_daily")
    .select("location_id, employee_name")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end)
    .not("employee_name", "is", null);

  const headcountByLocation = new Map<string, number>();
  // Count distinct therapists per location
  const therapistSetByLocId = new Map<number, Set<string>>();
  for (const r of svcRows ?? []) {
    const locId = r.location_id as number;
    const name  = String(r.employee_name ?? "").trim();
    if (!name) continue;
    if (!therapistSetByLocId.has(locId)) therapistSetByLocId.set(locId, new Set());
    therapistSetByLocId.get(locId)!.add(name);
  }
  for (const [locId, names] of therapistSetByLocId) {
    const loc = LOCATION_ID_TO_DISPLAY[locId];
    if (loc) headcountByLocation.set(loc, names.size);
  }

  // ── Fallback headcount for aesthetics/slimming (no per-employee table yet) ──
  // Only fills in locations not already covered by the services query above.
  const { data: snap } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .in("location_name", ["Aesthetics Centre", "Slimming Centre"])
    .order("snapshot_date", { ascending: false })
    .limit(20);
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
