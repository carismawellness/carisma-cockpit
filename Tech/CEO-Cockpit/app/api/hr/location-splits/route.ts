/**
 * GET /api/hr/location-splits?month=YYYY-MM[&location=slug]
 *
 * Returns Talexio-derived payroll attribution broken down by work location.
 * Source table: employee_location_splits_monthly (no RLS — requires admin client).
 *
 * Query params:
 *   month    YYYY-MM  (required) — converted internally to YYYY-MM-01 DATE
 *   location slug     (optional) — filter to employees whose home_location_slug matches
 *
 * Response shape: LocationSplitsResponse
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface EmployeeLocationSplit {
  id: number;
  talexioId: number;
  employeeName: string;
  homeLocation: string;
  homeLocationSlug: string;
  grossWage: number;
  totalEvents: number;
  locationSplits: Record<string, number>;
  wageAttribution: Record<string, number>;
  shiftBreakdown: Record<string, number> | null;
  attributionSource: "gps_timelogs" | "org_unit_static" | "no_position";
  computedAt: string;
}

interface LocationSplitsResponse {
  month: string;
  employees: EmployeeLocationSplit[];
  locationTotals: Record<string, number>;
  totalPayroll: number;
  employeeCount: number;
  crossLocationCount: number;
  lastComputed: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const monthParam = searchParams.get("month");
  const locationParam = searchParams.get("location");

  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return NextResponse.json(
      { error: "Missing or invalid ?month=YYYY-MM" },
      { status: 400 }
    );
  }

  // Convert YYYY-MM → YYYY-MM-01 for DATE column comparison
  const monthDate = `${monthParam}-01`;

  try {
    const supabase = getAdminClient();

    let query = supabase
      .from("employee_location_splits_monthly")
      .select(
        "id, talexio_id, employee_name, home_location, home_location_slug, gross_wage, total_events, location_splits, wage_attribution, shift_breakdown, attribution_source, computed_at"
      )
      .eq("month", monthDate)
      .order("employee_name", { ascending: true });

    if (locationParam) {
      query = query.eq("home_location_slug", locationParam);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[location-splits] Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // Map snake_case DB columns → camelCase TypeScript interface
    const employees: EmployeeLocationSplit[] = rows.map((r) => ({
      id: r.id,
      talexioId: r.talexio_id,
      employeeName: r.employee_name,
      homeLocation: r.home_location,
      homeLocationSlug: r.home_location_slug,
      grossWage: Number(r.gross_wage ?? 0),
      totalEvents: r.total_events ?? 0,
      locationSplits: (r.location_splits as Record<string, number>) ?? {},
      wageAttribution: (r.wage_attribution as Record<string, number>) ?? {},
      shiftBreakdown: (r.shift_breakdown as Record<string, number>) ?? null,
      attributionSource: r.attribution_source as EmployeeLocationSplit["attributionSource"],
      computedAt: r.computed_at,
    }));

    // Aggregate wage_attribution totals per location slug across all employees
    const locationTotals: Record<string, number> = {};
    let totalPayroll = 0;
    let lastComputed: string | null = null;

    for (const emp of employees) {
      totalPayroll += emp.grossWage;

      for (const [slug, amount] of Object.entries(emp.wageAttribution)) {
        locationTotals[slug] = (locationTotals[slug] ?? 0) + amount;
      }

      if (
        emp.computedAt &&
        (lastComputed === null || emp.computedAt > lastComputed)
      ) {
        lastComputed = emp.computedAt;
      }
    }

    const crossLocationCount = employees.filter(
      (e) => e.attributionSource === "gps_timelogs"
    ).length;

    const response: LocationSplitsResponse = {
      month: monthParam,
      employees,
      locationTotals,
      totalPayroll,
      employeeCount: employees.length,
      crossLocationCount,
      lastComputed,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[location-splits] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
