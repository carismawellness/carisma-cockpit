"use client";

/**
 * HR section of the Executive Summary.
 *
 * Reuses the EXACT hooks + commentary engine that `app/hr/page.tsx` uses, so the
 * numbers reported here always match the full HR dashboard for the same range.
 * Source of truth replicated 1:1: Talexio headcount/attendance/leave/payroll,
 * Supabase HR financials (Human-Capital %, payroll, RevPAH), We360 productivity,
 * employee movement, and `computeHRCommentary(...)`.
 */

import { useEffect, useMemo } from "react";
import { Users } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import {
  normalizeRag,
  type SectionProps,
  type DeptSummary,
  type DeptHeadlineKpi,
} from "@/lib/types/executive-summary";
import { formatCurrency } from "@/lib/charts/config";
import {
  useTalexioHeadcount,
  useTalexioTimeLogs,
  useTalexioLeave,
  useTalexioPayslips,
  useTalexioShiftsRange,
} from "@/lib/hooks/useTalexio";
import {
  useHRFinancials,
  useHRRevPAH,
  useWe360Productivity,
  useHREmployeeMovement,
} from "@/lib/hooks/useHRData";
import { useAttendance } from "@/lib/hooks/useAttendance";
import { computeHRCommentary, type HRCommentaryInput } from "@/lib/commentary/engine";
import { normaliseLocation, LOCATION_TO_BRAND } from "@/lib/constants/hr-mapping";
import {
  getActiveEmployees,
  buildAttendanceLogs,
  buildLateArrivals,
  buildPeriodAttendanceSummary,
} from "@/lib/hr/talexio-transforms";

const META = { slug: "hr", label: "HR", path: "/hr" } as const;

// Replicated fallbacks from app/hr/page.tsx (live → fallback).
const HEADCOUNT_FALLBACK = 75;
const GROUP_HC_PCT_FALLBACK = 33.1;
const TOTAL_REVENUE_FALLBACK = 285500;

