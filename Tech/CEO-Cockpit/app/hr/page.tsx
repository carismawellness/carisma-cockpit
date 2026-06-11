"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";

const TARGET_AMBER = "#D97706"; // target reference-line marker (not a brand color)

import { SPA_LOCATION_COLOR_BY_NAME, SPA_LOCATION_FALLBACK_COLOR } from "@/lib/constants/spa-locations";
import {
  useTalexioHeadcount,
  useTalexioTimeLogs,
  useTalexioLeave,
  useTalexioPayslips,
} from "@/lib/hooks/useTalexio";
import { useHRFinancials, useHRRevPAH, useWe360Productivity } from "@/lib/hooks/useHRData";
import {
  getActiveEmployees,
  buildAttendanceLogs,
  buildLateArrivals,
  buildLeaveBalances,
  buildPayrollSummary,
} from "@/lib/hr/talexio-transforms";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const REVPAH_TARGET = 35;
const HC_PCT_TARGET = 35;

const PROD_COLORS = {
  productive: "#A8D4A8",
  neutral: "#C7C4BD",
  unproductive: "#E8A8A0",
  idle: "#E5C088",
};

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Color a location bar by its business unit (warm Spa-family tone per hotel,
// or the Aesthetics sage / Slimming brand color for those clinics).
function locationColor(name: string): string {
  if (/aesthetic/i.test(name)) return BRAND.aesthetics.soft;
  if (/slimming/i.test(name))  return BRAND.slimming.soft;
  return SPA_LOCATION_COLOR_BY_NAME[name] ?? SPA_LOCATION_FALLBACK_COLOR;
}

function getStatusBadge(status: string, className: string) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {status}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HR KPI CARD — premium variant for the HR metric grid
// ════════════════════════════════════════════════════════════════════════════

interface HRMetricData {
  label: string;
  value: string;
  target?: string;
  targetValue?: number;
  currentValue?: number;
  /** True when the metric improves by going lower (e.g. HC% vs revenue). */
  lowerIsBetter?: boolean;
  isSample?: boolean;
}

function HRMetricCard({ label, value, target, targetValue, currentValue, lowerIsBetter = false, isSample = false }: HRMetricData) {
  const hasTarget = targetValue != null && currentValue != null && targetValue > 0;

  type Status = "good" | "warn" | "bad" | "neutral";
  let status: Status = "neutral";
  if (hasTarget) {
    const ratio = currentValue! / targetValue!;
    status = lowerIsBetter
      ? ratio <= 1 ? "good" : ratio <= 1.25 ? "warn" : "bad"
      : ratio >= 0.9 ? "good" : ratio >= 0.7 ? "warn" : "bad";
  }

  const styles: Record<Status, { border: string; valueCls: string; bg: string; pill: string; pillText: string }> = {
    good:    { border: "border-l-emerald-400", valueCls: "text-emerald-700",   bg: "bg-emerald-50/50",  pill: "bg-emerald-50 border-emerald-200 text-emerald-700",  pillText: "On Track" },
    warn:    { border: "border-l-amber-400",   valueCls: "text-amber-700",     bg: "bg-amber-50/50",    pill: "bg-amber-50 border-amber-200 text-amber-700",        pillText: "Near target" },
    bad:     { border: "border-l-red-400",     valueCls: "text-red-700",       bg: "bg-red-50/40",      pill: "bg-red-50 border-red-200 text-red-700",              pillText: "Off track" },
    neutral: { border: "border-l-slate-200",   valueCls: "text-slate-900",     bg: "bg-white",          pill: "",                                                   pillText: "" },
  };
  const s = styles[status];

  return (
    <div className={`rounded-xl border border-slate-100 border-l-4 ${s.border} ${s.bg} p-4 shadow-sm flex flex-col gap-1.5`}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider leading-tight">{label}</p>
        {isSample ? (
          <span className="shrink-0 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 leading-none">Sample</span>
        ) : status !== "neutral" ? (
          <span className={`shrink-0 text-[10px] font-semibold border rounded-full px-1.5 py-0.5 leading-none ${s.pill}`}>{s.pillText}</span>
        ) : null}
      </div>
      <p className={`text-2xl md:text-3xl font-bold leading-none ${s.valueCls}`}>{value}</p>
      {target && (
        <p className="text-xs text-slate-400 font-medium leading-none">Target: {target}</p>
      )}
    </div>
  );
}

function prettyMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

// ════════════════════════════════════════════════════════════════════════════
// BADGES
// ════════════════════════════════════════════════════════════════════════════

function SampleDataBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 ml-2">
      <span className="w-1 h-1 rounded-full bg-amber-400" />
      Sample data
    </span>
  );
}

