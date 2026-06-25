/**
 * POST /api/etl/talexio-location-splits?month=YYYY-MM
 *
 * Per-employee per-DAY location wage attribution driven by the Talexio ROSTER
 * (work shifts) — NOT GPS. Writes to `employee_location_splits_daily`, one row
 * per working shift, so ANY date range can be attributed by summing wage_share.
 *
 * ── Algorithm ───────────────────────────────────────────────────────────────
 * 1. Compute month bounds (firstDay, lastDay, daysInMonth).
 * 2. Fetch ALL employees with org unit, payslips, and the month's workShifts.
 * 3. Active = !isTerminated && !currentPositionSimple.isEnded.
 * 4. Per active employee:
 *    a. home_slug from org unit (default 'hq').
 *    b. monthly_gross from payslip whose periodFrom month === month
 *       (wage_source='payslip'); else most-recent prior payslip
 *       (wage_source='extrapolated', extrapolated_from=that month); else 0.
 *    c. workingShifts = shifts with type in {SHIFT, FLEXIBLE_SHIFT}.
 *    d. If working shifts exist → wage_share = gross / count, one row per shift
 *       (location from costCentre, else org-unit fallback). The LAST shift gets
 *       the remainder so the per-employee sum equals gross exactly.
 *    e. Else (no working shifts):
 *       - gross > 0 → one row per CALENDAR DAY (home_slug, source='no_roster',
 *         wage_share = gross / daysInMonth, last day gets remainder).
 *       - gross == 0 → no rows.
 * 5. DELETE existing rows for the month, then bulk-insert (chunks of 500).
 *
 * ── costCentre.id → slug (primary; name as fallback) ─────────────────────────
 *   8091 "intercontinental hotel malta"   → inter
 *   8092 "Hugos Hotel"                     → hugos
 *   8093 "Hyatt Regency Malta"            → hyatt
 *   8094 "Ramla Bay Resort"              → ramla
 *   8095 "Sunny Coast"                   → odycy
 *   8096 "Labranda Riviera Hotel & Spa"  → labranda
 *
 * ── org-unit name → slug (fallback + non-hotel staff) ────────────────────────
 *   "inter spa"→inter, "hugos"→hugos, "ramla"→ramla, "hyatt"→hyatt,
 *   "excelsior"→excelsior, "sunny coast"→odycy, "riveira"→labranda,
 *   "novotel"→novotel, "management/spa operations/crm/marketing/growth"→hq,
 *   "carisma aesthetics/aesthetics"→aesthetics, "slimming"→slimming.
 *   Unknown → "hq".
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";

export const maxDuration = 300;

// ── costCentre id → canonical slug (primary signal) ─────────────────────────
const COST_CENTRE_ID_TO_SLUG: Record<string, string> = {
  "8091": "inter",
  "8092": "hugos",
  "8093": "hyatt",
  "8094": "ramla",
  "8095": "odycy",
  "8096": "labranda",
};

// ── costCentre name → canonical slug (fallback if id unknown) ────────────────
const COST_CENTRE_NAME_TO_SLUG: Record<string, string> = {
  "intercontinental hotel malta": "inter",
  "hugos hotel":                  "hugos",
  "hyatt regency malta":          "hyatt",
  "ramla bay resort":             "ramla",
  "sunny coast":                  "odycy",
  "labranda riviera hotel & spa": "labranda",
};

// ── org unit name → canonical slug (fallback + non-hotel staff) ─────────────
const ORG_UNIT_TO_SLUG: Record<string, string> = {
  "inter spa":          "inter",
  "hugos":              "hugos",
  "ramla":              "ramla",
  "hyatt":              "hyatt",
  "excelsior":          "excelsior",
  "sunny coast":        "odycy",
  "riveira":            "labranda", // EXACT Talexio spelling
  "novotel":            "novotel",
  "management":         "hq",
  "spa operations":     "hq",
  "crm":                "hq",
  "marketing":          "hq",
  "growth":             "hq",
  "carisma aesthetics": "aesthetics",
  "aesthetics":         "aesthetics",
  "slimming":           "slimming",
};

function orgUnitToSlug(orgName: string | null | undefined): string {
  if (!orgName) return "hq";
  return ORG_UNIT_TO_SLUG[orgName.toLowerCase().trim()] ?? "hq";
}

function costCentreToSlug(
  id: string | null | undefined,
  name: string | null | undefined,
): string | null {
  if (id && COST_CENTRE_ID_TO_SLUG[String(id)]) {
    return COST_CENTRE_ID_TO_SLUG[String(id)];
  }
  if (name && COST_CENTRE_NAME_TO_SLUG[name.toLowerCase().trim()]) {
    return COST_CENTRE_NAME_TO_SLUG[name.toLowerCase().trim()];
  }
  return null;
}

const WORKING_SHIFT_TYPES = new Set(["SHIFT", "FLEXIBLE_SHIFT"]);

function monthBounds(month: string): {
  firstDay:    string;
  lastDay:     string;
  daysInMonth: number;
} | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y  = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const daysInMonth = new Date(y, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    firstDay:    `${y}-${pad(mo)}-01`,
    lastDay:     `${y}-${pad(mo)}-${pad(daysInMonth)}`,
    daysInMonth,
  };
}

// ── Talexio GraphQL response shapes ─────────────────────────────────────────
interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface RawWorkShift {
  id:   string;
  date: string;               // YYYY-MM-DD
  type: string;               // SHIFT | FLEXIBLE_SHIFT | OFF | REST | ...
  costCentre?: { id: string; name: string } | null;
}

interface RawEmployee {
  id:           number;
  fullName:     string;
  isTerminated: boolean;
  currentPositionSimple?: {
    isEnded:           boolean;
    organisationUnit?: { id: number; name: string } | null;
  } | null;
  payslips?: Array<{
    gross:      number;
    net:        number;
    periodFrom: string;       // YYYY-MM-DD
    periodTo:   string;
  }>;
  workShifts?: RawWorkShift[];
}

const GQL_EMPLOYEES = `query ($f: Date!, $t: Date!) {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      isEnded
      organisationUnit { id name }
    }
    payslips {
      ... on PayrollPayslip { id gross net periodFrom periodTo }
    }
    workShifts(dateFrom: $f, dateTo: $t, onlyPublished: true) {
      id date type costCentre { id name }
    }
  }
}`;

async function fetchTalexio<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const json = (await talexioQuery(query, variables)) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(
      `Talexio GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!json.data) throw new Error("Talexio query returned no data");
  return json.data;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }

  const bounds = monthBounds(month);
  if (!bounds) {
    return NextResponse.json({ error: "Invalid month format — use YYYY-MM" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const computedAt = new Date().toISOString();

  // ── 1. Fetch employees + payslips + month's workShifts ──────────────────────
  const empData = await fetchTalexio<{ employees: RawEmployee[] }>(GQL_EMPLOYEES, {
    f: bounds.firstDay,
    t: bounds.lastDay,
  });
  const allEmployees = empData.employees ?? [];
  const activeEmployees = allEmployees.filter(
    (e) => !e.isTerminated && !e.currentPositionSimple?.isEnded,
  );

  // ── 2. Build per-day rows ───────────────────────────────────────────────────
  const rows: Record<string, unknown>[] = [];
  const wageSources:     Record<string, number> = { payslip: 0, extrapolated: 0 };
  const locationSources: Record<string, number> = {
    cost_centre: 0,
    org_unit_fallback: 0,
    no_roster: 0,
  };
  let totalMonthlyGross = 0;
  let employeesProcessed = 0;

  for (const emp of activeEmployees) {
    const homeSlug = orgUnitToSlug(emp.currentPositionSimple?.organisationUnit?.name);

    // ── Payslip gross + extrapolation ────────────────────────────────────────
    const payslips = (emp.payslips ?? []).filter((ps) => ps?.periodFrom);
    const exactPayslip = payslips.find(
      (ps) => String(ps.periodFrom).slice(0, 7) === month,
    );

    let monthlyGross = 0;
    let wageSource: "payslip" | "extrapolated" = "payslip";
    let extrapolatedFrom: string | null = null;

    if (exactPayslip) {
      monthlyGross = round2(Number(exactPayslip.gross ?? 0));
      wageSource = "payslip";
    } else {
      // most recent payslip with periodFrom month < requested month
      const priorPayslips = payslips
        .filter((ps) => String(ps.periodFrom).slice(0, 7) < month)
        .sort((a, b) => String(b.periodFrom).localeCompare(String(a.periodFrom)));
      if (priorPayslips.length > 0) {
        monthlyGross = round2(Number(priorPayslips[0].gross ?? 0));
        wageSource = "extrapolated";
        extrapolatedFrom = `${String(priorPayslips[0].periodFrom).slice(0, 7)}-01`;
      } else {
        monthlyGross = 0;
        wageSource = "payslip"; // nothing to extrapolate from
      }
    }

    // Skip employees with no salary to attribute (no payslip for the month and
    // no prior payslip to extrapolate from). They contribute €0 to every
    // location and would otherwise (a) emit zero-wage rows that clutter the
    // per-location employee lists and (b) be mislabeled wage_source='payslip'
    // despite having no payslip. QC 2026-06-25.
    if (monthlyGross <= 0) continue;

    // ── Working shifts (SHIFT | FLEXIBLE_SHIFT only) ──────────────────────────
    const workingShifts = (emp.workShifts ?? [])
      .filter((s) => WORKING_SHIFT_TYPES.has(s.type))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const baseRow = {
      talexio_id:        emp.id,
      employee_name:     emp.fullName,
      home_location_slug: homeSlug,
      monthly_gross:     monthlyGross,
      wage_source:       wageSource,
      extrapolated_from: extrapolatedFrom,
      computed_at:       computedAt,
    };

    if (workingShifts.length > 0) {
      employeesProcessed++;
      const denom = workingShifts.length;
      const perShare = round4(monthlyGross / denom);
      let allocated = 0;

      workingShifts.forEach((shift, idx) => {
        const ccSlug = costCentreToSlug(shift.costCentre?.id, shift.costCentre?.name);
        const useCostCentre = ccSlug !== null;
        const locationSlug = useCostCentre ? ccSlug! : homeSlug;
        const locationSource = useCostCentre ? "cost_centre" : "org_unit_fallback";
        locationSources[locationSource]++;

        // Last shift carries the rounding remainder so the employee total == gross.
        const isLast = idx === workingShifts.length - 1;
        const wageShare = isLast
          ? round4(monthlyGross - allocated)
          : perShare;
        allocated = round4(allocated + perShare);

        rows.push({
          ...baseRow,
          work_date:              shift.date,
          location_slug:          locationSlug,
          location_source:        locationSource,
          cost_centre_id:         shift.costCentre?.id ?? null,
          cost_centre_name:       shift.costCentre?.name ?? null,
          shift_id:               shift.id,
          shift_type:             shift.type,
          working_units_in_month: denom,
          wage_share:             wageShare,
        });
      });

      if (wageSource === "payslip") wageSources.payslip++;
      else wageSources.extrapolated++;
      totalMonthlyGross = round2(totalMonthlyGross + monthlyGross);
    } else if (monthlyGross > 0) {
      // ── No roster fallback: distribute gross across calendar days ───────────
      employeesProcessed++;
      const denom = bounds.daysInMonth;
      const perShare = round4(monthlyGross / denom);
      let allocated = 0;
      const [y, mo] = month.split("-").map((n) => parseInt(n, 10));
      const pad = (n: number) => String(n).padStart(2, "0");

      for (let d = 1; d <= denom; d++) {
        const workDate = `${y}-${pad(mo)}-${pad(d)}`;
        locationSources.no_roster++;
        const isLast = d === denom;
        const wageShare = isLast ? round4(monthlyGross - allocated) : perShare;
        allocated = round4(allocated + perShare);

        rows.push({
          ...baseRow,
          work_date:              workDate,
          location_slug:          homeSlug,
          location_source:        "no_roster",
          cost_centre_id:         null,
          cost_centre_name:       null,
          shift_id:               `synthetic-${workDate}`,
          shift_type:             "NO_ROSTER",
          working_units_in_month: denom,
          wage_share:             wageShare,
        });
      }

      if (wageSource === "payslip") wageSources.payslip++;
      else wageSources.extrapolated++;
      totalMonthlyGross = round2(totalMonthlyGross + monthlyGross);
    }
    // else: no working shifts AND no gross → skip (no rows)
  }

  // ── 3. Idempotent replace: delete the month, then bulk-insert ───────────────
  const { error: deleteError } = await supabase
    .from("employee_location_splits_daily")
    .delete()
    .gte("work_date", bounds.firstDay)
    .lte("work_date", bounds.lastDay);

  if (deleteError) {
    return NextResponse.json({ error: `delete failed: ${deleteError.message}` }, { status: 500 });
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error: insertError } = await supabase
      .from("employee_location_splits_daily")
      .insert(chunk);
    if (insertError) {
      return NextResponse.json(
        { error: `insert failed at chunk ${i / CHUNK}: ${insertError.message}` },
        { status: 500 },
      );
    }
  }

  // ── 4. Summary ──────────────────────────────────────────────────────────────
  const locationTotals: Record<string, number> = {};
  let totalAttributed = 0;
  for (const r of rows as Array<{ location_slug: string; wage_share: number }>) {
    locationTotals[r.location_slug] = round4(
      (locationTotals[r.location_slug] ?? 0) + r.wage_share,
    );
    totalAttributed = round4(totalAttributed + r.wage_share);
  }

  return NextResponse.json({
    month,
    employees_processed: employeesProcessed,
    rows_inserted:       rows.length,
    wage_sources:        wageSources,
    location_sources:    locationSources,
    location_totals:     locationTotals,
    total_attributed:    round2(totalAttributed),
    total_monthly_gross: round2(totalMonthlyGross),
  });
}

/** Support GET for ease of manual triggering (matches other ETL routes). */
export async function GET(req: NextRequest) {
  return POST(req);
}
