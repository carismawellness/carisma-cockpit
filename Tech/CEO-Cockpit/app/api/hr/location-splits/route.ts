/**
 * GET /api/hr/location-splits
 *
 * Aggregates Talexio-derived payroll attribution by work location over an
 * ARBITRARY date range. Source of truth is the DAILY table
 * `employee_location_splits_daily` — one row per working shift (or per calendar
 * day for non-rostered staff). To attribute payroll for a range we filter rows
 * by `work_date BETWEEN from AND to` and SUM `wage_share` grouped by location.
 *
 * Table has no RLS (consistent with the ETL) → requires the admin client.
 *
 * Query params (support BOTH styles):
 *   from   YYYY-MM-DD  — range start (preferred)
 *   to     YYYY-MM-DD  — range end   (preferred)
 *   month  YYYY-MM     — back-compat; expands to first..last day of month
 *   location slug      — optional; keep only employees with >0 wage_share at slug
 *
 * Response shape: LocationSplitsData
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface EmployeeLocationSplit {
  talexioId: number;
  employeeName: string;
  /** Display-ish home location (uses home_location_slug). */
  homeLocation: string;
  homeLocationSlug: string;
  /** Sum of this employee's wage_share in range = their attributed pay (2dp). */
  grossWage: number;
  /** Count of rows where shift_type != 'NO_ROSTER' (actual rostered shifts). */
  rosteredDays: number;
  /** slug -> fraction of grossWage (sums to ~1.0), 4dp. */
  locationSplits: Record<string, number>;
  /** slug -> euros attributed (2dp). */
  wageAttribution: Record<string, number>;
  /** slug -> number of days/shifts in range. */
  dayCounts: Record<string, number>;
  wageSource: "payslip" | "extrapolated" | "mixed";
  /** true if ANY row in range is extrapolated. */
  isExtrapolated: boolean;
  attributionSource:
    | "cost_centre"
    | "org_unit_fallback"
    | "no_roster"
    | "mixed";
  /** Max computed_at among this employee's rows (ISO). */
  computedAt: string;
}

export interface LocationSplitsData {
  from: string;
  to: string;
  employees: EmployeeLocationSplit[]; // sorted by grossWage desc
  locationTotals: Record<string, number>; // slug -> summed wage € (2dp)
  totalPayroll: number; // sum of all grossWage (2dp)
  employeeCount: number;
  extrapolatedCount: number; // employees with isExtrapolated
  lastComputed: string | null; // max computed_at overall
}

