"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";

const TARGET_AMBER = "#D97706"; // target reference-line marker (not a brand color)

// ── HC% drill-down: location name → slug mapping ──────────────────────────
const LOCATION_NAME_TO_SLUG: Record<string, string> = {
  "Hugo's":        "hugos",
  "Hugos":         "hugos",
  "InterCon":      "inter",
  "Inter":         "inter",
  "InterContinental": "inter",
  "Ramla":         "ramla",
  "Ramla Bay":     "ramla",
  "Hyatt":         "hyatt",
  "Excelsior":     "excelsior",
  "ODYCY":         "odycy",
  "Odycy":         "odycy",
  "Sunny Coast":   "odycy",
  "Labranda":      "labranda",
  "Riviera":       "labranda",
  "Riveira":       "labranda",
  "Novotel":       "novotel",
  "HQ":            "hq",
  "Aesthetics":    "aesthetics",
  "Slimming":      "slimming",
  "Spa":           "hugos", // fallback for brand-level "Spa" BU
};

const SLUG_DISPLAY: Record<string, string> = {
  hugos:       "Hugo's Lounge",
  inter:       "InterContinental",
  ramla:       "Ramla Bay",
  hyatt:       "Hyatt",
  excelsior:   "Excelsior",
  odycy:       "ODYCY",
  labranda:    "Labranda Riviera",
  novotel:     "Novotel",
  hq:          "HQ / Management",
  aesthetics:  "Aesthetics",
  slimming:    "Slimming",
};

function locationNameToSlug(name: string): string {
  return LOCATION_NAME_TO_SLUG[name] ?? name.toLowerCase().replace(/\s+/g, "");
}

// Spa business unit = all hotel-spa locations (no single slug).
const SPA_HOTEL_SLUGS = ["inter", "hugos", "hyatt", "novotel", "excelsior", "ramla", "odycy", "labranda"];

// HC% drill-down target: either a single location slug or a business unit
// (which may aggregate multiple location slugs, e.g. "Spa").
type DrillTarget = {
  label: string;
  /** Location slugs whose wage attribution should be aggregated in the panel. */
  slugs: string[];
};

// Map a Business Unit bar label → drill target. "Spa" expands to all hotel
// locations; Aesthetics / Slimming map to their single slug.
function businessUnitToDrill(name: string): DrillTarget {
  if (/aesthetic/i.test(name)) return { label: "Aesthetics", slugs: ["aesthetics"] };
  if (/slimming/i.test(name))  return { label: "Slimming",   slugs: ["slimming"] };
  // Default: Spa (group of all hotel-spa locations)
  return { label: "Spa", slugs: SPA_HOTEL_SLUGS };
}

import { SPA_LOCATION_COLOR_BY_NAME, SPA_LOCATION_FALLBACK_COLOR } from "@/lib/constants/spa-locations";
import {
  useTalexioHeadcount,
  useTalexioTimeLogs,
  useTalexioLeave,
  useTalexioPayslips,
  useTalexioShiftsRange,
  useTalexioSickLeave,
  type TalexioEmployeeWithLeaveRequests,
} from "@/lib/hooks/useTalexio";
import { useHRFinancials, useHRRevPAH, useWe360Productivity, useHREmployeeMovement, useLocationSplits, type EmployeeLocationSplit } from "@/lib/hooks/useHRData";
import { computeHRCommentary, type HRCommentaryInput, type HRCommentaryOutput } from "@/lib/commentary/engine";
import { normaliseLocation, LOCATION_TO_BRAND } from "@/lib/constants/hr-mapping";
import { useAttendance, type AttendanceFilter } from "@/lib/hooks/useAttendance";
import {
  getActiveEmployees,
  buildAttendanceLogs,
  buildLateArrivals,
  buildLeaveBalances,
  buildPayrollSummary,
  buildPeriodAttendanceSummary,
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
  PieChart,
  Pie,
  Legend,
  ComposedChart,
  Line,
} from "recharts";

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const REVPAH_TARGET = 35;
const HC_PCT_TARGET = 40;

// ── Staff composition classification ─────────────────────────────────────────
const MANAGEMENT_KW  = ["manager", "director", "head of", "supervisor", "general manager", "operations manager", "hr manager", "executive", "chief"];
const THERAPIST_KW   = ["therapist", "beautician", "massage", "beauty", "esthetician", "aesthetician", "slimming specialist", "body contouring", "wellness therapist", "treatment"];
const INTERN_KW      = ["intern", "student", "trainee", "apprentice"];
const RECEPTION_KW   = ["receptionist", "advisor", "wellness advisor", "guest", "front desk", "concierge", "host", "reception", "customer service"];
const PART_TIME_KW   = ["part time", "part-time", "p/t", "pt therapist"];

type RoleKey = "management" | "fullTimeTherapist" | "partTimeTherapist" | "intern" | "receptionAdvisor" | "hq" | "other";

const ROLE_META: Record<RoleKey, { label: string; color: string }> = {
  management:         { label: "Management",            color: "#6366f1" },
  fullTimeTherapist:  { label: "Full-time Therapists",  color: "#10b981" },
  partTimeTherapist:  { label: "Part-time Therapists",  color: "#06b6d4" },
  intern:             { label: "Intern/Student",         color: "#f59e0b" },
  receptionAdvisor:   { label: "Reception & Advisors",  color: "#3b82f6" },
  hq:                 { label: "HQ & Admin",             color: "#8b5cf6" },
  other:              { label: "Other",                  color: "#94a3b8" },
};

const PROD_COLORS = {
  productive: "#A8D4A8",
  neutral: "#C7C4BD",
  unproductive: "#E8A8A0",
  idle: "#E5C088",
};

// ── Activity Leaderboard grouping ────────────────────────────────────────────
// HQ = back-office / support; CRM = sales team.
// Matched by first name so last-initial format changes don't break it.
const LEADERBOARD_HQ = new Set(["Ruksana", "Mandar", "Nicole", "Melissa", "Yofan", "Yamuna"]);
const LEADERBOARD_GROUP_ORDER = { HQ: 0, CRM: 1 } as const;
type LeaderboardGroup = keyof typeof LEADERBOARD_GROUP_ORDER;
const LEADERBOARD_GROUP_LABELS: Record<LeaderboardGroup, string> = { HQ: "HQ", CRM: "CRM" };

function empGroup(name: string): LeaderboardGroup {
  const first = name.split(" ")[0];
  if (LEADERBOARD_HQ.has(first)) return "HQ";
  return "CRM";
}

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
  /** True when the value was extrapolated from prior-month data (not missing, just estimated). */
  isEstimated?: boolean;
  /** Optional footnote displayed below the value. */
  note?: string;
}

