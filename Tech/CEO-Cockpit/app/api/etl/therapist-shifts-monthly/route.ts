/**
 * POST /api/etl/therapist-shifts-monthly?month=YYYY-MM
 *
 * Pulls scheduled shifts for therapist-role employees from Talexio and
 * aggregates to hr_therapist_shifts_monthly — the source-of-truth denominator
 * for RevPAH (Revenue per Available Hour).
 *
 * Why this ETL exists:
 *   The previous approach used (headcount × 8h × workdays) which included ALL
 *   staff (receptionists, managers, coordinators) and assumed all 8h per day.
 *   This ETL uses:
 *     1. Position-filtered headcount — therapist roles only.
 *     2. Actual scheduled shift hours — part-time and variable-hour staff handled.
 *
 * Therapist position matching:
 *   Uses case-insensitive substring matching. Any position whose name contains
 *   one of THERAPIST_KEYWORDS is counted as a revenue-generating therapist.
 *   Update THERAPIST_KEYWORDS if Talexio position naming changes.
 *
 * The nightly cron calls this for the current month. Historical backfill:
 *   POST /api/etl/therapist-shifts-monthly?month=2026-05
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";
import { normaliseLocation, brandForLocation } from "@/lib/constants/hr-mapping";

export const maxDuration = 60;

// ── Position keywords that identify revenue-generating therapists ─────────────
// Case-insensitive. Add more if Talexio uses other naming conventions.
const THERAPIST_KEYWORDS = [
  "therapist",
  "beautician",
  "beauty therapist",
  "massage",
  "treatment",
  "esthetician",
  "aesthetician",
  "slimming",
  "body contouring",
];

function isTherapistPosition(positionName: string | null | undefined): boolean {
  if (!positionName) return false;
  const lower = positionName.toLowerCase();
  return THERAPIST_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── Shift duration in hours from Talexio ISO datetime strings ────────────────
function shiftHours(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  // Talexio returns full ISO datetimes: "2026-06-11T08:00:00+02:00"
  // or time-only strings: "08:00" / "08:00:00"
  const parseMs = (s: string): number => {
    if (s.includes("T")) return new Date(s).getTime();
    // time-only — attach a dummy date so we can diff
    return new Date(`1970-01-01T${s.length === 5 ? s + ":00" : s}Z`).getTime();
  };
  const diff = (parseMs(to) - parseMs(from)) / 3_600_000;
  // Guard against negative (cross-midnight) or implausibly long shifts
  return diff > 0 && diff <= 16 ? diff : 0;
}

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(yyyyMM: string): { start: string; end: string } | null {
  const m = yyyyMM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, mo, 0).getDate();
  return { start: `${y}-${pad(mo)}-01`, end: `${y}-${pad(mo)}-${pad(last)}` };
}

// ── GraphQL shapes ────────────────────────────────────────────────────────────
type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface TalexioEmployee {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: {
    isEnded: boolean;
    position?: { name: string } | null;
    organisationUnit?: { name: string } | null;
  } | null;
}

interface TalexioShiftEmployee {
  id: string;
  fullName: string;
  workShifts: Array<{
    id: string;
    date: string;
    from: string | null;
    to: string | null;
    type: string | null;
  }>;
}

const GQL_EMPLOYEES = `query {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      id isEnded
      position { id name }
      organisationUnit { id name }
    }
  }
}`;

const GQL_SHIFTS = `query ($employeeIds: [ID!]!, $dateFrom: Date!, $dateTo: Date!) {
  selectedEmployees: employees(params: { employeeIds: $employeeIds }) {
    id fullName
    workShifts(dateFrom: $dateFrom, dateTo: $dateTo, onlyPublished: true) {
      id date from to type
    }
  }
}`;

async function fetchTalexio<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const json = (await talexioQuery(query, variables)) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Talexio: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Talexio query returned no data");
  return json.data;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const monthParam = searchParams.get("month") || currentMonthYYYYMM();
  const bounds = monthBounds(monthParam);
  if (!bounds) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const monthStart = `${monthParam}-01`;

  const supabase = getAdminClient();

  // ── 1. Fetch all active employees with positions ──────────────────────────
  const empData = await fetchTalexio<{ employees: TalexioEmployee[] }>(GQL_EMPLOYEES);
  const allEmployees = empData.employees ?? [];

  // Filter to active therapists only
  const therapists = allEmployees.filter((e) => {
    if (e.isTerminated || e.currentPositionSimple?.isEnded) return false;
    return isTherapistPosition(e.currentPositionSimple?.position?.name);
  });

  if (therapists.length === 0) {
    return NextResponse.json({
      status: "ok",
      month: monthParam,
      therapists_found: 0,
      warning: "No active therapist-role employees found. Check THERAPIST_KEYWORDS list.",
    });
  }

  // Build employee_id → location map. Skip employees with unrecognised org
  // units — a "Spa" catch-all row with €0 revenue dragged the brand average
  // down by ~€6/hr when 5 therapists were bucketed there.
  const empToLocation = new Map<string, string>();
  const unmatchedUnits = new Map<string, string>(); // unit name → employee name
  for (const e of therapists) {
    const unit = e.currentPositionSimple?.organisationUnit?.name ?? null;
    const loc = normaliseLocation(unit);
    if (!loc) {
      if (unit) unmatchedUnits.set(unit, e.fullName);
      continue;
    }
    empToLocation.set(e.id, loc);
  }

  // ── 2. Fetch shifts for all therapists over the full month ────────────────
  const CHUNK = 100;
  const therapistIds = therapists.map((e) => e.id);

  // location → { hours, names }
  const byLocation = new Map<string, { hours: number; names: Set<string> }>();

  for (let i = 0; i < therapistIds.length; i += CHUNK) {
    const chunk = therapistIds.slice(i, i + CHUNK);
    const shiftData = await fetchTalexio<{ selectedEmployees: TalexioShiftEmployee[] }>(
      GQL_SHIFTS,
      { employeeIds: chunk, dateFrom: bounds.start, dateTo: bounds.end },
    );

    for (const emp of shiftData.selectedEmployees ?? []) {
      const loc = empToLocation.get(emp.id);
      if (!loc) continue; // skip employees whose org unit didn't resolve to a known location
      const bucket = byLocation.get(loc) ?? { hours: 0, names: new Set() };

      for (const s of emp.workShifts ?? []) {
        // Skip off-shifts / leave / absent markers
        if (s.type && ["absent", "leave", "holiday", "off"].includes(s.type.toLowerCase())) {
          continue;
        }
        bucket.hours += shiftHours(s.from, s.to);
        bucket.names.add(emp.fullName);
      }

      byLocation.set(loc, bucket);
    }
  }

  // ── 3. Upsert hr_therapist_shifts_monthly ────────────────────────────────
  const rows = Array.from(byLocation.entries()).map(([location_name, v]) => ({
    month:                 monthStart,
    location_name,
    brand_name:            brandForLocation(location_name) ?? "Spa",
    therapist_count:       v.names.size,
    total_scheduled_hours: +v.hours.toFixed(2),
    therapist_names:       Array.from(v.names).sort(),
    updated_at:            new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from("hr_therapist_shifts_monthly")
      .upsert(rows, { onConflict: "month,location_name" });
    if (error) {
      return NextResponse.json({ error: `upsert failed: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    status: "ok",
    month: monthParam,
    therapists_found: therapists.length,
    therapists_matched: empToLocation.size,
    therapists_skipped: unmatchedUnits.size,
    unmatched_units: Object.fromEntries(unmatchedUnits),
    locations: rows.map((r) => ({
      location:   r.location_name,
      therapists: r.therapist_count,
      hours:      r.total_scheduled_hours,
    })),
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