function LiveBadge({ source }: { source: "talexio" | "supabase" }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 ml-2">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
      Live from {source === "talexio" ? "Talexio" : "Supabase"}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK DATA
// ════════════════════════════════════════════════════════════════════════════

const HEADCOUNT_FALLBACK = { totalActive: 75 };

const ATTENDANCE_FALLBACK = [
  { name: "Maria Borg", clockIn: "06:45", clockOut: "14:50", hoursWorked: "8.1h", status: "Completed" },
  { name: "Sarah Caballeri", clockIn: "06:52", clockOut: null, hoursWorked: "6.3h", status: "Active" },
  { name: "Elena Petrova", clockIn: "07:00", clockOut: "15:05", hoursWorked: "8.1h", status: "Completed" },
  { name: "Josef Micallef", clockIn: "07:05", clockOut: null, hoursWorked: "6.1h", status: "Active" },
  { name: "Abid Khan", clockIn: "07:10", clockOut: "15:15", hoursWorked: "8.1h", status: "Completed" },
  { name: "Lisa Farrugia", clockIn: "07:15", clockOut: null, hoursWorked: "5.9h", status: "Active" },
  { name: "Katya Dimech", clockIn: "07:20", clockOut: "15:25", hoursWorked: "8.1h", status: "Completed" },
  { name: "Rana Hussain", clockIn: "07:30", clockOut: null, hoursWorked: "5.7h", status: "Active" },
  { name: "Mark Spiteri", clockIn: "07:35", clockOut: "15:40", hoursWorked: "8.1h", status: "Completed" },
  { name: "Julie Rizzo", clockIn: "07:45", clockOut: null, hoursWorked: "5.4h", status: "Active" },
  { name: "Nicci Debono", clockIn: "08:00", clockOut: "16:05", hoursWorked: "8.1h", status: "Completed" },
  { name: "Tom Bonello", clockIn: "08:05", clockOut: null, hoursWorked: "5.1h", status: "Active" },
];

const LATE_FALLBACK = [
  { name: "Jake Tanti", clockIn: "09:45", minutesLate: 30 },
  { name: "Nina Cutajar", clockIn: "09:30", minutesLate: 15 },
  { name: "Robert Pace", clockIn: "09:20", minutesLate: 5 },
];

const LEAVE_BALANCES_FALLBACK = [
  { name: "Rana Hussain",    vacationHrs: 120, sickHrs: 96, totalHrs: 216 },
  { name: "Tom Bonello",     vacationHrs: 160, sickHrs: 88, totalHrs: 248 },
  { name: "Adeel Malik",     vacationHrs: 140, sickHrs: 72, totalHrs: 212 },
  { name: "Jake Tanti",      vacationHrs: 130, sickHrs: 64, totalHrs: 194 },
  { name: "Maria Borg",      vacationHrs: 160, sickHrs: 48, totalHrs: 208 },
  { name: "Mark Spiteri",    vacationHrs: 145, sickHrs: 40, totalHrs: 185 },
  { name: "Lisa Farrugia",   vacationHrs: 160, sickHrs: 32, totalHrs: 192 },
  { name: "Elena Petrova",   vacationHrs: 155, sickHrs: 24, totalHrs: 179 },
  { name: "Sarah Caballeri", vacationHrs: 160, sickHrs: 16, totalHrs: 176 },
  { name: "Katya Dimech",    vacationHrs: 148, sickHrs: 16, totalHrs: 164 },
];

const PAYROLL_FALLBACK = {
  latestMonth: "2026-03",
  latestGross: 134800,
  latestNet: 101100,
  latestTax: 21568,
  avgCostPerEmployee: 1797,
  locationData: [] as { name: string; gross: number; headcount: number; avgCost: number }[],
};

const REVPAH_FALLBACK = [
  { location: "Hugos", revpah: 48.20, revenue: 52400 },
  { location: "Hyatt", revpah: 43.80, revenue: 41200 },
  { location: "InterContinental", revpah: 39.50, revenue: 58700 },
  { location: "Odycy", revpah: 37.10, revenue: 29800 },
  { location: "Excelsior", revpah: 35.60, revenue: 22400 },
  { location: "Ramla Bay", revpah: 32.40, revenue: 31600 },
  { location: "Riviera", revpah: 29.80, revenue: 27500 },
  { location: "Novotel", revpah: 26.50, revenue: 21900 },
];

const TOTAL_REVENUE_FALLBACK = 285500;

const HC_BY_LOCATION_FALLBACK = [
  { name: "Novotel",          hcPct: 28.5, payroll: 11900, revenue: 41760,  headcount: 7  },
  { name: "Excelsior",        hcPct: 30.2, payroll: 9350,  revenue: 30960,  headcount: 6  },
  { name: "Riviera",         hcPct: 31.4, payroll: 14400, revenue: 45860,  headcount: 8  },
  { name: "InterContinental", hcPct: 32.1, payroll: 28500, revenue: 88786,  headcount: 15 },
  { name: "Odycy",            hcPct: 33.8, payroll: 13600, revenue: 40236,  headcount: 8  },
  { name: "Ramla Bay",        hcPct: 34.9, payroll: 15750, revenue: 45129,  headcount: 9  },
  { name: "Hugos",            hcPct: 36.5, payroll: 22800, revenue: 62466,  headcount: 12 },
  { name: "Hyatt",            hcPct: 38.2, payroll: 18500, revenue: 48429,  headcount: 10 },
];

const HC_BY_BU_FALLBACK = [
  { name: "Spa",        hcPct: 33.4, payroll: 97056, revenue: 290588 },
  { name: "Aesthetics", hcPct: 30.8, payroll: 24264, revenue: 78779  },
  { name: "Slimming",   hcPct: 36.2, payroll: 13480, revenue: 37238  },
];

const GROUP_HC_PCT_FALLBACK = 33.1;

const PRODUCTIVITY_DATA = [
  { name: "Sarah M.", productive: 5.8, neutral: 0.6, unproductive: 0.2, idle: 0.8 },
  { name: "Abid K.",  productive: 5.5, neutral: 0.7, unproductive: 0.3, idle: 0.9 },
  { name: "Elena P.", productive: 5.4, neutral: 0.8, unproductive: 0.3, idle: 0.9 },
  { name: "Juli R.",  productive: 5.2, neutral: 0.8, unproductive: 0.4, idle: 1.0 },
  { name: "Rana H.",  productive: 5.1, neutral: 0.9, unproductive: 0.4, idle: 1.0 },
  { name: "Maria C.", productive: 4.9, neutral: 0.9, unproductive: 0.5, idle: 1.1 },
  { name: "Lisa F.",  productive: 4.8, neutral: 1.0, unproductive: 0.5, idle: 1.1 },
  { name: "Nicci D.", productive: 4.6, neutral: 0.9, unproductive: 0.5, idle: 1.2 },
  { name: "Jake T.",  productive: 4.5, neutral: 1.0, unproductive: 0.6, idle: 1.3 },
  { name: "Mark S.",  productive: 4.3, neutral: 1.0, unproductive: 0.6, idle: 1.4 },
  { name: "Adeel M.", productive: 3.8, neutral: 0.8, unproductive: 0.7, idle: 1.5 },
  { name: "Tom B.",   productive: 3.5, neutral: 0.7, unproductive: 0.8, idle: 1.6 },
].map((s) => {
  const segTotal = Math.round((s.productive + s.neutral + s.unproductive + s.idle) * 10) / 10;
  const pct = segTotal > 0 ? Math.round((s.productive / segTotal) * 100) : 0;
  const totalHrs = segTotal.toFixed(1);
  return {
    name:          s.name,
    Productive:    s.productive,
    Neutral:       s.neutral,
    Unproductive:  s.unproductive,
    Idle:          s.idle,
    productivePct: pct,
    totalHrs,
    barLabel:      `${pct}% — ${totalHrs}h`,
    days:          5,
  };
});

// ════════════════════════════════════════════════════════════════════════════
// TABLE COLUMNS
// ════════════════════════════════════════════════════════════════════════════

const attendanceColumns = [
  { key: "name", label: "Employee" },
  { key: "clockIn", label: "Clock In", align: "right" as const },
  {
    key: "clockOut",
    label: "Clock Out",
    align: "right" as const,
    render: (v: unknown) => (v ? String(v) : getStatusBadge("Active", "bg-green-100 text-green-800")),
  },
  { key: "hoursWorked", label: "Hours", align: "right" as const },
  {
    key: "status",
    label: "Status",
    align: "right" as const,
    render: (v: unknown) => {
      const s = v as string;
      return s === "Active"
        ? getStatusBadge("Active", "bg-green-100 text-green-800")
        : getStatusBadge("Done", "bg-gray-100 text-gray-600");
    },
  },
];

const latenessColumns = [
  { key: "name", label: "Employee" },
  { key: "clockIn", label: "Clock In", align: "right" as const },
  {
    key: "minutesLate",
    label: "Minutes Late",
    align: "right" as const,
    sortable: true,
    render: (v: unknown) => {
      const mins = Number(v);
      if (mins > 30) return getStatusBadge(`${mins}m`, "bg-red-100 text-red-800");
      if (mins > 15) return getStatusBadge(`${mins}m`, "bg-amber-100 text-amber-800");
      return getStatusBadge(`${mins}m`, "bg-yellow-100 text-yellow-800");
    },
  },
];

// Annual entitlement table — Talexio provides statutory entitlement, not remaining balance
const leaveColumns = [
  { key: "name", label: "Employee", sortable: true },
  { key: "vacationHrs", label: "Annual Vacation (hrs)", align: "right" as const, sortable: true },
  { key: "sickHrs", label: "Annual Sick (hrs)", align: "right" as const, sortable: true },
  { key: "totalHrs", label: "Total Entitlement (hrs)", align: "right" as const, sortable: true },
];

// ════════════════════════════════════════════════════════════════════════════
// MAIN CONTENT
// ════════════════════════════════════════════════════════════════════════════

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function HRContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const month = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}`;
  const fromISO = toISODate(dateFrom);
  const toISO = toISODate(dateTo);
  const queryClient = useQueryClient();

  // ── Live data: Talexio ────────────────────────────────────────────────────
  const headcountQ = useTalexioHeadcount();
  const timeLogsQ = useTalexioTimeLogs();
  const leaveQ = useTalexioLeave();
  const payslipsQ = useTalexioPayslips();

  // ── Live data: Supabase-backed HR financials ──────────────────────────────
  const financialsQ = useHRFinancials(month);
  const revpahQ = useHRRevPAH(month);
  const we360Q = useWe360Productivity(fromISO, toISO);

  // ── Talexio-derived views (memoized) ──────────────────────────────────────
  const activeEmployees = useMemo(
    () => (headcountQ.data?.employees ? getActiveEmployees(headcountQ.data.employees) : null),
    [headcountQ.data],
  );

  const headcountActive = useMemo(() => {
    if (!headcountQ.data?.employees) return null;
    return getActiveEmployees(headcountQ.data.employees).length;
  }, [headcountQ.data]);

  const attendanceRows = useMemo(() => {
    if (!timeLogsQ.data?.employees) return null;
    return buildAttendanceLogs(timeLogsQ.data.employees);
  }, [timeLogsQ.data]);

  const lateRows = useMemo(() => {
    if (!attendanceRows) return null;
    return buildLateArrivals(attendanceRows);
  }, [attendanceRows]);

  const leaveBalances = useMemo(() => {
    if (!leaveQ.data?.employees) return null;
    return buildLeaveBalances(leaveQ.data.employees);
  }, [leaveQ.data]);

  const payroll = useMemo(() => {
    if (!payslipsQ.data?.employees) return null;
    return buildPayrollSummary(payslipsQ.data.employees);
  }, [payslipsQ.data]);

  // ── Source flags ──────────────────────────────────────────────────────────
  const isAttendanceReal  = attendanceRows !== null;
  const isLateReal        = lateRows !== null;
  const isLeaveReal       = leaveBalances !== null;
  const isPayrollReal     = payroll !== null;
  const isFinancialsReal  = financialsQ.isSuccess && !!financialsQ.data;
  const isRevPAHReal      = revpahQ.isSuccess && !!revpahQ.data;

  const talexioLoading =
    headcountQ.isLoading ||
    timeLogsQ.isLoading ||
    leaveQ.isLoading ||
    payslipsQ.isLoading;

  const talexioError =
    headcountQ.isError ||
    timeLogsQ.isError ||
    leaveQ.isError ||
    payslipsQ.isError;

  // ── Resolved data (live → fallback) ──────────────────────────────────────
  const resolvedHeadcount = headcountActive ?? HEADCOUNT_FALLBACK.totalActive;

  const attendance = attendanceRows ?? ATTENDANCE_FALLBACK;
  const late        = lateRows ?? LATE_FALLBACK;
  const leaves      = leaveBalances ?? LEAVE_BALANCES_FALLBACK;
  const payrollData = payroll ?? PAYROLL_FALLBACK;

  const hcByLocation    = financialsQ.data?.byLocation ?? HC_BY_LOCATION_FALLBACK;
  const hcByBU          = financialsQ.data?.byBusinessUnit ?? HC_BY_BU_FALLBACK;
  const groupHcPct      = financialsQ.data?.groupHcPct ?? GROUP_HC_PCT_FALLBACK;
  const totalRevenue    = financialsQ.data?.totalRevenue ?? TOTAL_REVENUE_FALLBACK;
  const payrollComplete = financialsQ.data?.payrollComplete ?? false;

  const revpahData = revpahQ.data?.byLocation ?? REVPAH_FALLBACK;
  const avgRevPAH  = useMemo(() => {
    if (revpahQ.data?.avgRevPAH !== undefined) return revpahQ.data.avgRevPAH;
    return revpahData.length > 0
      ? Math.round((revpahData.reduce((s, r) => s + r.revpah, 0) / revpahData.length) * 100) / 100
      : 0;
  }, [revpahQ.data, revpahData]);

  // ── We360 productivity (live → fallback) ──────────────────────────────────
  const isProductivityReal =
    we360Q.isSuccess && !!we360Q.data && we360Q.data.employees.length > 0;
  // Distinguish "not connected" from "connected but no data for this period"
  const we360NotConnected = we360Q.isError;
  const we360NoDataForPeriod =
    we360Q.isSuccess && (!we360Q.data || we360Q.data.employees.length === 0);
  const productivityData = isProductivityReal
    ? we360Q.data!.employees
    : PRODUCTIVITY_DATA;

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  const avgProductivity = useMemo(
    () =>
      productivityData.length > 0
        ? Math.round(
            productivityData.reduce((s, p) => s + p.productivePct, 0) / productivityData.length,
          )
        : 0,
    [productivityData],
  );

  const revenuePerEmployee = resolvedHeadcount > 0 ? Math.round(totalRevenue / resolvedHeadcount) : 0;

  const onTimePct =
    attendance.length > 0
      ? Math.round(((attendance.length - late.length) / attendance.length) * 100)
      : 0;

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpis: HRMetricData[] = [
    {
      label: "Human Capital %",
      value: payrollComplete ? `${groupHcPct}%` : "N/A",
      target: `${HC_PCT_TARGET}%`,
      targetValue: HC_PCT_TARGET,
      currentValue: payrollComplete ? groupHcPct : undefined,
      lowerIsBetter: true,
      isSample: !payrollComplete,
    },
    { label: "Monthly Gross Payroll", value: formatCurrency(payrollData.latestGross) },
    { label: "Avg Cost / Employee",   value: formatCurrency(payrollData.avgCostPerEmployee) },
    { label: "Active Employees",      value: String(resolvedHeadcount) },
    {
      label: "On-Time %",
      value: `${onTimePct}%`,
      target: "90%",
      targetValue: 90,
      currentValue: onTimePct,
    },
    {
      label: "Avg Activity",
      value: `${avgProductivity}%`,
      target: "90%",
      targetValue: 90,
      currentValue: avgProductivity,
      isSample: !isProductivityReal,
    },
    {
      label: "Avg RevPAH",
      value: avgRevPAH > 0 ? formatCurrency(avgRevPAH) : "N/A",
      target: `${formatCurrency(REVPAH_TARGET)}/hr`,
      targetValue: REVPAH_TARGET,
      currentValue: avgRevPAH,
    },
    { label: "Revenue / Employee", value: formatCurrency(revenuePerEmployee) },
  ];

  // ── Header badge ──────────────────────────────────────────────────────────
  const headerBadge = (() => {
    if (talexioLoading) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-full px-3 py-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
          Connecting to Talexio…
        </span>
      );
    }
    if (talexioError) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-full px-3 py-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Talexio unavailable
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-full px-3 py-1 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live from Talexio
      </span>
    );
  })();

  const subtitle = useMemo(() => {
    return `${prettyMonth(month)} — ${resolvedHeadcount} active employees`;
  }, [month, resolvedHeadcount]);

  // ── Unused-import guard ───────────────────────────────────────────────────
  void activeEmployees;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Human Resources</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {headerBadge}
          <SyncButton
            onSync={async () => {
              // Refresh both HR sources: Talexio (headcount/attendance/payroll)
              // and We360 (productivity/attendance) over the visible range.
              await Promise.all([
                fetch("/api/etl/talexio-hr", { method: "POST" }),
                fetch("/api/etl/we360", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ start_date: fromISO, end_date: toISO }),
                }),
              ]);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["talexio"] }),
                queryClient.invalidateQueries({ queryKey: ["we360-productivity"] }),
              ]);
            }}
            isExternalBusy={talexioLoading || we360Q.isFetching}
          />
        </div>
      </div>

      {talexioError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>Talexio connection unavailable. Showing cached or sample data.</span>
        </div>
      )}

      {/* ── KPI Grid ───────────────────────────────────────────────────── */}
      {talexioLoading && headcountActive === null ? (
        <KPIGridSkeleton count={8} className="grid-cols-2 md:grid-cols-4" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {kpis.map((kpi) => (
            <HRMetricCard key={kpi.label} {...kpi} />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1: Human Capital %
          ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
            Human Capital % by Location
            {isFinancialsReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Payroll as % of revenue — lower is more efficient
          </p>
          <ResponsiveContainer width="100%" height={hcByLocation.length * 48 + 50}>
            <BarChart
              data={hcByLocation}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v, name) => [`${v}%`, String(name)]}
                labelFormatter={(label) => {
                  const item = hcByLocation.find((d) => d.name === label);
                  return item
                    ? `${label} — Payroll: ${formatCurrency(item.payroll)} | Revenue: ${formatCurrency(item.revenue)}`
                    : String(label);
                }}
              />
              <ReferenceLine
                x={HC_PCT_TARGET}
                stroke={TARGET_AMBER}
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Target ${HC_PCT_TARGET}%`, position: "top", fill: TARGET_AMBER, fontSize: 11 }}
              />
              <Bar dataKey="hcPct" name="HC %" barSize={28}>
                {hcByLocation.map((entry) => (
                  <Cell key={entry.name} fill={locationColor(entry.name)} />
                ))}
                <LabelList
                  dataKey="hcPct"
                  content={(props) => {
                    const { x, width, y, height, value } = props as Record<string, unknown>;
                    return (
                      <text
                        x={Number(x) + Number(width) + 6}
                        y={Number(y) + Number(height) / 2}
                        textAnchor="start"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="currentColor"
                      >
                        {String(value)}%
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
            Human Capital % by Business Unit
            {isFinancialsReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Group HC%: {groupHcPct.toFixed(1)}% — Total payroll / Total revenue
          </p>
          <ResponsiveContainer width="100%" height={hcByBU.length * 60 + 50}>
            <BarChart
              data={hcByBU}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v, name) => [`${v}%`, String(name)]}
                labelFormatter={(label) => {
                  const item = hcByBU.find((d) => d.name === label);
                  return item
                    ? `${label} — Payroll: ${formatCurrency(item.payroll)} | Revenue: ${formatCurrency(item.revenue)}`
                    : String(label);
                }}
              />
              <ReferenceLine
                x={HC_PCT_TARGET}
                stroke={TARGET_AMBER}
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Target ${HC_PCT_TARGET}%`, position: "top", fill: TARGET_AMBER, fontSize: 11 }}
              />
              <Bar dataKey="hcPct" name="HC %">
                {hcByBU.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={[BRAND.spa.soft, BRAND.aesthetics.soft, BRAND.slimming.soft][i % 3]}
                  />
                ))}
                <LabelList
                  dataKey="hcPct"
                  content={(props) => {
                    const { x, width, y, height, index } = props as Record<string, unknown>;
                    const entry = hcByBU[Number(index)];
                    if (!entry) return <></>;
                    return (
                      <text
                        x={Number(x) + Number(width) + 6}
                        y={Number(y) + Number(height) / 2}
                        textAnchor="start"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="currentColor"
                      >
                        {entry.hcPct}% — {formatCurrency(entry.payroll)}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2: RevPAH by Location
          ══════════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
          Revenue per Available Hour by Location
          {isRevPAHReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Utilization proxy — target {formatCurrency(REVPAH_TARGET)}/hr
        </p>
        <div className="h-[220px] md:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revpahData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="location" angle={-35} textAnchor="end" height={60} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `€${v}`} tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as { revpah: number; revenue: number; headcount?: number; availableHours?: number };
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-xs space-y-1">
                      <p className="font-semibold text-slate-800">{label}</p>
                      <p><span className="text-slate-500">RevPAH:</span> <span className="font-bold text-slate-900">{formatCurrency(row.revpah)}/hr</span></p>
                      <p><span className="text-slate-500">Revenue:</span> <span className="font-semibold">{formatCurrency(row.revenue)}</span></p>
                      {row.headcount != null && <p><span className="text-slate-500">Headcount:</span> <span className="font-semibold">{row.headcount} staff</span></p>}
                      {row.availableHours != null && <p><span className="text-slate-500">Avail hrs:</span> <span className="font-semibold">{row.availableHours.toLocaleString()}h</span></p>}
                    </div>
                  );
                }}
              />
              <ReferenceLine
                y={REVPAH_TARGET}
                stroke={TARGET_AMBER}
                strokeDasharray="6 3"
                strokeWidth={1.5}
                label={{ value: `Target ${formatCurrency(REVPAH_TARGET)}/hr`, position: "right", fill: TARGET_AMBER, fontSize: 12 }}
              />
              <Bar dataKey="revpah" name="RevPAH">
                {revpahData.map((entry) => (
                  <Cell key={entry.location} fill={locationColor(entry.location)} />
                ))}
                <LabelList
                  dataKey="revpah"
                  position="top"
                  content={(props) => {
                    const { x, width, y, value } = props as Record<string, unknown>;
                    return (
                      <text
                        x={Number(x) + Number(width) / 2}
                        y={Number(y) - 6}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="currentColor"
                      >
                        €{Number(value).toFixed(1)}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3: Attendance Today + Late Arrivals
          ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Attendance Today
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({attendance.length} of {resolvedHeadcount} clocked in)
            </span>
            {isAttendanceReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {timeLogsQ.isLoading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : (
            <DataTable
              columns={attendanceColumns}
              data={attendance as unknown as Record<string, unknown>[]}
              pageSize={8}
            />
          )}
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Late Arrivals
            <span className="ml-2 text-sm font-normal text-red-500">({late.length} late)</span>
            {isLateReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {timeLogsQ.isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : (
            <DataTable
              columns={latenessColumns}
              data={late as unknown as Record<string, unknown>[]}
              pageSize={8}
            />
          )}
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5: Productivity Leaderboard (WE360)
          ══════════════════════════════════════════════════════════════════ */}
      <Card
        className={`p-3 md:p-6 ${isProductivityReal ? "" : "opacity-60"}`}
        title={isProductivityReal ? "Live We360 productivity metrics" : "Connect WE360 integration to see real productivity metrics."}
      >
        {!isProductivityReal && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span aria-hidden>ℹ️</span>
            <span>
              {we360NotConnected ? (
                <><strong>Not connected.</strong> Set up the WE360 integration to see real productivity metrics.</>
              ) : we360NoDataForPeriod ? (
                <><strong>No data for this period.</strong> WE360 is connected — try a broader date range or hit Sync to backfill.</>
              ) : (
                <><strong>Sample data.</strong> Connect WE360 integration to see real productivity metrics.</>
              )}
            </span>
          </div>
        )}
        <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
          Activity Leaderboard
          {isProductivityReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Avg daily hours breakdown — sorted by activity % descending (active ÷ online, matches We360) | Target: 90%
        </p>
        <ResponsiveContainer width="100%" height={productivityData.length * 40 + 60}>
          <BarChart
            data={productivityData}
            layout="vertical"
            margin={{ top: 5, right: 100, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${v}h`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(1)}h`, String(name)]}
              labelFormatter={(label) => {
                const item = productivityData.find((d) => d.name === label);
                return item
                  ? `${label} — ${item.productivePct}% active (${item.totalHrs}h online)`
                  : String(label);
              }}
            />
            <Bar dataKey="Productive" stackId="time" fill={PROD_COLORS.productive} barSize={24}>
              <LabelList
                dataKey="Productive"
                content={(props) => {
                  const { x, width, y, height, value } = props as Record<string, unknown>;
                  const w = Number(width);
                  if (w < 25) return <></>;
                  return (
                    <text
                      x={Number(x) + w / 2}
                      y={Number(y) + Number(height) / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={9}
                      fontWeight={600}
                      fill="white"
                    >
                      {Number(value).toFixed(1)}h
                    </text>
                  );
                }}
              />
            </Bar>
            <Bar dataKey="Neutral"      stackId="time" fill={PROD_COLORS.neutral}      barSize={24} />
            <Bar dataKey="Unproductive" stackId="time" fill={PROD_COLORS.unproductive} barSize={24} />
            <Bar dataKey="Idle"         stackId="time" fill={PROD_COLORS.idle}         barSize={24} radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="barLabel"
                content={(props) => {
                  const { x, width, y, height, value } = props as Record<string, unknown>;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2}
                      textAnchor="start"
                      dominantBaseline="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="currentColor"
                    >
                      {String(value ?? "")}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Suppress unused-var warning for isPayrollReal */}
      {void isPayrollReal}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE EXPORT
// ════════════════════════════════════════════════════════════════════════════

export default function HRPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <HRContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
