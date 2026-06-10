"use client";

import { useMemo, useState } from "react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import {
  useTalexioHeadcount,
  useTalexioTimeLogs,
  useTalexioLeave,
  useTalexioPayslips,
} from "@/lib/hooks/useTalexio";
import { useHRFinancials, useHRRevPAH } from "@/lib/hooks/useHRData";
import {
  getActiveEmployees,
  getHeadcountBreakdowns,
  buildAttendanceLogs,
  buildLateArrivals,
  buildNotClockedIn,
  buildLeaveBalances,
  buildSickLeaveTop,
  buildPayrollSummary,
} from "@/lib/hr/talexio-transforms";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  PieChart,
  Pie,
  LabelList,
} from "recharts";

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const REVPAH_TARGET = 35;
const HC_PCT_TARGET = 35;

const PIE_COLORS = [
  chartColors.spa,
  chartColors.aesthetics,
  chartColors.slimming,
  "#D5C0E5",
  "#E5B5D0",
  "#B5DCDC",
  "#E5C088",
  "#A8D4A8",
];

const PROD_COLORS = {
  productive: "#A8D4A8",
  neutral: "#C7C4BD",
  unproductive: "#E8A8A0",
  idle: "#E5C088",
};

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getRevPAHColor(value: number): string {
  if (value >= REVPAH_TARGET) return chartColors.slimming;
  if (value >= REVPAH_TARGET * 0.9) return chartColors.aesthetics;
  return chartColors.target;
}