function HRMetricCard({ label, value, target, targetValue, currentValue, lowerIsBetter = false, isSample = false, isEstimated = false, note }: HRMetricData) {
  const hasTarget = targetValue != null && currentValue != null && targetValue > 0;

  type Status = "good" | "warn" | "bad" | "neutral";
  let status: Status = "neutral";
  if (hasTarget) {
    const ratio = currentValue! / targetValue!;
    status = lowerIsBetter
      ? ratio <= 1 ? "good" : "bad"   // above target = red, no warn zone (e.g. HC%)
      : ratio >= 1 ? "good" : ratio >= 0.9 ? "warn" : "bad";
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
        ) : isEstimated ? (
          <span className="shrink-0 text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5 leading-none">est.</span>
        ) : status !== "neutral" ? (
          <span className={`shrink-0 text-[10px] font-semibold border rounded-full px-1.5 py-0.5 leading-none ${s.pill}`}>{s.pillText}</span>
        ) : null}
      </div>
      <p className={`text-2xl md:text-3xl font-bold leading-none ${s.valueCls}`}>{value}</p>
      {target && (
        <p className="text-xs text-slate-400 font-medium leading-none">Target: {target}</p>
      )}
      {note && (
        <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{note}</p>
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

const REVPAH_FALLBACK: Array<{ location: string; revpah: number; revenue: number; brand: string; headcount?: number; availableHours?: number; denomSource?: string }> = [
  { location: "Hugos",             revpah: 48.20, revenue: 52400,  brand: "Spa" },
  { location: "Hyatt",             revpah: 43.80, revenue: 41200,  brand: "Spa" },
  { location: "InterContinental",  revpah: 39.50, revenue: 58700,  brand: "Spa" },
  { location: "Odycy",             revpah: 37.10, revenue: 29800,  brand: "Spa" },
  { location: "Excelsior",         revpah: 35.60, revenue: 22400,  brand: "Spa" },
  { location: "Ramla Bay",         revpah: 32.40, revenue: 31600,  brand: "Spa" },
  { location: "Riviera",           revpah: 29.80, revenue: 27500,  brand: "Spa" },
  { location: "Novotel",           revpah: 26.50, revenue: 21900,  brand: "Spa" },
  { location: "Aesthetics Centre", revpah: 68.40, revenue: 127000, brand: "Aesthetics" },
  { location: "Slimming Centre",   revpah: 44.20, revenue: 38200,  brand: "Slimming" },
];

const REVPAH_BY_BRAND_FALLBACK = {
  Spa:        { locations: REVPAH_FALLBACK.filter((r) => r.brand === "Spa"),        avgRevPAH: 36.6, target: 50 },
  Aesthetics: { locations: REVPAH_FALLBACK.filter((r) => r.brand === "Aesthetics"), avgRevPAH: 68.4, target: 70 },
  Slimming:   { locations: REVPAH_FALLBACK.filter((r) => r.brand === "Slimming"),   avgRevPAH: 44.2, target: 35 },
};

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

// Per-day late arrivals (today view) — kept for fallback / single-day usage
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

// Period-aggregated late arrivals (roster-based, across all days in the selected range)
const periodLatenessColumns = [
  { key: "name", label: "Employee" },
  { key: "daysLate", label: "Days Late", align: "right" as const, sortable: true },
  {
    key: "totalMinutesLate",
    label: "Total Mins Late",
    align: "right" as const,
    sortable: true,
    render: (v: unknown) => {
      const mins = Number(v);
      if (mins > 120) return getStatusBadge(`${mins}m`, "bg-red-100 text-red-800");
      if (mins > 30)  return getStatusBadge(`${mins}m`, "bg-amber-100 text-amber-800");
      return getStatusBadge(`${mins}m`, "bg-yellow-100 text-yellow-800");
    },
  },
  {
    key: "avgMinutesLate",
    label: "Avg / Day",
    align: "right" as const,
    render: (v: unknown) => `${v}m`,
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

// Column defs for the longitudinal attendance table
const attendanceHistoryColumns = [
  { key: "date",            label: "Date",          sortable: true },
  { key: "employee_name",   label: "Employee",      sortable: true },
  { key: "scheduled_start", label: "Sched. Start",  align: "right" as const },
  {
    key: "clock_in",
    label: "Clock In",
    align: "right" as const,
    render: (v: unknown, row: Record<string, unknown>) => {
      if (!v) return getStatusBadge("Absent", "bg-slate-100 text-slate-500");
      if (row.is_late) return getStatusBadge(String(v), "bg-red-100 text-red-700");
      return <span className="text-slate-700">{String(v)}</span>;
    },
  },
  {
    key: "is_late",
    label: "Late",
    align: "center" as const,
    render: (v: unknown, row: Record<string, unknown>) => {
      if (!v) return null;
      const mins = Number(row.minutes_late ?? 0);
      const cls = mins > 30 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
      return getStatusBadge(`+${mins}m`, cls);
    },
  },
  { key: "scheduled_end", label: "Sched. End",  align: "right" as const },
  {
    key: "clock_out",
    label: "Clock Out",
    align: "right" as const,
    render: (v: unknown, row: Record<string, unknown>) => {
      if (!v) return null;
      if (row.left_early) return getStatusBadge(String(v), "bg-orange-100 text-orange-700");
      return <span className="text-slate-700">{String(v)}</span>;
    },
  },
  {
    key: "left_early",
    label: "Left Early",
    align: "center" as const,
    render: (v: unknown, row: Record<string, unknown>) => {
      if (!v) return null;
      const mins = Number(row.minutes_early_out ?? 0);
      return getStatusBadge(`-${mins}m`, "bg-orange-100 text-orange-700");
    },
  },
  {
    key: "hours_worked",
    label: "Hours",
    align: "right" as const,
    render: (v: unknown) => v != null ? `${Number(v).toFixed(1)}h` : "—",
  },
];

function HRContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const month = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}`;
  const fromISO = toISODate(dateFrom);
  const toISO = toISODate(dateTo);
  const queryClient = useQueryClient();

  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>("all");
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [clockedInModalOpen, setClockedInModalOpen] = useState(false);
  const [attendanceExpanded, setAttendanceExpanded] = useState(false);
  const [modalIssueFilter, setModalIssueFilter] = useState<"late" | "early">("late");
  const attendanceHistoryRef = useRef<HTMLDivElement>(null);

  // ── HC% drill-down state ──────────────────────────────────────────────────
  // Either a single location (one slug) or a business unit (one or many slugs).
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  // ── Live data: Talexio ────────────────────────────────────────────────────
  const headcountQ = useTalexioHeadcount();
  const timeLogsQ = useTalexioTimeLogs();
  const leaveQ = useTalexioLeave();
  const payslipsQ = useTalexioPayslips();
  const sickLeaveQ = useTalexioSickLeave(fromISO, toISO);
  // Fetch published roster for the full selected period — used to determine scheduled start
  // times and to compute period-level on-time % (roster is ground truth for lateness).
  const shiftsQ = useTalexioShiftsRange(fromISO, toISO);

  // ── Longitudinal attendance from Supabase ────────────────────────────────
  const attendanceHistoryQ = useAttendance(fromISO, toISO, attendanceFilter);
  // Issues query: late OR left early — drives chip counts
  const attendanceIssuesQ  = useAttendance(fromISO, toISO, "issues");
  // Per-filter modal queries (cached separately)
  const attendanceLateQ    = useAttendance(fromISO, toISO, "late");
  const attendanceEarlyQ   = useAttendance(fromISO, toISO, "early");

  // ── Live data: Supabase-backed HR financials ──────────────────────────────
  const financialsQ  = useHRFinancials(month);
  const revpahQ      = useHRRevPAH(month);
  const we360Q       = useWe360Productivity(fromISO, toISO);
  const movementQ    = useHREmployeeMovement(26);

  // ── HC% drill-down: location-level wage attribution ───────────────────────
  // For a single-slug drill we fetch that location only; for a multi-slug
  // business unit (e.g. Spa) we fetch ALL employees and aggregate client-side.
  const drillFetchSlug = drill && drill.slugs.length === 1 ? drill.slugs[0] : undefined;
  // Use the dashboard's active date range so the drill-down matches every other
  // metric on the page (arbitrary windows, not just whole months).
  const locationSplitsQ = useLocationSplits(fromISO, toISO, drillFetchSlug);

  // ── Talexio-derived views (memoized) ──────────────────────────────────────
  const activeEmployees = useMemo(
    () => (headcountQ.data?.employees ? getActiveEmployees(headcountQ.data.employees) : null),
    [headcountQ.data],
  );

  const headcountActive = useMemo(() => {
    if (!headcountQ.data?.employees) return null;
    return getActiveEmployees(headcountQ.data.employees).length;
  }, [headcountQ.data]);

  // Build "employeeId|YYYY-MM-DD" → scheduled start minutes for every published shift
  // in the selected period. This single map feeds both today's attendance table and
  // the period-level summary — keeping the logic consistent.
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

  // Period-level attendance: on-time %, late, absent — all roster-based.
  const periodSummary = useMemo(() => {
    if (!timeLogsQ.data?.employees || shiftStartByKey.size === 0) return null;
    return buildPeriodAttendanceSummary(timeLogsQ.data.employees, shiftStartByKey);
  }, [timeLogsQ.data, shiftStartByKey]);

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

  const revpahData   = revpahQ.data?.byLocation ?? REVPAH_FALLBACK;
  const revpahByBrand = revpahQ.data?.byBrand ?? REVPAH_BY_BRAND_FALLBACK;
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

  // Sort employees: HQ → Yamuna → CRM, within each group by hours desc.
  const sortedProductivityData = useMemo(() =>
    [...productivityData]
      .map(emp => ({ ...emp, _group: empGroup(emp.name) as LeaderboardGroup }))
      .sort((a, b) => {
        const gd = LEADERBOARD_GROUP_ORDER[a._group] - LEADERBOARD_GROUP_ORDER[b._group];
        if (gd !== 0) return gd;
        return parseFloat(b.totalHrs) - parseFloat(a.totalHrs);
      }),
  [productivityData]);

  // Custom Y-axis tick: renders a small group label above the first employee
  // in each group so categories are visually separated without extra rows.
  const GroupedYTick = useMemo(() => {
    const data = sortedProductivityData;
    return function CustomGroupTick(props: Record<string, unknown>) {
      const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
      const idx = data.findIndex(d => d.name === payload.value);
      const emp  = data[idx];
      const prev = idx > 0 ? data[idx - 1] : undefined;
      const isFirst = !prev || prev._group !== emp?._group;
      return (
        <g>
          {isFirst && emp?._group && (
            <text x={Number(x) - 4} y={Number(y) - 13} textAnchor="end" fontSize={8}
              fontWeight={700} fill="#9ca3af" letterSpacing={0.8}>
              {LEADERBOARD_GROUP_LABELS[emp._group]}
            </text>
          )}
          <text x={Number(x) - 4} y={Number(y)} dy={4} textAnchor="end" fontSize={12} fill="#374151">
            {payload.value}
          </text>
        </g>
      );
    };
  }, [sortedProductivityData]);

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

  const displayHeadcount = isFinancialsReal ? financialsQ.data!.totalHeadcount : resolvedHeadcount;
  const revenuePerEmployee = displayHeadcount > 0 ? Math.round(totalRevenue / displayHeadcount) : 0;

  // ── Staff composition (classified from headcountQ) ────────────────────────
  const staffComposition = useMemo(() => {
    const employees = headcountQ.data?.employees ?? [];
    const active = employees.filter((e) => !e.isTerminated && !e.currentPositionSimple?.isEnded);

    const counts: Record<RoleKey, number> = {
      management: 0, fullTimeTherapist: 0, partTimeTherapist: 0,
      intern: 0, receptionAdvisor: 0, hq: 0, other: 0,
    };
    const brandCounts = { spa: 0, aesthetics: 0, slimming: 0, hq: 0 };

    for (const emp of active) {
      const pos     = (emp.currentPositionSimple?.position?.name ?? "").toLowerCase();
      const orgUnit = emp.currentPositionSimple?.organisationUnit?.name ?? "";
      const loc     = normaliseLocation(orgUnit);
      const brand   = loc ? (LOCATION_TO_BRAND[loc] ?? "Spa") : "Spa";

      if (brand === "HQ")          { counts.hq++;         brandCounts.hq++; continue; }
      if (brand === "Aesthetics")  { brandCounts.aesthetics++; }
      else if (brand === "Slimming") { brandCounts.slimming++; }
      else                           { brandCounts.spa++; }

      const isIntern    = INTERN_KW.some((k) => pos.includes(k));
      const isTherapist = THERAPIST_KW.some((k) => pos.includes(k));
      const isPartTime  = PART_TIME_KW.some((k) => pos.includes(k));
      const isMgmt      = MANAGEMENT_KW.some((k) => pos.includes(k));
      const isReception = RECEPTION_KW.some((k) => pos.includes(k));

      if (isIntern)         counts.intern++;
      else if (isTherapist) isPartTime ? counts.partTimeTherapist++ : counts.fullTimeTherapist++;
      else if (isMgmt)      counts.management++;
      else if (isReception) counts.receptionAdvisor++;
      else                  counts.other++;
    }

    const total = active.length;
    const roleData = (Object.keys(counts) as RoleKey[])
      .map((key) => ({ key, count: counts[key], ...ROLE_META[key] }))
      .filter((r) => r.count > 0);

    return { total, roleData, brandCounts };
  }, [headcountQ.data]);

  // Roster-based on-time %: (rostered individuals who arrived on time) / (all rostered individuals).
  // Absent rostered employees count against the %, not just those who showed up.
  const onTimePct = periodSummary?.onTimePct ?? (
    attendance.length > 0
      ? Math.round(((attendance.length - late.length) / attendance.length) * 100)
      : 0
  );

  // ── Sick leave KPI (from leaveRequests, period-filtered) ─────────────────
  const sickLeaveKPI = useMemo(() => {
    const employees: TalexioEmployeeWithLeaveRequests[] = sickLeaveQ.data?.employees ?? [];
    const SICK_RE = /sick/i;
    let totalDays = 0;
    let uniqueEmployees = 0;
    for (const emp of employees) {
      if (emp.isTerminated) continue;
      const sickRequests = (emp.leaveRequests ?? []).filter(
        (r) => SICK_RE.test(r.leaveType?.name ?? "") && r.status === "Approved",
      );
      const empDays = sickRequests.reduce((sum, r) => sum + (r.numberOfDays ?? 0), 0);
      if (empDays > 0) {
        totalDays += empDays;
        uniqueEmployees++;
      }
    }
    return { totalDays, uniqueEmployees, isLoading: sickLeaveQ.isLoading, isError: sickLeaveQ.isError };
  }, [sickLeaveQ.data, sickLeaveQ.isLoading, sickLeaveQ.isError]);

  // ── Strategic Commentary ──────────────────────────────────────────────────
  const hrCommentary = useMemo((): HRCommentaryOutput | null => {
    const ftCount = staffComposition.roleData.find((r) => r.key === "fullTimeTherapist")?.count ?? 0;
    const ptCount = staffComposition.roleData.find((r) => r.key === "partTimeTherapist")?.count ?? 0;
    const therapistRatioPct =
      staffComposition.total > 0 ? ((ftCount + ptCount) / staffComposition.total) * 100 : null;

    const totalLeavers = movementQ.data?.summary?.totalLeavers ?? 0;
    const currentTotal = movementQ.data?.summary?.currentTotal ?? resolvedHeadcount;
    const annualisedTurnoverRate =
      currentTotal > 0 ? (totalLeavers / currentTotal) * (52 / 26) * 100 : null;

    const input: HRCommentaryInput = {
      groupHcPct:             groupHcPct > 0 ? groupHcPct : null,
      avgCostPerEmployee:
        isFinancialsReal && financialsQ.data!.totalHeadcount > 0
          ? financialsQ.data!.totalPayroll / financialsQ.data!.totalHeadcount
          : null,
      revenuePerEmployee:     revenuePerEmployee > 0 ? revenuePerEmployee : null,
      revpahSpa:              revpahQ.data?.byBrand?.Spa?.avgRevPAH ?? null,
      revpahAesthetics:       revpahQ.data?.byBrand?.Aesthetics?.avgRevPAH ?? null,
      revpahSlimming:         revpahQ.data?.byBrand?.Slimming?.avgRevPAH ?? null,
      netMovement:            movementQ.data?.summary?.netMovement ?? null,
      annualisedTurnoverRate,
      therapistRatioPct,
      onTimePct:              onTimePct > 0 ? onTimePct : null,
      avgActivityPct:         avgProductivity > 0 ? avgProductivity : null,
    };
    return computeHRCommentary(input);
  }, [
    groupHcPct, financialsQ.data, revenuePerEmployee, revpahQ.data,
    movementQ.data, staffComposition, onTimePct, avgProductivity,
    resolvedHeadcount, isFinancialsReal,
  ]);

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const sickLeaveCard: HRMetricData | null =
    !sickLeaveKPI.isLoading && !sickLeaveKPI.isError
      ? {
          label: "Sick Leave Days",
          value: String(sickLeaveKPI.totalDays),
          note: `${sickLeaveKPI.uniqueEmployees} employee${sickLeaveKPI.uniqueEmployees !== 1 ? "s" : ""} — approved requests in period`,
        }
      : null;

  const kpis: HRMetricData[] = [
    {
      label: "Human Capital %",
      value: groupHcPct > 0 ? `${groupHcPct}%` : "N/A",
      target: `${HC_PCT_TARGET}%`,
      targetValue: HC_PCT_TARGET,
      currentValue: groupHcPct > 0 ? groupHcPct : undefined,
      lowerIsBetter: true,
      isSample: !isFinancialsReal,
      isEstimated: isFinancialsReal && (financialsQ.data!.payrollExtrapolated || !payrollComplete),
    },
    {
      label: "Monthly Gross Payroll",
      value: isFinancialsReal
        ? formatCurrency(financialsQ.data!.totalPayroll)
        : formatCurrency(payrollData.latestGross),
      isSample: !isFinancialsReal,
      isEstimated: isFinancialsReal && (financialsQ.data!.payrollExtrapolated || !payrollComplete),
    },
    {
      label: "Avg Cost / Employee",
      value: isFinancialsReal && financialsQ.data!.totalHeadcount > 0
        ? formatCurrency(financialsQ.data!.totalPayroll / financialsQ.data!.totalHeadcount)
        : formatCurrency(payrollData.avgCostPerEmployee),
      isSample: !isFinancialsReal,
      isEstimated: isFinancialsReal && (financialsQ.data!.payrollExtrapolated || !payrollComplete),
    },
    {
      label: "Active Employees",
      value: String(isFinancialsReal ? financialsQ.data!.totalHeadcount : resolvedHeadcount),
      note: "Talexio staff only. Freelancers & contractors not in Talexio are excluded.",
    },
    ...(sickLeaveCard ? [sickLeaveCard] : []),
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
    return `${prettyMonth(month)} — ${displayHeadcount} active employees`;
  }, [month, displayHeadcount]);

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
                fetch(`/api/etl/attendance-daily?dateFrom=${fromISO}&dateTo=${toISO}`, { method: "POST" }),
                fetch("/api/etl/we360", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ start_date: fromISO, end_date: toISO }),
                }),
                fetch("/api/etl/employee-movement-weekly", { method: "POST" }),
              ]);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["talexio"] }),
                queryClient.invalidateQueries({ queryKey: ["attendance"] }),
                queryClient.invalidateQueries({ queryKey: ["hr-employee-movement"] }),
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

      {/* ── Strategic Commentary ──────────────────────────────────────── */}
      <HRCommentaryPanel
        commentary={hrCommentary}
        isLoading={talexioLoading || financialsQ.isLoading || revpahQ.isLoading}
      />

      {/* ══════════════════════════════════════════════════════════════════
          SECTION: Human Capital % by Location & Business Unit
          ══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center">
            Human Capital % by Location
            {isFinancialsReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Payroll as % of revenue — lower is more efficient
            <span className="ml-2 text-sky-600 font-medium">· Click a bar to see employee breakdown</span>
          </p>
          <ResponsiveContainer width="100%" height={hcByLocation.length * 48 + 50}>
            <BarChart
              data={hcByLocation}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
              onClick={(data) => {
                if (data?.activeLabel) {
                  const label = String(data.activeLabel);
                  const slug = locationNameToSlug(label);
                  setDrill({ label: SLUG_DISPLAY[slug] ?? label, slugs: [slug] });
                }
              }}
              style={{ cursor: "pointer" }}
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
            <span className="ml-2 text-sky-600 font-medium">· Click a bar to see employee breakdown</span>
          </p>
          <ResponsiveContainer width="100%" height={hcByBU.length * 60 + 50}>
            <BarChart
              data={hcByBU}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
              onClick={(data) => {
                if (data?.activeLabel) {
                  setDrill(businessUnitToDrill(String(data.activeLabel)));
                }
              }}
              style={{ cursor: "pointer" }}
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
          SECTION 1: Attendance snapshot chips (compact)
          ══════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap gap-3">
        {/* Clocked in today */}
        <div
          onClick={() => setClockedInModalOpen(true)}
          title="Click to see who's clocked in today"
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 shadow-sm cursor-pointer select-none hover:border-emerald-400 transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-xs text-muted-foreground">Clocked in today</span>
          <span className="text-sm font-semibold text-slate-800">
            {attendance.length} / {resolvedHeadcount}
          </span>
          {isAttendanceReal ? <LiveBadge source="talexio" /> : <SampleDataBadge />}
        </div>
        {/* Late / Left early chips — single click opens the attendance issues modal */}
        {(() => {
          const lateCount  = attendanceHistoryQ.data?.summary.total_late ?? 0;
          const earlyCount = attendanceHistoryQ.data?.summary.total_left_early ?? 0;
          const hasData    = attendanceHistoryQ.isSuccess;
          return (
            <>
              <div
                onClick={() => { setModalIssueFilter("late"); setAttendanceModalOpen(true); }}
                title="Click to see who's late this period"
                className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 shadow-sm cursor-pointer select-none transition-colors ${lateCount > 0 ? "border-red-200 hover:border-red-400" : "border-slate-200 hover:border-slate-300"}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${lateCount > 0 ? "bg-red-400" : "bg-slate-300"}`} />
                <span className="text-xs text-muted-foreground">Late this period</span>
                <span className={`text-sm font-semibold ${lateCount > 0 ? "text-red-600" : "text-slate-800"}`}>
                  {hasData ? lateCount : "—"}
                </span>
              </div>
              {(earlyCount > 0 || hasData) && (
                <div
                  onClick={() => { setModalIssueFilter("early"); setAttendanceModalOpen(true); }}
                  title="Click to see who left early this period"
                  className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 shadow-sm cursor-pointer select-none transition-colors ${earlyCount > 0 ? "border-orange-200 hover:border-orange-400" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${earlyCount > 0 ? "bg-orange-400" : "bg-slate-300"}`} />
                  <span className="text-xs text-muted-foreground">Left early</span>
                  <span className={`text-sm font-semibold ${earlyCount > 0 ? "text-orange-600" : "text-slate-800"}`}>
                    {hasData ? earlyCount : "—"}
                  </span>
                </div>
              )}
            </>
          );
        })()}
        {/* Rostered shifts */}
        {periodSummary && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
            <span className="text-xs text-muted-foreground">Rostered shifts</span>
            <span className="text-sm font-semibold text-slate-800">{periodSummary.totalRosteredShifts}</span>
          </div>
        )}
        {/* Absent */}
        {periodSummary && periodSummary.totalAbsent > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            <span className="text-xs text-muted-foreground">Absent</span>
            <span className="text-sm font-semibold text-amber-700">{periodSummary.totalAbsent}</span>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1b: Attendance History (collapsible)
          ══════════════════════════════════════════════════════════════════ */}
      <div ref={attendanceHistoryRef} className="scroll-mt-4"><Card className="p-3 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center">
            Attendance History
            {attendanceHistoryQ.isSuccess && attendanceHistoryQ.data.records.length > 0
              ? <LiveBadge source="supabase" />
              : null}
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter pills — only shown when expanded */}
            {attendanceExpanded && (["all", "late", "early"] as AttendanceFilter[]).map((f) => {
              const label = f === "all" ? "All" : f === "late" ? "Late arrivals" : "Left early";
              const count = f === "late"
                ? attendanceHistoryQ.data?.summary.total_late
                : f === "early"
                ? attendanceHistoryQ.data?.summary.total_left_early
                : attendanceHistoryQ.data?.summary.total_rostered;
              return (
                <button
                  key={f}
                  onClick={() => setAttendanceFilter(f)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    attendanceFilter === f
                      ? "bg-slate-800 text-white border-slate-800"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  }`}
                >
                  {label}
                  {count != null && (
                    <span className={`rounded-full px-1.5 py-0.5 leading-none ${
                      attendanceFilter === f ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {/* Collapse / expand toggle */}
            <button
              onClick={() => setAttendanceExpanded((v) => !v)}
              title={attendanceExpanded ? "Minimise" : "Expand"}
              className="ml-1 rounded-full w-6 h-6 flex items-center justify-center border border-slate-200 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {attendanceExpanded ? "−" : "+"}
            </button>
          </div>
        </div>

        {attendanceExpanded && attendanceHistoryQ.isSuccess && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-xs text-slate-500 bg-slate-50 rounded-full px-2 py-0.5">
              {prettyMonth(month)} — {attendanceHistoryQ.data.summary.total_rostered} rostered shifts
            </span>
            {attendanceHistoryQ.data.summary.total_absent > 0 && (
              <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                {attendanceHistoryQ.data.summary.total_absent} absent
              </span>
            )}
            {attendanceHistoryQ.data.summary.total_late > 0 && (
              <span className="bg-red-50 text-red-600 rounded-full px-2 py-0.5 font-medium">
                {attendanceHistoryQ.data.summary.total_late} late arrivals
              </span>
            )}
            {attendanceHistoryQ.data.summary.total_left_early > 0 && (
              <span className="bg-orange-50 text-orange-600 rounded-full px-2 py-0.5 font-medium">
                {attendanceHistoryQ.data.summary.total_left_early} left early
              </span>
            )}
          </div>
        )}

        {attendanceExpanded && (
          attendanceHistoryQ.isLoading ? (
            <TableSkeleton rows={8} columns={9} />
          ) : !attendanceHistoryQ.isSuccess || attendanceHistoryQ.data.records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <p className="text-sm text-muted-foreground font-medium">No attendance data yet for this period</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Hit <strong>Sync</strong> to pull roster + time logs from Talexio and build the historical record.
                The nightly cron will keep it up to date automatically after the first sync.
              </p>
            </div>
          ) : (
            <DataTable
              columns={attendanceHistoryColumns}
              data={attendanceHistoryQ.data.records as unknown as Record<string, unknown>[]}
              pageSize={15}
            />
          )
        )}
      </Card></div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2: Revenue per Available Hour — by brand
          ══════════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-1">
            Revenue per Available Treatment Hour
            {isRevPAHReal ? <LiveBadge source="supabase" /> : <SampleDataBadge />}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Revenue ÷ therapist-only scheduled hours. Brand targets are Malta-adjusted benchmarks.
        </p>

        {/* Partial-month notice */}
        {revpahQ.data?.isPartialMonth && (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-5 text-xs text-blue-700">
            <span className="shrink-0">📅</span>
            <span>
              Month in progress — hours scaled to <strong>{revpahQ.data.elapsedDays} of {revpahQ.data.totalDays} days</strong> for a fair comparison. Numbers update nightly.
            </span>
          </div>
        )}

        {/* Brand score cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {(["Spa", "Aesthetics", "Slimming"] as const).map((brand) => {
            const section    = revpahByBrand[brand];
            const locs       = section?.locations ?? [];
            const target     = section?.target ?? 35;
            const avg        = section?.avgRevPAH ?? 0;
            const onTrack    = avg >= target && avg > 0;
            const pct        = target > 0 ? Math.min((avg / target) * 100, 200) : 0;
            const therapists = locs.reduce((a, r) => a + (r.headcount ?? 0), 0);
            const brandColor = brand === "Spa" ? BRAND.spa.dark : brand === "Aesthetics" ? BRAND.aesthetics.dark : BRAND.slimming.dark;

            return (
              <div
                key={brand}
                className={`rounded-xl border p-4 ${
                  avg === 0
                    ? "border-slate-100 bg-slate-50/50"
                    : onTrack
                    ? "border-emerald-100 bg-emerald-50/30"
                    : "border-amber-100 bg-amber-50/20"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: brandColor }} />
                    <span className="text-sm font-semibold text-slate-700">{brand}</span>
                  </div>
                  {avg > 0 && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      onTrack
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : "bg-amber-50 border-amber-200 text-amber-700"
                    }`}>
                      {onTrack ? "On Track" : "Below Target"}
                    </span>
                  )}
                </div>

                <div className="flex items-end gap-1 mb-3">
                  <span className={`text-3xl font-bold leading-none ${
                    avg === 0 ? "text-slate-400" : onTrack ? "text-emerald-700" : "text-amber-700"
                  }`}>
                    {avg > 0 ? formatCurrency(avg) : "N/A"}
                  </span>
                  {avg > 0 && <span className="text-sm text-slate-400 mb-0.5">/hr</span>}
                </div>

                {/* Progress bar toward target */}
                <div className="h-1.5 rounded-full bg-slate-100 mb-2 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      onTrack ? "bg-emerald-400" : avg > 0 ? "bg-amber-400" : "bg-slate-200"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-slate-400">
                    Target: <span className="font-medium">{formatCurrency(target)}/hr</span>
                  </p>
                  {locs.length > 0 && (
                    <p className="text-[11px] text-slate-400">
                      {locs.length} location{locs.length !== 1 ? "s" : ""}
                      {therapists > 0 ? ` · ${therapists} therapists` : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Per-location breakdown — collapsible */}
        {(["Spa", "Aesthetics", "Slimming"] as const).filter((b) => (revpahByBrand[b]?.locations?.length ?? 0) > 0).map((brand) => {
          const section = revpahByBrand[brand];
          const locs    = section?.locations ?? [];
          const target  = section?.target ?? 35;

          return (
            <div key={brand} className="mb-4 last:mb-0">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{brand} — by location</p>
              <div className="space-y-1.5">
                {locs.map((row) => {
                  const barPct = target > 0 ? Math.min((row.revpah / target) * 100, 150) : 0;
                  const hit    = row.revpah >= target;
                  return (
                    <div key={row.location} className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-600 w-[130px] shrink-0 truncate">{row.location}</span>
                      <div className="flex-1 h-5 bg-slate-50 rounded overflow-hidden border border-slate-100 relative">
                        <div
                          className={`h-full rounded transition-all duration-300 ${hit ? "bg-emerald-100" : "bg-amber-100"}`}
                          style={{ width: `${barPct}%` }}
                        />
                        {/* Target line */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-amber-400"
                          style={{ left: `${Math.min((target / (target * 1.5)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-semibold w-14 text-right shrink-0 ${hit ? "text-emerald-700" : "text-amber-700"}`}>
                        {row.revpah > 0 ? `€${row.revpah.toFixed(1)}` : "—"}
                      </span>
                      {row.denomSource === "snapshot" && (
                        <span title="Denominator estimated from headcount snapshot" className="text-[10px] text-slate-400">est.</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Audit / data trail footer */}
        {isRevPAHReal && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              Denominator source: <span className="font-medium">therapist shift schedule (Talexio)</span> for months with ETL data, fallback to headcount snapshot × 8h × workdays.
              Avg RevPAH is revenue-weighted across all locations in the brand.
              {revpahQ.data?.isPartialMonth && ` Hours scaled to ${revpahQ.data.elapsedDays}/${revpahQ.data.totalDays} days elapsed.`}
            </p>
          </div>
        )}
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION: Staff Composition
          ══════════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              Staff Composition
              {headcountQ.isSuccess ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-full px-2.5 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Live from Talexio
                </span>
              ) : <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 rounded-full px-2.5 py-0.5 animate-pulse">Loading…</span>}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{staffComposition.total} active employees · by role and brand</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Donut chart — role breakdown */}
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">By Role</p>
            {staffComposition.total > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={staffComposition.roleData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%" cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {staffComposition.roleData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown) => [`${v} staff`]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center bg-slate-50 rounded-xl">
                <p className="text-sm text-slate-400">No data</p>
              </div>
            )}
          </div>

          {/* Breakdown list — role + brand */}
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Role breakdown</p>
              <div className="space-y-2">
                {staffComposition.roleData.map((r) => (
                  <div key={r.key} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
                    <span className="text-sm text-slate-700 flex-1">{r.label}</span>
                    <span className="text-sm font-bold text-slate-900 w-8 text-right">{r.count}</span>
                    <span className="text-[11px] text-slate-400 w-8 text-right">
                      {staffComposition.total > 0 ? `${Math.round((r.count / staffComposition.total) * 100)}%` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">By brand / department</p>
              <div className="space-y-2">
                {[
                  { label: "Spa Hotels",    value: staffComposition.brandCounts.spa,        color: "#10b981" },
                  { label: "Aesthetics",    value: staffComposition.brandCounts.aesthetics,  color: "#ec4899" },
                  { label: "Slimming",      value: staffComposition.brandCounts.slimming,    color: "#f97316" },
                  { label: "HQ & Support",  value: staffComposition.brandCounts.hq,          color: "#8b5cf6" },
                ].filter((b) => b.value > 0).map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                    <span className="text-sm text-slate-700 flex-1">{b.label}</span>
                    <span className="text-sm font-bold text-slate-900 w-8 text-right">{b.value}</span>
                    <span className="text-[11px] text-slate-400 w-8 text-right">
                      {staffComposition.total > 0 ? `${Math.round((b.value / staffComposition.total) * 100)}%` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION: Net Employee Movement (KPI bubbles + trend chart)
          ══════════════════════════════════════════════════════════════════ */}
      {(() => {
        const mv = movementQ.data;
        const s  = mv?.summary;
        const hasData = mv && mv.weeks.length > 0;
        return (
          <Card className="p-3 md:p-6">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  Net Employee Movement
                  {hasData ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-full px-2.5 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Live from Talexio
                    </span>
                  ) : movementQ.isLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 rounded-full px-2.5 py-0.5 animate-pulse">Loading…</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-full px-2.5 py-0.5">Backfill needed</span>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Weekly joiners &amp; leavers — last 26 weeks</p>
              </div>
            </div>

            {/* KPI chips */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              {[
                { label: "Active Employees",  value: s?.currentTotal ?? displayHeadcount, color: "text-slate-900" },
                { label: "Net Movement",       value: s ? (s.netMovement >= 0 ? `+${s.netMovement}` : String(s.netMovement)) : "—", color: s && s.netMovement > 0 ? "text-emerald-700" : s && s.netMovement < 0 ? "text-red-700" : "text-slate-900" },
                { label: "Joiners (26 wks)",   value: s ? `+${s.totalJoiners}` : "—", color: "text-emerald-700" },
                { label: "Leavers (26 wks)",   value: s ? `-${s.totalLeavers}` : "—", color: "text-red-600" },
              ].map((chip) => (
                <div key={chip.label} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{chip.label}</p>
                  <p className={`text-2xl font-bold ${chip.color}`}>{chip.value}</p>
                </div>
              ))}
            </div>

            {/* Movement chart */}
            {hasData ? (
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={mv.weeks} margin={{ top: 8, right: 50, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={25} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={35} domain={["auto", "auto"]} />
                  <Tooltip labelFormatter={(label: unknown) => `Week of ${label}`} />
                  <Legend />
                  <ReferenceLine yAxisId="left" y={0} stroke="#e2e8f0" />
                  <Bar yAxisId="left" dataKey="joiners" name="Joiners" fill="#10b981" radius={[2,2,0,0]}>
                    <LabelList dataKey="joiners" position="top" style={{ fontSize: 9, fill: "#065f46" }} formatter={(v: unknown) => v ? `+${v}` : ""} />
                  </Bar>
                  <Bar yAxisId="left" dataKey="leavers" name="Leavers" fill="#ef4444" radius={[2,2,0,0]}>
                    <LabelList dataKey="leavers" position="top" style={{ fontSize: 9, fill: "#991b1b" }} formatter={(v: unknown) => v ? `-${v}` : ""} />
                  </Bar>
                  <Line yAxisId="right" type="monotone" dataKey="total" name="Total headcount" stroke="#6366f1" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-sm font-medium text-slate-600">No movement data yet</p>
                <p className="text-xs text-slate-400 max-w-sm">
                  Run the ETL backfill to populate this chart:<br />
                  <code className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">POST /api/etl/employee-movement-weekly</code>
                </p>
              </div>
            )}
          </Card>
        );
      })()}

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
          Avg daily hours breakdown — grouped by role, sorted by hours within group (activity % = active ÷ online, matches We360) | Target: 90%
        </p>
        <ResponsiveContainer width="100%" height={sortedProductivityData.length * 40 + 80}>
          <BarChart
            data={sortedProductivityData}
            layout="vertical"
            margin={{ top: 20, right: 100, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `${v}h`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={GroupedYTick as unknown as object} />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(1)}h`, String(name)]}
              labelFormatter={(label) => {
                const item = sortedProductivityData.find((d) => d.name === label);
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

      {/* ══════════════════════════════════════════════════════════════════
          CLOCKED IN TODAY MODAL — live Talexio data
          ══════════════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════════════
          HC% DRILL-DOWN SLIDE-OVER — per-employee wage attribution
          Opened by clicking a bar in the HC% by Location OR by Business Unit
          chart. A business unit may aggregate several location slugs (e.g. Spa).
          ══════════════════════════════════════════════════════════════════ */}
      {drill !== null && (() => {
        const drillSlugs  = drill.slugs;
        const displayName = drill.label;
        const splitsData  = locationSplitsQ.data;
        // Sum a per-slug record across all slugs in this drill target.
        const sumSlugs = (rec: Record<string, number> | undefined | null) =>
          rec ? drillSlugs.reduce((s, slug) => s + (rec[slug] ?? 0), 0) : 0;

        const locTotal    = sumSlugs(splitsData?.locationTotals);
        const totalPay    = splitsData?.totalPayroll ?? 0;
        const groupPct    = totalPay > 0 ? ((locTotal / totalPay) * 100).toFixed(1) : "—";

        // Employees with any attribution to the location(s) in this drill target.
        const employees: EmployeeLocationSplit[] = (splitsData?.employees ?? []).filter(
          (e) => sumSlugs(e.wageAttribution) > 0,
        );
        // True when the selected range has no payslip yet (salaries estimated).
        const periodExtrapolated = (splitsData?.extrapolatedCount ?? 0) > 0;

        // Portal to <body>: the dashboard's <main> has a CSS transform, which
        // makes it the containing block for position:fixed — without the portal
        // the overlay would size to the full-height page and center the panel
        // far below the viewport (the "click does nothing but blur" bug).
        return createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-end"
            onClick={() => setDrill(null)}
            onKeyDown={(e) => e.key === "Escape" && setDrill(null)}
          >
            {/* Backdrop — fixed to the viewport so it covers wherever the user scrolled */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            {/* Panel — vertically centred in the current viewport, capped to its height */}
            <div
              className="relative bg-white shadow-2xl rounded-l-2xl flex flex-col overflow-hidden m-0 max-h-screen"
              style={{ width: "min(640px, 95vw)", height: "min(100vh, 720px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {displayName}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Employee wage attribution · {fromISO} → {toISO}
                  </p>
                  {periodExtrapolated && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      Salaries for this period are estimated from the most recent payslip.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setDrill(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-lg font-light mt-0.5"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {/* Summary chips */}
              {splitsData && (
                <div className="flex flex-wrap gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50 shrink-0">
                  <div className="flex flex-col items-center bg-white rounded-lg border border-slate-200 px-4 py-2 min-w-[100px]">
                    <span className="text-xs text-muted-foreground">Wage attributed</span>
                    <span className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(locTotal)}</span>
                  </div>
                  <div className="flex flex-col items-center bg-white rounded-lg border border-slate-200 px-4 py-2 min-w-[100px]">
                    <span className="text-xs text-muted-foreground">Employees</span>
                    <span className="text-sm font-bold text-slate-900 mt-0.5">{employees.length}</span>
                  </div>
                  <div className="flex flex-col items-center bg-white rounded-lg border border-slate-200 px-4 py-2 min-w-[100px]">
                    <span className="text-xs text-muted-foreground">% of group payroll</span>
                    <span className="text-sm font-bold text-slate-900 mt-0.5">{groupPct}%</span>
                  </div>
                </div>
              )}

              {/* Employee table */}
              <div className="flex-1 overflow-auto px-4 py-3">
                {locationSplitsQ.isLoading ? (
                  <TableSkeleton rows={8} columns={5} />
                ) : locationSplitsQ.isError ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                    <p className="text-sm text-red-500 font-medium">Failed to load attribution data</p>
                    <p className="text-xs text-muted-foreground">Try again or check the API endpoint.</p>
                  </div>
                ) : employees.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                    <p className="text-sm text-muted-foreground font-medium">No employee attributions found for {displayName}</p>
                    <p className="text-xs text-muted-foreground">This location may not have wage split data for {fromISO} → {toISO}.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee</th>
                        <th className="text-left py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Home</th>
                        <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gross</th>
                        <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Split%</th>
                        <th className="text-right py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attributed</th>
                        <th className="text-center py-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees
                        .sort((a, b) => sumSlugs(b.wageAttribution) - sumSlugs(a.wageAttribution))
                        .map((emp) => {
                          const splitPct  = (sumSlugs(emp.locationSplits) * 100).toFixed(1);
                          const attributed = sumSlugs(emp.wageAttribution);
                          const isCross   = !drillSlugs.includes(emp.homeLocationSlug);
                          const sourceLabel = emp.attributionSource === "cost_centre"
                            ? "Roster"
                            : emp.attributionSource === "org_unit_fallback"
                            ? "Org Unit"
                            : emp.attributionSource === "mixed"
                            ? "Mixed"
                            : "No roster";
                          const sourceCls = emp.attributionSource === "cost_centre"
                            ? "bg-emerald-50 text-emerald-700"
                            : emp.attributionSource === "org_unit_fallback"
                            ? "bg-sky-50 text-sky-700"
                            : emp.attributionSource === "mixed"
                            ? "bg-violet-50 text-violet-700"
                            : "bg-slate-50 text-slate-500";
                          return (
                            <tr key={emp.talexioId} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-2 font-medium text-slate-900">
                                {emp.employeeName}
                                {emp.isExtrapolated && (
                                  <span className="ml-1.5 inline-flex items-center rounded-sm bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700">est.</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2">
                                {isCross ? (
                                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 text-xs px-2 py-0.5 font-medium">
                                    {SLUG_DISPLAY[emp.homeLocationSlug] ?? emp.homeLocation}
                                  </span>
                                ) : (
                                  <span className="text-slate-500 text-xs">Home</span>
                                )}
                              </td>
                              <td className="py-2.5 px-2 text-right text-slate-700">{formatCurrency(emp.grossWage)}</td>
                              <td className="py-2.5 px-2 text-right font-semibold text-slate-900">{splitPct}%</td>
                              <td className="py-2.5 px-2 text-right font-bold text-slate-900">{formatCurrency(attributed)}</td>
                              <td className="py-2.5 px-2 text-center">
                                <span className={`inline-flex items-center rounded-full text-xs px-2 py-0.5 font-medium ${sourceCls}`}>
                                  {sourceLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    {employees.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 bg-slate-50">
                          <td colSpan={4} className="py-2.5 px-2 text-xs font-semibold text-slate-700 uppercase tracking-wide">Total</td>
                          <td className="py-2.5 px-2 text-right font-bold text-slate-900">{formatCurrency(locTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>

              {/* Footer link */}
              <div className="px-6 py-3 border-t border-slate-100 shrink-0 flex items-center justify-between bg-slate-50">
                <span className="text-xs text-muted-foreground">
                  Attribution method: roster cost-centre where available, org-unit fallback otherwise.
                </span>
                <a
                  href={`/hr/location-attribution?from=${fromISO}&to=${toISO}`}
                  className="text-xs font-medium text-sky-600 hover:text-sky-800 hover:underline transition-colors whitespace-nowrap ml-4"
                >
                  View full attribution page →
                </a>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}

      {clockedInModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-12 pb-8 px-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setClockedInModalOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setClockedInModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden"
            style={{ maxHeight: "calc(100vh - 6rem)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Clocked In Today</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live from Talexio · {attendance.length} of {resolvedHeadcount} employees
                  {isAttendanceReal ? "" : " (sample data)"}
                </p>
              </div>
              <button
                onClick={() => setClockedInModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-lg font-light"
              >
                ×
              </button>
            </div>
            <div className="overflow-auto flex-1 p-4">
              <DataTable
                columns={attendanceColumns}
                data={attendance as unknown as Record<string, unknown>[]}
                pageSize={30}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ══════════════════════════════════════════════════════════════════
          ATTENDANCE ISSUES MODAL (late arrivals + early departures)
          Opened by clicking either the Late or Left Early chip above.
          ══════════════════════════════════════════════════════════════════ */}
      {attendanceModalOpen && (() => {
        const isLateModal  = modalIssueFilter === "late";
        const modalQ       = isLateModal ? attendanceLateQ : attendanceEarlyQ;
        const modalTitle   = isLateModal ? "Late Arrivals" : "Left Early";
        const modalCount   = isLateModal
          ? modalQ.data?.summary.total_late
          : modalQ.data?.summary.total_left_early;
        const badgeCls     = isLateModal
          ? "bg-red-50 text-red-600"
          : "bg-orange-50 text-orange-600";
        return createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-12 pb-8 px-4 bg-black/50 backdrop-blur-sm"
            onClick={() => setAttendanceModalOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setAttendanceModalOpen(false)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden"
              style={{ maxHeight: "calc(100vh - 6rem)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{modalTitle}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fromISO} → {toISO} · from Supabase
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {modalQ.isSuccess && modalCount != null && (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeCls}`}>
                      {modalCount} {isLateModal ? "late" : "left early"}
                    </span>
                  )}
                  <button
                    onClick={() => setAttendanceModalOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors text-lg font-light"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="overflow-auto flex-1 p-4">
                {modalQ.isLoading ? (
                  <TableSkeleton rows={10} columns={9} />
                ) : !modalQ.isSuccess || modalQ.data.records.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                    <p className="text-sm text-muted-foreground font-medium">No {isLateModal ? "late arrivals" : "early departures"} for this period</p>
                  </div>
                ) : (
                  <DataTable
                    columns={attendanceHistoryColumns}
                    data={modalQ.data.records as unknown as Record<string, unknown>[]}
                    pageSize={20}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STRATEGIC COMMENTARY PANEL
// ════════════════════════════════════════════════════════════════════════════

function HRCommentaryPanel({
  commentary,
  isLoading,
}: {
  commentary: HRCommentaryOutput | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm p-4 md:p-5">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-amber-200 rounded w-40" />
          <div className="h-3 bg-amber-100 rounded w-full" />
          <div className="h-3 bg-amber-100 rounded w-4/5" />
        </div>
      </Card>
    );
  }

  if (!commentary) return null;

  const { verdict, wins, focusAreas } = commentary;

  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <div className="p-4 md:p-5">
        <p className="text-base font-semibold text-amber-900 mb-0.5">Workforce Snapshot</p>
        <p className="text-xs text-amber-700 mb-3">{verdict}</p>
        {(wins.length > 0 || focusAreas.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-amber-200">
            {wins.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  ✅ Working well
                </p>
                <ul className="space-y-2">
                  {wins.map((w) => (
                    <li key={w.key} className="text-sm leading-snug text-amber-900">
                      {w.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {focusAreas.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  🎯 Focus areas
                </p>
                <ul className="space-y-2">
                  {focusAreas.map((f) => (
                    <li key={f.key} className="text-sm leading-snug text-amber-900">
                      {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
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
