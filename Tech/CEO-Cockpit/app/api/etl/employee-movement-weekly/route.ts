/**
 * POST /api/etl/employee-movement-weekly?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Queries ALL Talexio employees (including terminated) for hire/termination dates,
 * then aggregates into weekly buckets and upserts hr_employee_movement_weekly.
 *
 * Date source priority:
 *   1. Employee-level hireDate / terminationDate  (most accurate — what Talexio calls hire date)
 *   2. currentPositionSimple.startDate / endDate  (fallback if employee-level fields absent)
 *
 * Default window: last 52 weeks. Override with ?from=&to= params.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";

export const maxDuration = 60;

type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface EmpWithHireDate {
  id: string;
  fullName: string;
  isTerminated: boolean;
  hireDate: string | null;
  terminationDate: string | null;
}

interface EmpWithPositionDates {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: {
    startDate: string | null;
    endDate:   string | null;
  } | null;
}

// Normalised internal shape
interface EmpRow {
  id:               string;
  fullName:         string;
  isTerminated:     boolean;
  hireDate:         string | null;
  terminationDate:  string | null;
}

const GQL_HIRE_DATE = `query {
  employees {
    id fullName isTerminated
    hireDate
    terminationDate
  }
}`;

const GQL_POSITION_DATES = `query {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      startDate
      endDate
    }
  }
}`;

async function fetchTalexio<T>(q: string): Promise<T> {
  const json = (await talexioQuery(q)) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) throw new Error("No data returned");
  return json.data;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Monday of ISO week containing date d
function isoWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const supabase = getAdminClient();

  // ── Date window ────────────────────────────────────────────────────────────
  const now = new Date();
  const defaultFrom = addDays(now, -(52 * 7));
  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");
  const fromDate  = fromParam ? new Date(fromParam) : defaultFrom;
  const toDate    = toParam   ? new Date(toParam)   : now;

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }

  // ── Fetch employees with date info ─────────────────────────────────────────
  let employees: EmpRow[] = [];
  let dateSource = "hireDate";

  try {
    const data = await fetchTalexio<{ employees: EmpWithHireDate[] }>(GQL_HIRE_DATE);
    employees = (data.employees ?? []).map((e) => ({
      id:              e.id,
      fullName:        e.fullName,
      isTerminated:    e.isTerminated,
      hireDate:        e.hireDate ?? null,
      terminationDate: e.terminationDate ?? null,
    }));

    // If ALL active employees have null hireDate, the field exists but is empty.
    // That's still valid — we'll just have 0 joiners recorded.
  } catch {
    // hireDate / terminationDate not in schema — fall back to position dates
    dateSource = "positionStartDate";
    try {
      const data = await fetchTalexio<{ employees: EmpWithPositionDates[] }>(GQL_POSITION_DATES);
      employees = (data.employees ?? []).map((e) => ({
        id:              e.id,
        fullName:        e.fullName,
        isTerminated:    e.isTerminated,
        hireDate:        e.currentPositionSimple?.startDate ?? null,
        terminationDate: e.isTerminated ? (e.currentPositionSimple?.endDate ?? null) : null,
      }));
    } catch (e2) {
      return NextResponse.json(
        { error: `Both date strategies failed: ${e2 instanceof Error ? e2.message : String(e2)}` },
        { status: 500 },
      );
    }
  }

  // ── Build ISO-week buckets ─────────────────────────────────────────────────
  // Walk from the Monday of the fromDate week to the Monday of the toDate week.
  const weeks: Array<{ monday: Date; sunday: Date }> = [];
  let cursor = isoWeekMonday(fromDate);
  const lastWeekMonday = isoWeekMonday(toDate);
  while (cursor <= lastWeekMonday) {
    weeks.push({ monday: new Date(cursor), sunday: addDays(cursor, 6) });
    cursor = addDays(cursor, 7);
  }

  // ── Per-week computation ───────────────────────────────────────────────────
  const rows = weeks.map(({ monday, sunday }) => {
    const weekStart = toYMD(monday);
    const weekEnd   = toYMD(sunday);
    const sunEOD    = new Date(sunday); sunEOD.setHours(23, 59, 59, 999);

    const joinerNames: string[] = [];
    const leaverNames: string[] = [];

    for (const e of employees) {
      const hDate = e.hireDate  ? new Date(e.hireDate)  : null;
      const tDate = e.terminationDate ? new Date(e.terminationDate) : null;

      if (hDate && hDate >= monday && hDate <= sunEOD) {
        joinerNames.push(e.fullName);
      }
      if (tDate && tDate >= monday && tDate <= sunEOD) {
        leaverNames.push(e.fullName);
      }
    }

    const joiners = joinerNames.length;
    const leavers = leaverNames.length;

    // Total active at end of this week: hired on or before week end, not yet terminated
    const totalHeadcount = employees.filter((e) => {
      const hDate = e.hireDate ? new Date(e.hireDate) : null;
      const tDate = e.terminationDate ? new Date(e.terminationDate) : null;
      if (!hDate || hDate > sunEOD) return false;
      if (tDate && tDate <= sunEOD) return false;
      return true;
    }).length;

    return {
      week_start:      weekStart,
      week_end:        weekEnd,
      joiners,
      leavers,
      net:             joiners - leavers,
      total_headcount: totalHeadcount,
      joiner_names:    joinerNames,
      leaver_names:    leaverNames,
      date_source:     dateSource,
      updated_at:      new Date().toISOString(),
    };
  });

  // ── Upsert ─────────────────────────────────────────────────────────────────
  if (rows.length > 0) {
    const { error } = await supabase
      .from("hr_employee_movement_weekly")
      .upsert(rows, { onConflict: "week_start" });
    if (error) {
      return NextResponse.json({ error: `upsert failed: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    status:       "ok",
    date_source:  dateSource,
    weeks_written: rows.length,
    from:         toYMD(fromDate),
    to:           toYMD(toDate),
    employees_total: employees.length,
    employees_with_hire_date: employees.filter((e) => e.hireDate).length,
  });
}

export async function GET(req: NextRequest) { return POST(req); }