// Staff-composition keyword sets (verbatim from app/hr/page.tsx).
const THERAPIST_KW = ["therapist", "beautician", "massage", "beauty", "esthetician", "aesthetician", "slimming specialist", "body contouring", "wellness therapist", "treatment"];
const PART_TIME_KW = ["part time", "part-time", "p/t", "pt therapist"];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function HrSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  const month = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}`;
  const fromISO = toISODate(dateFrom);
  const toISO = toISODate(dateTo);

  // ── Live data: Talexio ────────────────────────────────────────────────────
  const headcountQ = useTalexioHeadcount();
  const timeLogsQ = useTalexioTimeLogs();
  const leaveQ = useTalexioLeave();
  const payslipsQ = useTalexioPayslips();
  const shiftsQ = useTalexioShiftsRange(fromISO, toISO);

  // ── Longitudinal attendance (Supabase) ────────────────────────────────────
  const attendanceHistoryQ = useAttendance(fromISO, toISO, "all");

  // ── Supabase-backed HR financials + productivity + movement ───────────────
  const financialsQ = useHRFinancials(month);
  const revpahQ = useHRRevPAH(month);
  const we360Q = useWe360Productivity(fromISO, toISO);
  const movementQ = useHREmployeeMovement(26);

  // ── Derived (memoized, replicating the page) ──────────────────────────────
  const headcountActive = useMemo(() => {
    if (!headcountQ.data?.employees) return null;
    return getActiveEmployees(headcountQ.data.employees).length;
  }, [headcountQ.data]);

  const shiftStartByKey = useMemo(() => {
    const map = new Map<string, number>();
    if (!shiftsQ.data?.employees) return map;
    for (const emp of shiftsQ.data.employees) {
      for (const shift of emp.workShifts ?? []) {
        if (!shift?.from || !shift?.date) continue;
        const [h, m] = shift.from.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) map.set(`${emp.id}|${shift.date}`, h * 60 + m);
      }
    }
    return map;
  }, [shiftsQ.data]);

  const attendanceRows = useMemo(() => {
    if (!timeLogsQ.data?.employees) return null;
    return buildAttendanceLogs(timeLogsQ.data.employees, shiftStartByKey);
  }, [timeLogsQ.data, shiftStartByKey]);

  const lateRows = useMemo(() => {
    if (!attendanceRows) return null;
    return buildLateArrivals(attendanceRows);
  }, [attendanceRows]);

  const periodSummary = useMemo(() => {
    if (!timeLogsQ.data?.employees || shiftStartByKey.size === 0) return null;
    return buildPeriodAttendanceSummary(timeLogsQ.data.employees, shiftStartByKey);
  }, [timeLogsQ.data, shiftStartByKey]);

  // ── Source flags / resolved values (live → fallback) ──────────────────────
  const isFinancialsReal = financialsQ.isSuccess && !!financialsQ.data;
  const isProductivityReal =
    we360Q.isSuccess && !!we360Q.data && we360Q.data.employees.length > 0;

  const resolvedHeadcount = headcountActive ?? HEADCOUNT_FALLBACK;
  const groupHcPct = financialsQ.data?.groupHcPct ?? GROUP_HC_PCT_FALLBACK;
  const totalRevenue = financialsQ.data?.totalRevenue ?? TOTAL_REVENUE_FALLBACK;
  const payrollComplete = financialsQ.data?.payrollComplete ?? false;

  const avgRevPAH = useMemo(() => {
    if (revpahQ.data?.avgRevPAH !== undefined) return revpahQ.data.avgRevPAH;
    const rows = revpahQ.data?.byLocation ?? [];
    return rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.revpah, 0) / rows.length) * 100) / 100
      : 0;
  }, [revpahQ.data]);

  const productivityData = isProductivityReal ? we360Q.data!.employees : [];
  const avgProductivity = useMemo(
    () =>
      productivityData.length > 0
        ? Math.round(
            productivityData.reduce((s, p) => s + p.productivePct, 0) / productivityData.length,
          )
        : 0,
    [productivityData],
  );

  const displayHeadcount = isFinancialsReal ? financialsQ.data!.totalHeadcount : resolvedHeadcount;
  const revenuePerEmployee = displayHeadcount > 0 ? Math.round(totalRevenue / displayHeadcount) : 0;

  // ── Staff composition therapist ratio (verbatim logic) ────────────────────
  const therapistRatioPct = useMemo(() => {
    const employees = headcountQ.data?.employees ?? [];
    const active = employees.filter((e) => !e.isTerminated && !e.currentPositionSimple?.isEnded);
    if (active.length === 0) return null;
    let ft = 0;
    let pt = 0;
    for (const emp of active) {
      const pos = (emp.currentPositionSimple?.position?.name ?? "").toLowerCase();
      const orgUnit = emp.currentPositionSimple?.organisationUnit?.name ?? "";
      const loc = normaliseLocation(orgUnit);
      const brand = loc ? (LOCATION_TO_BRAND[loc] ?? "Spa") : "Spa";
      if (brand === "HQ") continue;
      const isTherapist = THERAPIST_KW.some((k) => pos.includes(k));
      if (!isTherapist) continue;
      const isPartTime = PART_TIME_KW.some((k) => pos.includes(k));
      if (isPartTime) pt++;
      else ft++;
    }
    return (((ft + pt) / active.length) * 100);
  }, [headcountQ.data]);

  // Roster-based on-time %, matching the page.
  const onTimePct = periodSummary?.onTimePct ?? (
    attendanceRows && attendanceRows.length > 0 && lateRows
      ? Math.round(((attendanceRows.length - lateRows.length) / attendanceRows.length) * 100)
      : 0
  );

  // ── Strategic commentary (same input shape as the page) ───────────────────
  const commentary = useMemo(() => {
    const totalLeavers = movementQ.data?.summary?.totalLeavers ?? 0;
    const currentTotal = movementQ.data?.summary?.currentTotal ?? resolvedHeadcount;
    const annualisedTurnoverRate =
      currentTotal > 0 ? (totalLeavers / currentTotal) * (52 / 26) * 100 : null;

    const input: HRCommentaryInput = {
      groupHcPct: groupHcPct > 0 ? groupHcPct : null,
      avgCostPerEmployee:
        isFinancialsReal && financialsQ.data!.totalHeadcount > 0
          ? financialsQ.data!.totalPayroll / financialsQ.data!.totalHeadcount
          : null,
      revenuePerEmployee: revenuePerEmployee > 0 ? revenuePerEmployee : null,
      revpahSpa: revpahQ.data?.byBrand?.Spa?.avgRevPAH ?? null,
      revpahAesthetics: revpahQ.data?.byBrand?.Aesthetics?.avgRevPAH ?? null,
      revpahSlimming: revpahQ.data?.byBrand?.Slimming?.avgRevPAH ?? null,
      netMovement: movementQ.data?.summary?.netMovement ?? null,
      annualisedTurnoverRate,
      therapistRatioPct,
      onTimePct: onTimePct > 0 ? onTimePct : null,
      avgActivityPct: avgProductivity > 0 ? avgProductivity : null,
    };
    return computeHRCommentary(input);
  }, [
    groupHcPct, financialsQ.data, isFinancialsReal, revenuePerEmployee, revpahQ.data,
    movementQ.data, therapistRatioPct, onTimePct, avgProductivity, resolvedHeadcount,
  ]);

  // ── Loading (combined external flags, matching the page) ──────────────────
  const loading =
    headcountQ.isLoading ||
    timeLogsQ.isLoading ||
    leaveQ.isLoading ||
    payslipsQ.isLoading ||
    financialsQ.isLoading ||
    revpahQ.isLoading;

  // ── KPIs (pre-formatted) ──────────────────────────────────────────────────
  const kpis = useMemo<DeptHeadlineKpi[]>(() => {
    const list: DeptHeadlineKpi[] = [
      { label: "Headcount", value: String(displayHeadcount) },
      { label: "Avg RevPAH", value: avgRevPAH > 0 ? formatCurrency(avgRevPAH) : "N/A" },
      { label: "On-Time %", value: `${onTimePct}%` },
    ];
    // Human Capital % — lower is better, so a rise vs target is bad (inverted).
    if (groupHcPct > 0) {
      list.push({ label: "Human Capital %", value: `${groupHcPct}%`, invertDelta: true });
    }
    // Monthly gross payroll.
    if (isFinancialsReal) {
      list.push({ label: "Gross Payroll", value: formatCurrency(financialsQ.data!.totalPayroll) });
    }
    return list;
  }, [displayHeadcount, avgRevPAH, onTimePct, groupHcPct, isFinancialsReal, financialsQ.data]);

  // ── Report up ─────────────────────────────────────────────────────────────
  // Mirror leave/payroll-completeness reads so the dependency surface matches
  // the dashboard's source signals (avoids stale summaries on slow loads).
  void leaveQ.data;
  void payrollComplete;
  void attendanceHistoryQ.data;

  useEffect(() => {
    if (loading || !commentary) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading HR summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
      return;
    }

    const summary: DeptSummary = {
      ...META,
      rag: normalizeRag(commentary.overallStatus),
      headline: commentary.verdict,
      kpis,
      focusAreas: commentary.focusAreas.map((f) => f.text),
      wins: commentary.wins.map((w) => w.text),
      loading: false,
    };
    onSummary(summary);
  }, [loading, commentary, kpis, onSummary]);

  const ready = !loading && !!commentary;

  return (
    <SectionCard
      {...META}
      icon={Users}
      rag={ready ? normalizeRag(commentary.overallStatus) : "NEUTRAL"}
      headline={ready ? commentary.verdict : ""}
      kpis={ready ? kpis : []}
      focusAreas={ready ? commentary.focusAreas.map((f) => f.text) : []}
      wins={ready ? commentary.wins.map((w) => w.text) : []}
      loading={!ready}
    />
  );
}