// ── Raw row from the daily table ───────────────────────────────────────────
interface DailyRow {
  work_date: string;
  talexio_id: number;
  employee_name: string;
  location_slug: string;
  location_source: "cost_centre" | "org_unit_fallback" | "no_roster";
  shift_type: string; // SHIFT | FLEXIBLE_SHIFT | NO_ROSTER
  home_location_slug: string | null;
  wage_source: "payslip" | "extrapolated";
  wage_share: number | string | null;
  computed_at: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function lastDayOfMonth(year: number, month1: number): number {
  // month1 is 1-12 → new Date(year, month1, 0) gives last day of that month
  return new Date(year, month1, 0).getDate();
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const monthParam = searchParams.get("month");
  let fromParam = searchParams.get("from");
  let toParam = searchParams.get("to");
  const locationParam = searchParams.get("location");

  // Resolve range: prefer from/to, fall back to month expansion.
  if ((!fromParam || !toParam) && monthParam) {
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json(
        { error: "Invalid ?month=YYYY-MM" },
        { status: 400 }
      );
    }
    const [y, m] = monthParam.split("-").map(Number);
    fromParam = `${monthParam}-01`;
    toParam = `${monthParam}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  }

  if (
    !fromParam ||
    !toParam ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fromParam) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toParam)
  ) {
    return NextResponse.json(
      { error: "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD or ?month=YYYY-MM" },
      { status: 400 }
    );
  }

  const from = fromParam;
  const to = toParam;

  try {
    const supabase = getAdminClient();

    // ── Fetch ALL rows in range with .range() pagination (default 1000 cap) ──
    const PAGE = 1000;
    let offset = 0;
    const rows: DailyRow[] = [];
    for (;;) {
      const { data, error } = await supabase
        .from("employee_location_splits_daily")
        .select(
          "work_date, talexio_id, employee_name, location_slug, location_source, shift_type, home_location_slug, wage_source, wage_share, computed_at"
        )
        .gte("work_date", from)
        .lte("work_date", to)
        .order("talexio_id", { ascending: true })
        .order("work_date", { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (error) {
        console.error("[location-splits] Supabase error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const batch = (data ?? []) as DailyRow[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }

    // ── Aggregate per employee ──────────────────────────────────────────────
    interface Acc {
      talexioId: number;
      employeeName: string;
      homeLocationSlug: string;
      grossWage: number; // full precision
      rosteredDays: number;
      wageBySlug: Record<string, number>; // full precision
      dayCounts: Record<string, number>;
      wageSources: Set<string>;
      attributionSources: Set<string>;
      computedAt: string | null;
    }

    const byEmployee = new Map<number, Acc>();

    for (const r of rows) {
      const share = Number(r.wage_share ?? 0);
      let acc = byEmployee.get(r.talexio_id);
      if (!acc) {
        acc = {
          talexioId: r.talexio_id,
          employeeName: r.employee_name,
          homeLocationSlug: r.home_location_slug ?? "",
          grossWage: 0,
          rosteredDays: 0,
          wageBySlug: {},
          dayCounts: {},
          wageSources: new Set(),
          attributionSources: new Set(),
          computedAt: null,
        };
        byEmployee.set(r.talexio_id, acc);
      }

      // Keep a non-empty home slug if a later row provides one.
      if (!acc.homeLocationSlug && r.home_location_slug) {
        acc.homeLocationSlug = r.home_location_slug;
      }

      acc.grossWage += share;
      acc.wageBySlug[r.location_slug] =
        (acc.wageBySlug[r.location_slug] ?? 0) + share;
      acc.dayCounts[r.location_slug] =
        (acc.dayCounts[r.location_slug] ?? 0) + 1;

      if (r.shift_type && r.shift_type !== "NO_ROSTER") acc.rosteredDays += 1;

      acc.wageSources.add(r.wage_source);
      acc.attributionSources.add(r.location_source);

      if (
        r.computed_at &&
        (acc.computedAt === null || r.computed_at > acc.computedAt)
      ) {
        acc.computedAt = r.computed_at;
      }
    }

    // ── Build response employees ────────────────────────────────────────────
    let employees: EmployeeLocationSplit[] = Array.from(byEmployee.values()).map(
      (acc) => {
        const wageAttribution: Record<string, number> = {};
        const locationSplits: Record<string, number> = {};
        for (const [slug, amt] of Object.entries(acc.wageBySlug)) {
          wageAttribution[slug] = round2(amt);
          locationSplits[slug] =
            acc.grossWage > 0 ? round4(amt / acc.grossWage) : 0;
        }

        const wageSource: EmployeeLocationSplit["wageSource"] =
          acc.wageSources.size > 1
            ? "mixed"
            : (acc.wageSources.values().next().value as
                | "payslip"
                | "extrapolated") ?? "payslip";

        const attributionSource: EmployeeLocationSplit["attributionSource"] =
          acc.attributionSources.size > 1
            ? "mixed"
            : (acc.attributionSources.values().next().value as
                | "cost_centre"
                | "org_unit_fallback"
                | "no_roster") ?? "no_roster";

        return {
          talexioId: acc.talexioId,
          employeeName: acc.employeeName,
          homeLocation: acc.homeLocationSlug,
          homeLocationSlug: acc.homeLocationSlug,
          grossWage: round2(acc.grossWage),
          rosteredDays: acc.rosteredDays,
          locationSplits,
          wageAttribution,
          dayCounts: acc.dayCounts,
          wageSource,
          isExtrapolated: acc.wageSources.has("extrapolated"),
          attributionSource,
          computedAt: acc.computedAt ?? "",
        };
      }
    );

    // ── Optional location filter (keep employees with >0 wage there) ─────────
    if (locationParam) {
      employees = employees.filter(
        (e) => (e.wageAttribution[locationParam] ?? 0) > 0
      );
    }

    // ── Sort by grossWage desc ──────────────────────────────────────────────
    employees.sort((a, b) => b.grossWage - a.grossWage);

    // ── Group totals ────────────────────────────────────────────────────────
    const locationTotalsRaw: Record<string, number> = {};
    let totalPayrollRaw = 0;
    let extrapolatedCount = 0;
    let lastComputed: string | null = null;

    for (const e of employees) {
      totalPayrollRaw += e.grossWage;
      if (e.isExtrapolated) extrapolatedCount += 1;
      for (const [slug, amt] of Object.entries(e.wageAttribution)) {
        locationTotalsRaw[slug] = (locationTotalsRaw[slug] ?? 0) + amt;
      }
      if (
        e.computedAt &&
        (lastComputed === null || e.computedAt > lastComputed)
      ) {
        lastComputed = e.computedAt;
      }
    }

    const locationTotals: Record<string, number> = {};
    for (const [slug, amt] of Object.entries(locationTotalsRaw)) {
      locationTotals[slug] = round2(amt);
    }

    const response: LocationSplitsData = {
      from,
      to,
      employees,
      locationTotals,
      totalPayroll: round2(totalPayrollRaw),
      employeeCount: employees.length,
      extrapolatedCount,
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
