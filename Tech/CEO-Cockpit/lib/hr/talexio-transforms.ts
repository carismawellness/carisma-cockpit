/**
 * Talexio data → HR dashboard transforms
 *
 * Pure functions that turn the raw GraphQL shapes returned by `useTalexio*` hooks
 * into the shapes the HR page actually renders.
 *
 * Timezone: Malta (Europe/Malta) — used for "today" calculations on time logs.
 */

import type {
  TalexioEmployee,
  TalexioEmployeeWithTimeLogs,
  TalexioEmployeeWithLeave,
  TalexioEmployeeWithPayslips,
  TalexioTimeLog,
} from "@/lib/hooks/useTalexio";

// ── Constants ────────────────────────────────────────────────────────────────
const MALTA_TZ = "Europe/Malta";

// Shift start (hardcoded for now — proper shifts ETL coming later)
const SHIFT_START_HOUR = 8;
const SHIFT_START_MINUTE = 30;
const LATE_GRACE_MINUTES = 5;

// ── Date helpers (Malta TZ) ──────────────────────────────────────────────────

/** Returns "YYYY-MM-DD" for the given Date in Malta timezone. */
export function mtToday(d: Date = new Date()): string {
  // en-CA gives ISO-style YYYY-MM-DD; using en-GB and Intl APIs avoids locale traps.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MALTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${day}`;
}

