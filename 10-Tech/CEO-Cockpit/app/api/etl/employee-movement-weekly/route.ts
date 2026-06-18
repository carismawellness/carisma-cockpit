/**
 * POST /api/etl/employee-movement-weekly?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Approximates employee hire/exit dates from payslip periodFrom data
 * (Talexio doesn't expose hireDate/terminationDate directly).
 *
 * Strategy:
 *   hireDate   ≈ min(payslip.periodFrom) across all payslips for that employee
 *   exitDate   ≈ max(payslip.periodTo)   for terminated employees
 *
 * Resolution is monthly (payslip granularity), displayed as weekly buckets.
 * date_source = "payslip"
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";

export const maxDuration = 60;

type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface PayslipEntry {
  periodFrom: string;
  periodTo:   string;
}

interface EmpWithPayslips {
  id:           string;
  fullName:     string;
  isTerminated: boolean;
  payslips:     PayslipEntry[];
}

// Normalised internal shape
interface EmpRow {
  id:              string;
  fullName:        string;
  isTerminated:    boolean;
  hireDate:        string | null;
  terminationDate: string | null;
}

const GQL_PAYSLIPS = `query {
  employees {
    id fullName isTerminated
    payslips {
      ... on PayrollPayslip {
        periodFrom
        periodTo
      }
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
  const diff = (day === 0 ? -6 : 1 - day);
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

  // ── Fetch employees with payslip history ───────────────────────────────────
  let rawEmployees: EmpWithPayslips[];
  try {
    const data = await fetchTalexio<{ employees: EmpWithPayslips[] }>(GQL_PAYSLIPS);
    rawEmployees = data.employees ?? [];
  } catch (e) {
    return NextResponse.json(
      { error: `Talexio query failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // ── Derive hire/exit dates from payslip data ───────────────────────────────
  const employees: EmpRow[] = rawEmployees.map((e) => {
    const periods = (e.payslips ?? []).filter(
      (p) => p.periodFrom && p.periodFrom !== "null",
    );

    let hireDate:        string | null = null;
    let terminationDate: string | null = null;

    if (periods.length > 0) {
      // Sort ascending
      const sorted = [...periods].sort((a, b) =>
        a.periodFrom.localeCompare(b.periodFrom),
      );
      hireDate = sorted[0].periodFrom;

      if (e.isTerminated) {
        // Use end of latest payslip period as approximate exit
        const latestPeriodTo = [...periods]
          .sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0]?.periodTo;
        terminationDate = latestPeriodTo ?? null;
      }
    }

    return {
      id:              e.id,
      fullName:        e.fullName,
      isTerminated:    e.isTerminated,
      hireDate,
      terminationDate,
    };
  });

  // ── Build ISO-week buckets ─────────────────────────────────────────────────
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

    // Total active at end of this week
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
      date_source:     "payslip",
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
    status:                    "ok",
    date_source:               "payslip",
    weeks_written:             rows.length,
    from:                      toYMD(fromDate),
    to:                        toYMD(toDate),
    employees_total:           employees.length,
    employees_with_hire_date:  employees.filter((e) => e.hireDate).length,
    employees_terminated:      employees.filter((e) => e.isTerminated).length,
  });
}

export async function GET(req: NextRequest) { return POST(req); }
