"use client";

import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
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

// ============================================================
// CONSTANTS
// ============================================================

const REVPAH_TARGET = 35;
const HC_PCT_TARGET = 35;

const PIE_COLORS = [
  chartColors.spa, chartColors.aesthetics, chartColors.slimming,
  "#8B5CF6", "#EC4899", "#06B6D4", "#F59E0B", "#10B981",
];

const PROD_COLORS = {
  productive: "#22C55E",
  neutral: "#9CA3AF",
  unproductive: "#EF4444",
  idle: "#F59E0B",
};

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// DUMMY DATA
// ============================================================

const HEADCOUNT = {
  totalActive: 75,
  totalAll: 82,
  terminated: 7,
  turnoverRate: 8.5,
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

const ATTENDANCE_LOGS = [
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
  { name: "Anna Vella", clockIn: "08:10", clockOut: "16:15", hoursWorked: "8.1h", status: "Completed" },
  { name: "David Camilleri", clockIn: "08:20", clockOut: null, hoursWorked: "4.9h", status: "Active" },
  { name: "Carmen Galea", clockIn: "08:30", clockOut: "16:35", hoursWorked: "8.1h", status: "Completed" },
  { name: "Pierre Zammit", clockIn: "08:45", clockOut: null, hoursWorked: "4.4h", status: "Active" },
  { name: "Jade Cassar", clockIn: "09:00", clockOut: "17:05", hoursWorked: "8.1h", status: "Completed" },
  { name: "Liam Attard", clockIn: "09:05", clockOut: null, hoursWorked: "4.1h", status: "Active" },
  { name: "Sophie Grech", clockIn: "09:10", clockOut: null, hoursWorked: "4.0h", status: "Active" },
  { name: "Adeel Malik", clockIn: "09:15", clockOut: null, hoursWorked: "4.0h", status: "Active" },
  { name: "Robert Pace", clockIn: "09:20", clockOut: null, hoursWorked: "3.9h", status: "Active" },
  { name: "Nina Cutajar", clockIn: "09:30", clockOut: null, hoursWorked: "3.7h", status: "Active" },
  { name: "Jake Tanti", clockIn: "09:45", clockOut: null, hoursWorked: "3.4h", status: "Active" },
];

const LATE_EMPLOYEES = [
  { name: "Jake Tanti", clockIn: "09:45", minutesLate: 30 },
  { name: "Nina Cutajar", clockIn: "09:30", minutesLate: 15 },
  { name: "Robert Pace", clockIn: "09:20", minutesLate: 5 },
];

const NOT_CLOCKED_IN = [
  "Christian Bugeja", "Doris Said", "Emmanuel Grima",
  "Francesca Brincat", "George Axiak", "Helene Busuttil",
  "Ivan Fenech", "Karen Mallia", "Lorenzo Schembri",
  "Martha Xuereb", "Noel Azzopardi", "Pauline Scerri",
];

const LEAVE_BALANCES = [
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
  { name: "Julie Rizzo", vacationHrs: 160, sickHrs: 8, totalTypes: 3, totalHrs: 192 },
  { name: "Nicci Debono", vacationHrs: 160, sickHrs: 8, totalTypes: 4, totalHrs: 200 },
  { name: "Abid Khan", vacationHrs: 152, sickHrs: 0, totalTypes: 3, totalHrs: 176 },
  { name: "Josef Micallef", vacationHrs: 160, sickHrs: 0, totalTypes: 3, totalHrs: 184 },
  { name: "Sophie Grech", vacationHrs: 140, sickHrs: 0, totalTypes: 2, totalHrs: 164 },
];

const SICK_LEAVE_TOP = [
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

const PAYROLL = {
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

const REVPAH_BY_LOCATION = [
  { location: "Hugos", revpah: 48.20, revenue: 52400 },
  { location: "Hyatt", revpah: 43.80, revenue: 41200 },
  { location: "InterContinental", revpah: 39.50, revenue: 58700 },
  { location: "Odycy", revpah: 37.10, revenue: 29800 },
  { location: "Excelsior", revpah: 35.60, revenue: 22400 },
  { location: "Ramla Bay", revpah: 32.40, revenue: 31600 },
  { location: "Labranda", revpah: 29.80, revenue: 27500 },
  { location: "Novotel", revpah: 26.50, revenue: 21900 },
];

const TOTAL_REVENUE = 285500;

const HC_BY_LOCATION = [
  { name: "Novotel", hcPct: 28.5, payroll: 11900, revenue: 41760, headcount: 7 },
  { name: "Excelsior", hcPct: 30.2, payroll: 9350, revenue: 30960, headcount: 6 },
  { name: "Labranda", hcPct: 31.4, payroll: 14400, revenue: 45860, headcount: 8 },
  { name: "InterContinental", hcPct: 32.1, payroll: 28500, revenue: 88786, headcount: 15 },
  { name: "Odycy", hcPct: 33.8, payroll: 13600, revenue: 40236, headcount: 8 },
  { name: "Ramla Bay", hcPct: 34.9, payroll: 15750, revenue: 45129, headcount: 9 },
  { name: "Hugos", hcPct: 36.5, payroll: 22800, revenue: 62466, headcount: 12 },
  { name: "Hyatt", hcPct: 38.2, payroll: 18500, revenue: 48429, headcount: 10 },
];

const HC_BY_BU = [
  { name: "Spa", hcPct: 33.4, payroll: 97056, revenue: 290588 },
  { name: "Aesthetics", hcPct: 30.8, payroll: 24264, revenue: 78779 },
  { name: "Slimming", hcPct: 36.2, payroll: 13480, revenue: 37238 },
];

const GROUP_HC_PCT = 33.1;

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

// ============================================================
// TABLE COLUMNS
// ============================================================

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

// ============================================================
// MAIN CONTENT
// ============================================================

function HRContent() {
  const avgRevPAH = Math.round(
    REVPAH_BY_LOCATION.reduce((s, r) => s + r.revpah, 0) / REVPAH_BY_LOCATION.length * 100
  ) / 100;

  const avgProductivity = Math.round(
    PRODUCTIVITY_DATA.reduce((s, p) => s + p.productivePct, 0) / PRODUCTIVITY_DATA.length
  );

  const revenuePerEmployee = Math.round(TOTAL_REVENUE / HEADCOUNT.totalActive);

  const onTimePct = Math.round(
    ((ATTENDANCE_LOGS.length - LATE_EMPLOYEES.length) / ATTENDANCE_LOGS.length) * 100
  );

  const kpis: KPIData[] = [
    {
      label: "Human Capital %",
      value: `${GROUP_HC_PCT}%`,
      target: `${HC_PCT_TARGET}%`,
      targetValue: HC_PCT_TARGET,
      currentValue: GROUP_HC_PCT,
    },
    { label: "Monthly Gross Payroll", value: formatCurrency(PAYROLL.latestGross) },
    { label: "Avg Cost / Employee", value: formatCurrency(PAYROLL.avgCostPerEmployee) },
    { label: "Active Employees", value: String(HEADCOUNT.totalActive) },
    {
      label: "On-Time %",
      value: `${onTimePct}%`,
      target: "90%",
      targetValue: 90,
      currentValue: onTimePct,
    },
    { label: "Sick Leave %", value: "4.8%" },
    {
      label: "Avg Productivity",
      value: `${avgProductivity}%`,
      target: "80%",
      targetValue: 80,
      currentValue: avgProductivity,
    },
    {
      label: "Avg RevPAH",
      value: formatCurrency(avgRevPAH),
      target: `${formatCurrency(REVPAH_TARGET)}/hr`,
      targetValue: REVPAH_TARGET,
      currentValue: avgRevPAH,
    },
    { label: "Turnover Rate", value: `${HEADCOUNT.turnoverRate}%` },
    { label: "Revenue / Employee", value: formatCurrency(revenuePerEmployee) },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Human Resources</h1>
          <p className="text-sm text-muted-foreground mt-1">
            March 2026 — 75 active employees across 8 locations
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-full px-3 py-1 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live from Talexio
        </span>
      </div>

      <KPICardRow kpis={kpis} />

      {/* ══════════════════════════════════════════════════════════════
          SECTION 1: Human Capital %
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Human Capital % by Location</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Payroll as % of revenue — lower is more efficient
          </p>
          <ResponsiveContainer width="100%" height={HC_BY_LOCATION.length * 48 + 50}>
            <BarChart
              data={HC_BY_LOCATION}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v, name) => [`${v}%`, String(name)]}
                labelFormatter={(label) => {
                  const item = HC_BY_LOCATION.find((d) => d.name === label);
                  return item
                    ? `${label} — Payroll: ${formatCurrency(item.payroll)} | Revenue: ${formatCurrency(item.revenue)}`
                    : String(label);
                }}
              />
              <ReferenceLine
                x={HC_PCT_TARGET}
                stroke={chartColors.target}
                strokeDasharray="3 3"
                label={{ value: `Target ${HC_PCT_TARGET}%`, position: "top", fill: chartColors.target, fontSize: 11 }}
              />
              <Bar dataKey="hcPct" name="HC %" barSize={28}>
                {HC_BY_LOCATION.map((entry) => (
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
          <h2 className="text-lg font-semibold text-foreground mb-1">Human Capital % by Business Unit</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Group HC%: {GROUP_HC_PCT}% — Payroll / Revenue by brand
          </p>
          <ResponsiveContainer width="100%" height={HC_BY_BU.length * 60 + 50}>
            <BarChart
              data={HC_BY_BU}
              layout="vertical"
              margin={{ top: 5, right: 80, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(v, name) => [`${v}%`, String(name)]}
                labelFormatter={(label) => {
                  const item = HC_BY_BU.find((d) => d.name === label);
                  return item
                    ? `${label} — Payroll: ${formatCurrency(item.payroll)} | Revenue: ${formatCurrency(item.revenue)}`
                    : String(label);
                }}
              />
              <ReferenceLine x={HC_PCT_TARGET} stroke={chartColors.target} strokeDasharray="3 3" />
              <Bar dataKey="hcPct" name="HC %">
                {HC_BY_BU.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={[chartColors.spa, chartColors.aesthetics, chartColors.slimming][i]}
                  />
                ))}
                <LabelList
                  dataKey="hcPct"
                  content={(props) => {
                    const { x, width, y, height, index } = props as Record<string, unknown>;
                    const entry = HC_BY_BU[Number(index)];
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

      {/* ══════════════════════════════════════════════════════════════
          SECTION 2: RevPAH by Location
          ══════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Revenue per Available Hour by Location</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Utilization proxy — target {formatCurrency(REVPAH_TARGET)}/hr
        </p>
        <div className="h-[220px] md:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={REVPAH_BY_LOCATION} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
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
                {REVPAH_BY_LOCATION.map((entry) => (
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

      {/* ══════════════════════════════════════════════════════════════
          SECTION 3: Attendance Today + Late Arrivals
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Attendance Today
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({ATTENDANCE_LOGS.length} of {HEADCOUNT.totalActive} clocked in)
            </span>
          </h2>
          <DataTable
            columns={attendanceColumns}
            data={ATTENDANCE_LOGS as unknown as Record<string, unknown>[]}
            pageSize={8}
          />
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Late Arrivals
            <span className="ml-2 text-sm font-normal text-red-500">
              ({LATE_EMPLOYEES.length} late)
            </span>
          </h2>
          <DataTable
            columns={latenessColumns}
            data={LATE_EMPLOYEES as unknown as Record<string, unknown>[]}
            pageSize={8}
          />
        </Card>
      </div>

      {/* Not Clocked In */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Not Clocked In Today
          <span className="ml-2 text-sm font-normal text-amber-600">
            ({NOT_CLOCKED_IN.length})
          </span>
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {NOT_CLOCKED_IN.map((name) => (
            <div key={name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              {name}
            </div>
          ))}
        </div>
      </Card>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 4: Headcount Breakdown
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Headcount by Position</h2>
          <ResponsiveContainer width="100%" height={HEADCOUNT.byPosition.length * 36 + 50}>
            <BarChart
              data={HEADCOUNT.byPosition}
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
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Headcount by Location</h2>
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={HEADCOUNT.byOrgUnit}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={3}
                dataKey="count"
                nameKey="name"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {HEADCOUNT.byOrgUnit.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 5: Leave Balances + Sick Leave
          ══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Leave Balances — 2026
          </h2>
          <DataTable
            columns={leaveBalanceColumns}
            data={LEAVE_BALANCES as unknown as Record<string, unknown>[]}
            pageSize={10}
          />
        </Card>

        <Card className="p-3 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Sick Leave — Top Users
          </h2>
          <DataTable
            columns={sickLeaveColumns}
            data={SICK_LEAVE_TOP as unknown as Record<string, unknown>[]}
            pageSize={10}
          />
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          SECTION 6: Productivity Leaderboard
          ══════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Productivity Leaderboard</h2>
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
                return item ? `${label} — ${item.productivePct}% productive (${item.totalHrs}h total)` : String(label);
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

      {/* ══════════════════════════════════════════════════════════════
          SECTION 7: Payroll by Location
          ══════════════════════════════════════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Payroll by Location</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Gross payroll — March 2026
        </p>
        <ResponsiveContainer width="100%" height={PAYROLL.locationData.length * 40 + 50}>
          <BarChart
            data={PAYROLL.locationData}
            layout="vertical"
            margin={{ top: 5, right: 100, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => `€${(v / 1000).toFixed(1)}K`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Bar dataKey="gross" name="Gross Pay" fill={chartColors.spa} barSize={28} radius={[0, 4, 4, 0]}>
              <LabelList
                dataKey="gross"
                content={(props) => {
                  const { x, width, y, height, index } = props as Record<string, unknown>;
                  const entry = PAYROLL.locationData[Number(index)];
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
      </Card>

      <CIChat />
    </>
  );
}

// ============================================================
// PAGE EXPORT
// ============================================================

export default function HRPage() {
  return (
    <DashboardShell>
      {() => <HRContent />}
    </DashboardShell>
  );
}