function getHCPctColor(value: number): string {
  if (value <= HC_PCT_TARGET) return chartColors.slimming;
  if (value <= HC_PCT_TARGET * 1.1) return chartColors.aesthetics;
  return chartColors.target;
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

function currentMonthYYYYMM(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function prettyMonth(yyyymm: string): string {
  // "2026-03" → "March 2026"
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
// SAMPLE FALLBACK DATA (used when a live data source is unavailable)
// ════════════════════════════════════════════════════════════════════════════

const HEADCOUNT_FALLBACK = {
  totalActive: 75,
  totalAll: 82,
  terminated: 7,
  byPosition: [
    { name: "Therapist", count: 25 },
    { name: "Aesthetician", count: 10 },
    { name: "Receptionist", count: 8 },
    { name: "Manager", count: 8 },
    { name: "Nurse", count: 6 },
    { name: "Slimming Consultant", count: 5 },
    { name: "Cleaning & Maintenance", count: 5 },
    { name: "Admin & Support", count: 4 },
    { name: "Marketing", count: 2 },
    { name: "Finance", count: 2 },
  ],
  byOrgUnit: [
    { name: "InterContinental", count: 15 },
    { name: "Hugos", count: 12 },
    { name: "Hyatt", count: 10 },
    { name: "Ramla Bay", count: 9 },
    { name: "Labranda", count: 8 },
    { name: "Odycy", count: 8 },
    { name: "Novotel", count: 7 },
    { name: "Excelsior", count: 6 },
  ],
};

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

const NOT_CLOCKED_IN_FALLBACK = [
  "Christian Bugeja",
  "Doris Said",
  "Emmanuel Grima",
  "Francesca Brincat",
  "George Axiak",
  "Helene Busuttil",
  "Ivan Fenech",
  "Karen Mallia",
  "Lorenzo Schembri",
  "Martha Xuereb",
  "Noel Azzopardi",
  "Pauline Scerri",
];

const LEAVE_BALANCES_FALLBACK = [
  { name: "Rana Hussain", vacationHrs: 120, sickHrs: 96, totalTypes: 4, totalHrs: 248 },
  { name: "Tom Bonello", vacationHrs: 160, sickHrs: 88, totalTypes: 3, totalHrs: 272 },
  { name: "Adeel Malik", vacationHrs: 140, sickHrs: 72, totalTypes: 4, totalHrs: 244 },
  { name: "Jake Tanti", vacationHrs: 130, sickHrs: 64, totalTypes: 3, totalHrs: 218 },
  { name: "Maria Borg", vacationHrs: 160, sickHrs: 48, totalTypes: 4, totalHrs: 240 },
  { name: "Mark Spiteri", vacationHrs: 145, sickHrs: 40, totalTypes: 3, totalHrs: 209 },
  { name: "Lisa Farrugia", vacationHrs: 160, sickHrs: 32, totalTypes: 4, totalHrs: 224 },
  { name: "Elena Petrova", vacationHrs: 155, sickHrs: 24, totalTypes: 3, totalHrs: 203 },
  { name: "Sarah Caballeri", vacationHrs: 160, sickHrs: 16, totalTypes: 4, totalHrs: 208 },
  { name: "Katya Dimech", vacationHrs: 148, sickHrs: 16, totalTypes: 3, totalHrs: 188 },
];

const SICK_LEAVE_TOP_FALLBACK = [
  { name: "Rana Hussain", entitlement: 96 },
  { name: "Tom Bonello", entitlement: 88 },
  { name: "Adeel Malik", entitlement: 72 },
  { name: "Jake Tanti", entitlement: 64 },
  { name: "Maria Borg", entitlement: 48 },
  { name: "Mark Spiteri", entitlement: 40 },
  { name: "Lisa Farrugia", entitlement: 32 },
  { name: "Elena Petrova", entitlement: 24 },
  { name: "Sarah Caballeri", entitlement: 16 },
  { name: "Katya Dimech", entitlement: 16 },
];

const PAYROLL_FALLBACK = {
  latestMonth: "2026-03",
  latestGross: 134800,
  latestNet: 101100,
  latestTax: 21568,
  avgCostPerEmployee: 1797,
  locationData: [
    { name: "InterContinental", gross: 28500, headcount: 15, avgCost: 1900 },
    { name: "Hugos", gross: 22800, headcount: 12, avgCost: 1900 },
    { name: "Hyatt", gross: 18500, headcount: 10, avgCost: 1850 },
    { name: "Ramla Bay", gross: 15750, headcount: 9, avgCost: 1750 },
    { name: "Labranda", gross: 14400, headcount: 8, avgCost: 1800 },
    { name: "Odycy", gross: 13600, headcount: 8, avgCost: 1700 },
    { name: "Novotel", gross: 11900, headcount: 7, avgCost: 1700 },
    { name: "Excelsior", gross: 9350, headcount: 6, avgCost: 1558 },
  ],
};

const REVPAH_FALLBACK = [
  { location: "Hugos", revpah: 48.20, revenue: 52400 },
  { location: "Hyatt", revpah: 43.80, revenue: 41200 },
  { location: "InterContinental", revpah: 39.50, revenue: 58700 },
  { location: "Odycy", revpah: 37.10, revenue: 29800 },
  { location: "Excelsior", revpah: 35.60, revenue: 22400 },
  { location: "Ramla Bay", revpah: 32.40, revenue: 31600 },
  { location: "Labranda", revpah: 29.80, revenue: 27500 },
  { location: "Novotel", revpah: 26.50, revenue: 21900 },
];

const TOTAL_REVENUE_FALLBACK = 285500;

const HC_BY_LOCATION_FALLBACK = [
  { name: "Novotel", hcPct: 28.5, payroll: 11900, revenue: 41760, headcount: 7 },
  { name: "Excelsior", hcPct: 30.2, payroll: 9350, revenue: 30960, headcount: 6 },
  { name: "Labranda", hcPct: 31.4, payroll: 14400, revenue: 45860, headcount: 8 },
  { name: "InterContinental", hcPct: 32.1, payroll: 28500, revenue: 88786, headcount: 15 },
  { name: "Odycy", hcPct: 33.8, payroll: 13600, revenue: 40236, headcount: 8 },
  { name: "Ramla Bay", hcPct: 34.9, payroll: 15750, revenue: 45129, headcount: 9 },
  { name: "Hugos", hcPct: 36.5, payroll: 22800, revenue: 62466, headcount: 12 },
  { name: "Hyatt", hcPct: 38.2, payroll: 18500, revenue: 48429, headcount: 10 },
];

const HC_BY_BU_FALLBACK = [
  { name: "Spa", hcPct: 33.4, payroll: 97056, revenue: 290588 },
  { name: "Aesthetics", hcPct: 30.8, payroll: 24264, revenue: 78779 },
  { name: "Slimming", hcPct: 36.2, payroll: 13480, revenue: 37238 },
];

const GROUP_HC_PCT_FALLBACK = 33.1;

const PRODUCTIVITY_DATA = [
  { name: "Sarah M.", productive: 5.8, neutral: 0.6, unproductive: 0.2, idle: 0.8, productivePct: 89, totalHrs: "7.4" },
  { name: "Abid K.", productive: 5.5, neutral: 0.7, unproductive: 0.3, idle: 0.9, productivePct: 84, totalHrs: "7.4" },
  { name: "Elena P.", productive: 5.4, neutral: 0.8, unproductive: 0.3, idle: 0.9, productivePct: 82, totalHrs: "7.4" },
  { name: "Juli R.", productive: 5.2, neutral: 0.8, unproductive: 0.4, idle: 1.0, productivePct: 81, totalHrs: "7.4" },
  { name: "Rana H.", productive: 5.1, neutral: 0.9, unproductive: 0.4, idle: 1.0, productivePct: 78, totalHrs: "7.4" },
  { name: "Maria C.", productive: 4.9, neutral: 0.9, unproductive: 0.5, idle: 1.1, productivePct: 76, totalHrs: "7.4" },
  { name: "Lisa F.", productive: 4.8, neutral: 1.0, unproductive: 0.5, idle: 1.1, productivePct: 75, totalHrs: "7.4" },
  { name: "Nicci D.", productive: 4.6, neutral: 0.9, unproductive: 0.5, idle: 1.2, productivePct: 72, totalHrs: "7.2" },
  { name: "Jake T.", productive: 4.5, neutral: 1.0, unproductive: 0.6, idle: 1.3, productivePct: 71, totalHrs: "7.4" },
  { name: "Mark S.", productive: 4.3, neutral: 1.0, unproductive: 0.6, idle: 1.4, productivePct: 68, totalHrs: "7.3" },
  { name: "Adeel M.", productive: 3.8, neutral: 0.8, unproductive: 0.7, idle: 1.5, productivePct: 58, totalHrs: "6.8" },
  { name: "Tom B.", productive: 3.5, neutral: 0.7, unproductive: 0.8, idle: 1.6, productivePct: 55, totalHrs: "6.6" },
].map((s) => ({
  name: s.name,
  Productive: s.productive,
  Neutral: s.neutral,
  Unproductive: s.unproductive,
  Idle: s.idle,
  productivePct: s.productivePct,
  totalHrs: s.totalHrs,
}));

// Static KPI values that we don't have a live source for yet.
const SICK_LEAVE_PCT_SAMPLE = "4.8%";
const TURNOVER_RATE_SAMPLE = "8.5%";

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

const sickLeaveColumns = [
  { key: "name", label: "Employee" },
  {
    key: "entitlement",
    label: "Sick Leave Hours",
    align: "right" as const,
    sortable: true,
    render: (v: unknown) => {
      const hrs = Number(v);
      if (hrs > 100) return getStatusBadge(`${hrs}h`, "bg-red-100 text-red-800");
      if (hrs > 50) return getStatusBadge(`${hrs}h`, "bg-amber-100 text-amber-800");
      return `${hrs}h`;
    },
  },
];

const leaveBalanceColumns = [
  { key: "name", label: "Employee", sortable: true },
  { key: "vacationHrs", label: "Vacation (hrs)", align: "right" as const, sortable: true },
  {
    key: "sickHrs",
    label: "Sick (hrs)",
    align: "right" as const,
    sortable: true,
    render: (v: unknown) => {
      const hrs = Number(v);
      if (hrs > 80) return getStatusBadge(`${hrs}h`, "bg-red-100 text-red-800");
      if (hrs > 40) return getStatusBadge(`${hrs}h`, "bg-amber-100 text-amber-800");
      return `${hrs}h`;
    },
  },
  { key: "totalTypes", label: "Leave Types", align: "right" as const },
  { key: "totalHrs", label: "Total (hrs)", align: "right" as const, sortable: true },
];

// ════════════════════════════════════════════════════════════════════════════
// MAIN CONTENT
// ════════════════════════════════════════════════════════════════════════════

function HRContent() {
  const [month, setMonth] = useState<string>(currentMonthYYYYMM());

  // ── Live data: Talexio ────────────────────────────────────────────────────
  const headcountQ = useTalexioHeadcount();
  const timeLogsQ = useTalexioTimeLogs();
  const leaveQ = useTalexioLeave();
  const payslipsQ = useTalexioPayslips();

  // ── Live data: Supabase-backed HR financials (may not exist yet) ─────────
  const financialsQ = useHRFinancials(month);
  const revpahQ = useHRRevPAH(month);

  // ── Derive Talexio-backed views (memoized) ───────────────────────────────
  const activeEmployees = useMemo(
    () =>
      headcountQ.data?.employees
        ? getActiveEmployees(headcountQ.data.employees)
        : null,
    [headcountQ.data],
  );

  const headcount = useMemo(() => {
    if (!headcountQ.data?.employees) return null;
    return getHeadcountBreakdowns(headcountQ.data.employees);
  }, [headcountQ.data]);

  const attendanceRows = useMemo(() => {
    if (!timeLogsQ.data?.employees) return null;
    return buildAttendanceLogs(timeLogsQ.data.employees);
  }, [timeLogsQ.data]);

  const lateRows = useMemo(() => {
    if (!attendanceRows) return null;
    return buildLateArrivals(attendanceRows);
  }, [attendanceRows]);

  const notClockedIn = useMemo(() => {
    if (!activeEmployees || !timeLogsQ.data?.employees) return null;
    return buildNotClockedIn(activeEmployees, timeLogsQ.data.employees);
  }, [activeEmployees, timeLogsQ.data]);

  const leaveBalances = useMemo(() => {
    if (!leaveQ.data?.employees) return null;
    return buildLeaveBalances(leaveQ.data.employees);
  }, [leaveQ.data]);

  const sickLeaveTop = useMemo(() => {
    if (!leaveBalances) return null;
    return buildSickLeaveTop(leaveBalances);
  }, [leaveBalances]);

  const payroll = useMemo(() => {
    if (!payslipsQ.data?.employees) return null;
    return buildPayrollSummary(payslipsQ.data.employees);
  }, [payslipsQ.data]);

  // ── Source flags ─────────────────────────────────────────────────────────
  const isHeadcountReal = headcount !== null;
  const isAttendanceReal = attendanceRows !== null;
  const isLateReal = lateRows !== null;
  const isNotClockedInReal = notClockedIn !== null;
  const isLeaveReal = leaveBalances !== null;
  const isPayrollReal = payroll !== null;
  const isFinancialsReal = financialsQ.isSuccess && !!financialsQ.data;
  const isRevPAHReal = revpahQ.isSuccess && !!revpahQ.data;

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
  const headcountActive = headcount?.totalActive ?? HEADCOUNT_FALLBACK.totalActive;
  const positions = headcount?.byPosition ?? HEADCOUNT_FALLBACK.byPosition;
  const orgUnits = headcount?.byOrgUnit ?? HEADCOUNT_FALLBACK.byOrgUnit;

  const attendance = attendanceRows ?? ATTENDANCE_FALLBACK;
  const late = lateRows ?? LATE_FALLBACK;
  const notIn = notClockedIn ?? NOT_CLOCKED_IN_FALLBACK;

  const leaves = leaveBalances ?? LEAVE_BALANCES_FALLBACK;
  const sickTop = sickLeaveTop ?? SICK_LEAVE_TOP_FALLBACK;

  const payrollData = payroll ?? PAYROLL_FALLBACK;

  const hcByLocation = financialsQ.data?.byLocation ?? HC_BY_LOCATION_FALLBACK;
  const hcByBU = financialsQ.data?.byBusinessUnit ?? HC_BY_BU_FALLBACK;
  const groupHcPct = financialsQ.data?.groupHcPct ?? GROUP_HC_PCT_FALLBACK;
  const totalRevenue = financialsQ.data?.totalRevenue ?? TOTAL_REVENUE_FALLBACK;

  const revpahData = revpahQ.data?.byLocation ?? REVPAH_FALLBACK;
  const avgRevPAH = useMemo(() => {
    if (revpahQ.data?.avgRevPAH !== undefined) return revpahQ.data.avgRevPAH;
    return (
      Math.round(
        (revpahData.reduce((s, r) => s + r.revpah, 0) / revpahData.length) * 100,
      ) / 100
    );
  }, [revpahQ.data, revpahData]);

  // ── Derived KPI values ───────────────────────────────────────────────────
  const avgProductivity = useMemo(
    () =>
      Math.round(
        PRODUCTIVITY_DATA.reduce((s, p) => s + p.productivePct, 0) /
          PRODUCTIVITY_DATA.length,
      ),
    [],
  );

  const revenuePerEmployee = Math.round(totalRevenue / headcountActive);

  const onTimePct =
    attendance.length > 0
      ? Math.round(((attendance.length - late.length) / attendance.length) * 100)
      : 0;

  // ── KPI cards ────────────────────────────────────────────────────────────
  const kpis: KPIData[] = [
    {
      label: "Human Capital %",
      value: `${groupHcPct}%`,
      target: `${HC_PCT_TARGET}%`,
      targetValue: HC_PCT_TARGET,
      currentValue: groupHcPct,
    },
    { label: "Monthly Gross Payroll", value: formatCurrency(payrollData.latestGross) },
    { label: "Avg Cost / Employee", value: formatCurrency(payrollData.avgCostPerEmployee) },
    { label: "Active Employees", value: String(headcountActive) },
    {
      label: "On-Time %",
      value: `${onTimePct}%`,
      target: "90%",
      targetValue: 90,
      currentValue: onTimePct,
    },
    { label: "Sick Leave %", value: SICK_LEAVE_PCT_SAMPLE, isSample: true },
    {
      label: "Avg Productivity",
      value: `${avgProductivity}%`,
      target: "80%",
      targetValue: 80,
      currentValue: avgProductivity,
      isSample: true,
    },
    {
      label: "Avg RevPAH",
      value: formatCurrency(avgRevPAH),
      target: `${formatCurrency(REVPAH_TARGET)}/hr`,
      targetValue: REVPAH_TARGET,
      currentValue: avgRevPAH,
    },
    { label: "Turnover Rate", value: TURNOVER_RATE_SAMPLE, isSample: true },
    { label: "Revenue / Employee", value: formatCurrency(revenuePerEmployee) },
  ];

  // ── Header badge state ───────────────────────────────────────────────────
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

  // ── Page subtitle (dynamic when live data is available) ──────────────────
  const subtitle = useMemo(() => {
    const monthLabel = prettyMonth(payrollData.latestMonth);
    const locations = orgUnits.length;
    return `${monthLabel} — ${headcountActive} active employees across ${locations} locations`;
  }, [payrollData.latestMonth, headcountActive, orgUnits.length]);

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Human Resources</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="hr-month">
              Month
            </label>
            <input
              id="hr-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="text-xs border rounded-md px-2 py-1 bg-background"
            />
          </div>
        </div>
        {headerBadge}
      </div>

      {/* Soft error banner — only when Talexio actually errored. */}
      {talexioError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <span aria-hidden>⚠️</span>
          <span>Talexio connection unavailable. Showing cached or sample data.</span>
        </div>
      )}

      {/* ── KPI Row ────────────────────────────────────────────────────── */}
      {talexioLoading && !headcount ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-5 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-2 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <KPICardRow kpis={kpis} />
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
                stroke={chartColors.target}
                strokeDasharray="3 3"
                label={{
                  value: `Target ${HC_PCT_TARGET}%`,
                  position: "top",
                  fill: chartColors.target,
                  fontSize: 11,
                }}
              />
              <Bar dataKey="hcPct" name="HC %" barSize={28}>
                {hcByLocation.map((entry) => (
                  <Cell key={entry.name} fill={getHCPctColor(entry.hcPct)} />
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
            Group HC%: {groupHcPct}% — Payroll / Revenue by brand
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
              <ReferenceLine x={HC_PCT_TARGET} stroke={chartColors.target} strokeDasharray="3 3" />
              <Bar dataKey="hcPct" name="HC %">
                {hcByBU.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={[chartColors.spa, chartColors.aesthetics, chartColors.slimming][i % 3]}
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
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <ReferenceLine
                y={REVPAH_TARGET}
                stroke={chartColors.target}
                strokeDasharray="3 3"
                label={{
                  value: `Target ${formatCurrency(REVPAH_TARGET)}/hr`,
                  position: "right",
                  fill: chartColors.target,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="revpah" name="RevPAH">
                {revpahData.map((entry) => (
                  <Cell key={entry.location} fill={getRevPAHColor(entry.revpah)} />
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
              ({attendance.length} of {headcountActive} clocked in)
            </span>
            {isAttendanceReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {timeLogsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
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
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={latenessColumns}
              data={late as unknown as Record<string, unknown>[]}
              pageSize={8}
            />
          )}
        </Card>
      </div>

      {/* Not Clocked In */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
          Not Clocked In Today
          <span className="ml-2 text-sm font-normal text-amber-600">({notIn.length})</span>
          {isNotClockedInReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
        </h2>
        {timeLogsQ.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {notIn.map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-sm"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                {name}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4: Headcount Breakdown
          ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Headcount by Position
            {isHeadcountReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {headcountQ.isLoading ? (
            <Skeleton className="h-[400px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={positions.length * 36 + 50}>
              <BarChart
                data={positions}
                layout="vertical"
                margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={145} />
                <Tooltip />
                <Bar dataKey="count" name="Employees" fill={chartColors.spa} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="count"
                    position="right"
                    style={{ fontSize: 11, fontWeight: 600, fill: "currentColor" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Headcount by Location
            {isHeadcountReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {headcountQ.isLoading ? (
            <Skeleton className="h-[350px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={orgUnits}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="count"
                  nameKey="name"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {orgUnits.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5: Leave Balances + Sick Leave
          ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Leave Balances — {new Date().getFullYear()}
            {isLeaveReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {leaveQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={leaveBalanceColumns}
              data={leaves as unknown as Record<string, unknown>[]}
              pageSize={10}
            />
          )}
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center">
            Sick Leave — Top Users
            {isLeaveReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
          </h2>
          {leaveQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={sickLeaveColumns}
              data={sickTop as unknown as Record<string, unknown>[]}
              pageSize={10}
            />
          )}
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 6: Productivity Leaderboard (WE360 sample)
          ══════════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6 opacity-60" title="Connect WE360 integration to see real productivity metrics.">
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span aria-hidden>ℹ️</span>
          <span>
            <strong>Sample data.</strong> This section shows sample data. Connect WE360 integration to see real
            productivity metrics.
          </span>
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
          Productivity Leaderboard
          <SampleDataBadge />
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Daily hours breakdown — sorted by productive % descending | Target: 80%
        </p>
        <ResponsiveContainer width="100%" height={PRODUCTIVITY_DATA.length * 40 + 60}>
          <BarChart
            data={PRODUCTIVITY_DATA}
            layout="vertical"
            margin={{ top: 5, right: 100, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${v}h`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(1)}h`, String(name)]}
              labelFormatter={(label) => {
                const item = PRODUCTIVITY_DATA.find((d) => d.name === label);
                return item
                  ? `${label} — ${item.productivePct}% productive (${item.totalHrs}h total)`
                  : String(label);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
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
            <Bar dataKey="Neutral" stackId="time" fill={PROD_COLORS.neutral} barSize={24} />
            <Bar dataKey="Unproductive" stackId="time" fill={PROD_COLORS.unproductive} barSize={24} />
            <Bar dataKey="Idle" stackId="time" fill={PROD_COLORS.idle} barSize={24} radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="productivePct"
                content={(props) => {
                  const { x, width, y, height, index } = props as Record<string, unknown>;
                  const entry = PRODUCTIVITY_DATA[Number(index)];
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
                      {entry.productivePct}% — {entry.totalHrs}h
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 7: Payroll by Location
          ══════════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
          Payroll by Location
          {isPayrollReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Gross payroll — {prettyMonth(payrollData.latestMonth)}
        </p>
        {payslipsQ.isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={payrollData.locationData.length * 40 + 50}>
            <BarChart
              data={payrollData.locationData}
              layout="vertical"
              margin={{ top: 5, right: 100, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => `€${(v / 1000).toFixed(1)}K`}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="gross" name="Gross Pay" fill={chartColors.spa} barSize={28} radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="gross"
                  content={(props) => {
                    const { x, width, y, height, index } = props as Record<string, unknown>;
                    const entry = payrollData.locationData[Number(index)];
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
                        {formatCurrency(entry.gross)} ({entry.headcount} staff)
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <CIChat />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE EXPORT
// ════════════════════════════════════════════════════════════════════════════

export default function HRPage() {
  return <DashboardShell>{() => <HRContent />}</DashboardShell>;
}