/** Returns the Malta-local HH:MM for the given ISO timestamp. */
function mtHHMM(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MALTA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Returns the Malta-local YYYY-MM-DD for the given ISO timestamp. */
function mtDateOf(iso: string): string {
  return mtToday(new Date(iso));
}

// ── 1. Active employees ──────────────────────────────────────────────────────

export interface HeadcountSummary {
  totalActive: number;
  totalAll: number;
  terminated: number;
  byPosition: Array<{ name: string; count: number }>;
  byOrgUnit: Array<{ name: string; count: number }>;
}

export function getActiveEmployees(
  employees: TalexioEmployee[],
): TalexioEmployee[] {
  return employees.filter(
    (e) => !e.isTerminated && !e.currentPositionSimple?.isEnded,
  );
}

export function getHeadcountBreakdowns(
  employees: TalexioEmployee[],
): HeadcountSummary {
  const active = getActiveEmployees(employees);
  const terminated = employees.filter((e) => e.isTerminated).length;

  const positions = new Map<string, number>();
  const orgUnits = new Map<string, number>();
  for (const e of active) {
    const pos = e.currentPositionSimple?.position?.name ?? "Unassigned";
    const ou = e.currentPositionSimple?.organisationUnit?.name ?? "Unassigned";
    positions.set(pos, (positions.get(pos) ?? 0) + 1);
    orgUnits.set(ou, (orgUnits.get(ou) ?? 0) + 1);
  }

  const byPosition = [...positions.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const byOrgUnit = [...orgUnits.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalActive: active.length,
    totalAll: employees.length,
    terminated,
    byPosition,
    byOrgUnit,
  };
}

// ── 2. Attendance (time logs) ────────────────────────────────────────────────

export interface AttendanceRow {
  name: string;
  clockIn: string; // HH:MM
  clockOut: string | null; // HH:MM or null
  hoursWorked: string; // e.g. "8.1h"
  status: "Active" | "Completed";
  minutesLate: number; // minutes after shift start; 0 if on time / no shift
}

interface TodayLogs {
  employeeId: string;
  name: string;
  logs: TalexioTimeLog[];
}

/** Returns one entry per employee that has at least one time log for "today" in Malta TZ. */
export function getTodayTimeLogs(
  employees: TalexioEmployeeWithTimeLogs[],
  todayStr: string = mtToday(),
): TodayLogs[] {
  const out: TodayLogs[] = [];
  for (const e of employees) {
    const todays = (e.timeLogs ?? []).filter(
      (l) => l && l.from && mtDateOf(l.from) === todayStr,
    );
    if (todays.length === 0) continue;
    out.push({ employeeId: e.id, name: e.fullName, logs: todays });
  }
  return out;
}

function shiftStartMinutes(): number {
  return SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE;
}

function clockInMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function buildAttendanceLogs(
  employees: TalexioEmployeeWithTimeLogs[],
  now: Date = new Date(),
): AttendanceRow[] {
  const todayStr = mtToday(now);
  const todayLogs = getTodayTimeLogs(employees, todayStr);

  return todayLogs
    .map(({ name, logs }) => {
      // Sort by `from` ascending — earliest first.
      const sorted = [...logs].sort(
        (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime(),
      );
      const earliest = sorted[0];
      const latest = sorted[sorted.length - 1];

      const clockIn = mtHHMM(earliest.from);
      const hasOpen = sorted.some((l) => l.to == null);
      const clockOut = hasOpen ? null : mtHHMM(latest.to as string);

      // Total worked = sum of (to - from), with open logs counted up to `now`.
      let totalMs = 0;
      for (const l of sorted) {
        const fromMs = new Date(l.from).getTime();
        const toMs = l.to ? new Date(l.to).getTime() : now.getTime();
        totalMs += Math.max(0, toMs - fromMs);
      }
      const hours = totalMs / 3_600_000;

      const inMin = clockInMinutes(clockIn);
      const lateBy = Math.max(0, inMin - shiftStartMinutes());

      return {
        name,
        clockIn,
        clockOut,
        hoursWorked: `${hours.toFixed(1)}h`,
        status: hasOpen ? "Active" : "Completed",
        minutesLate: lateBy,
      } satisfies AttendanceRow;
    })
    .sort((a, b) => clockInMinutes(a.clockIn) - clockInMinutes(b.clockIn));
}

/** Late = clock-in later than shift start + grace. */
export function buildLateArrivals(
  rows: AttendanceRow[],
): Array<{ name: string; clockIn: string; minutesLate: number }> {
  return rows
    .filter((r) => r.minutesLate > LATE_GRACE_MINUTES)
    .map((r) => ({
      name: r.name,
      clockIn: r.clockIn,
      minutesLate: r.minutesLate,
    }))
    .sort((a, b) => b.minutesLate - a.minutesLate);
}

/** Active employees with NO time log today. */
export function buildNotClockedIn(
  activeEmployees: TalexioEmployee[],
  timeLogEmployees: TalexioEmployeeWithTimeLogs[],
  todayStr: string = mtToday(),
): string[] {
  const clockedInIds = new Set(
    getTodayTimeLogs(timeLogEmployees, todayStr).map((t) => t.employeeId),
  );
  return activeEmployees
    .filter((e) => !clockedInIds.has(e.id))
    .map((e) => e.fullName)
    .sort((a, b) => a.localeCompare(b));
}

// ── 3. Leave balances ────────────────────────────────────────────────────────

export interface LeaveBalanceRow {
  name: string;
  vacationHrs: number;
  sickHrs: number;
  totalTypes: number;
  totalHrs: number;
}

const VACATION_RE = /annual|vacation|holiday/i;
const SICK_RE = /sick/i;

export function buildLeaveBalances(
  employees: TalexioEmployeeWithLeave[],
  year: number = new Date().getFullYear(),
): LeaveBalanceRow[] {
  const rows: LeaveBalanceRow[] = [];
  for (const e of employees) {
    if (e.isTerminated) continue;
    const ent = (e.leaveEntitlements ?? []).filter((x) => x.year === year);
    if (ent.length === 0) continue;

    let vacationHrs = 0;
    let sickHrs = 0;
    let totalHrs = 0;
    const typeIds = new Set<string>();
    for (const x of ent) {
      const amt = Number(x.entitlement ?? 0);
      const nm = x.leaveType?.name ?? "";
      totalHrs += amt;
      typeIds.add(x.leaveType?.id ?? nm);
      if (VACATION_RE.test(nm)) vacationHrs += amt;
      if (SICK_RE.test(nm)) sickHrs += amt;
    }

    rows.push({
      name: e.fullName,
      vacationHrs: Math.round(vacationHrs),
      sickHrs: Math.round(sickHrs),
      totalTypes: typeIds.size,
      totalHrs: Math.round(totalHrs),
    });
  }
  return rows.sort((a, b) => b.totalHrs - a.totalHrs);
}

export function buildSickLeaveTop(
  balances: LeaveBalanceRow[],
  limit: number = 10,
): Array<{ name: string; entitlement: number }> {
  return [...balances]
    .filter((b) => b.sickHrs > 0)
    .sort((a, b) => b.sickHrs - a.sickHrs)
    .slice(0, limit)
    .map((b) => ({ name: b.name, entitlement: b.sickHrs }));
}

// ── 4. Payroll ───────────────────────────────────────────────────────────────

export interface PayrollLocationRow {
  name: string;
  gross: number;
  headcount: number;
  avgCost: number;
}

export interface PayrollSummary {
  latestMonth: string; // YYYY-MM
  latestGross: number;
  latestNet: number;
  latestTax: number;
  avgCostPerEmployee: number;
  locationData: PayrollLocationRow[];
}

export function buildPayrollSummary(
  employees: TalexioEmployeeWithPayslips[],
): PayrollSummary | null {
  // 1. Find the latest periodTo across all payslips.
  let latestPeriodTo = "";
  for (const e of employees) {
    for (const p of e.payslips ?? []) {
      if (p?.periodTo && p.periodTo > latestPeriodTo) {
        latestPeriodTo = p.periodTo;
      }
    }
  }
  if (!latestPeriodTo) return null;

  const latestMonth = latestPeriodTo.slice(0, 7);

  // 2. Sum gross/net/tax for that period; group by org unit.
  let latestGross = 0;
  let latestNet = 0;
  let latestTax = 0;
  const byOrg = new Map<string, { gross: number; headcount: number }>();
  let employeesWithPay = 0;

  for (const e of employees) {
    const matching = (e.payslips ?? []).filter(
      (p) => p?.periodTo === latestPeriodTo,
    );
    if (matching.length === 0) continue;
    employeesWithPay++;

    let empGross = 0;
    for (const p of matching) {
      empGross += Number(p.gross ?? 0);
      latestNet += Number(p.net ?? 0);
      latestTax += Number(p.tax ?? 0);
    }
    latestGross += empGross;

    const org = e.currentPositionSimple?.organisationUnit?.name ?? "Unassigned";
    const cur = byOrg.get(org) ?? { gross: 0, headcount: 0 };
    cur.gross += empGross;
    cur.headcount += 1;
    byOrg.set(org, cur);
  }

  const avgCostPerEmployee =
    employeesWithPay > 0 ? Math.round(latestGross / employeesWithPay) : 0;

  const locationData: PayrollLocationRow[] = [...byOrg.entries()]
    .map(([name, v]) => ({
      name,
      gross: Math.round(v.gross),
      headcount: v.headcount,
      avgCost: v.headcount > 0 ? Math.round(v.gross / v.headcount) : 0,
    }))
    .sort((a, b) => b.gross - a.gross);

  return {
    latestMonth,
    latestGross: Math.round(latestGross),
    latestNet: Math.round(latestNet),
    latestTax: Math.round(latestTax),
    avgCostPerEmployee,
    locationData,
  };
}
