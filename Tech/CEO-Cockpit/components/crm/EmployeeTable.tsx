"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/dashboard/DataTable";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import {
  chartColors,
  chartDefaults,
  formatCurrency,
  formatPercent,
} from "@/lib/charts/config";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, addDays } from "date-fns";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadge(
  value: number,
  good: boolean,
): React.ReactNode {
  const color = good
    ? "bg-emerald-100 text-emerald-800"
    : "bg-red-100 text-red-800";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${color}`}
    >
      {formatPercent(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Dummy data                                                         */
/* ------------------------------------------------------------------ */

const BOOKING_CONVERSION_TARGET = 0.20; // 20% lead-to-booking conversion

interface AggregatedRep {
  name: string;
  brand: string;
  team_type: string;
  total_sales: number;
  dials: number;
  bookings: number;
  leads_assigned: number;
  booking_target: number;
  conversion_rate_pct: number;
  deposit_pct: number;
  missed_pct: number;
  total_tasks: number;
  avg_tasks_per_day: number;
}

const DUMMY_EMPLOYEES: AggregatedRep[] = [
  { name: "Maria Vella", brand: "aesthetics", team_type: "SDR", total_sales: 12480, dials: 342, bookings: 42, leads_assigned: 120, booking_target: 24, conversion_rate_pct: 34.2, deposit_pct: 78.5, missed_pct: 8.2, total_tasks: 312, avg_tasks_per_day: 22.3 },
  { name: "Katrina Borg", brand: "slimming", team_type: "SDR", total_sales: 10950, dials: 298, bookings: 38, leads_assigned: 110, booking_target: 22, conversion_rate_pct: 31.5, deposit_pct: 72.1, missed_pct: 10.4, total_tasks: 274, avg_tasks_per_day: 19.6 },
  { name: "Sarah Camilleri", brand: "spa", team_type: "Chat", total_sales: 9870, dials: 0, bookings: 35, leads_assigned: 100, booking_target: 20, conversion_rate_pct: 28.9, deposit_pct: 75.3, missed_pct: 5.1, total_tasks: 245, avg_tasks_per_day: 17.5 },
  { name: "Anna Grech", brand: "aesthetics", team_type: "SDR", total_sales: 8640, dials: 267, bookings: 31, leads_assigned: 105, booking_target: 21, conversion_rate_pct: 26.1, deposit_pct: 69.8, missed_pct: 11.7, total_tasks: 238, avg_tasks_per_day: 17.0 },
  { name: "Elena Farrugia", brand: "slimming", team_type: "Chat", total_sales: 7820, dials: 0, bookings: 28, leads_assigned: 95, booking_target: 19, conversion_rate_pct: 24.8, deposit_pct: 81.2, missed_pct: 6.3, total_tasks: 196, avg_tasks_per_day: 14.0 },
  { name: "Julia Zammit", brand: "spa", team_type: "SDR", total_sales: 6950, dials: 215, bookings: 25, leads_assigned: 90, booking_target: 18, conversion_rate_pct: 22.3, deposit_pct: 66.4, missed_pct: 14.8, total_tasks: 203, avg_tasks_per_day: 14.5 },
  { name: "Lisa Galea", brand: "aesthetics", team_type: "Chat", total_sales: 6210, dials: 0, bookings: 22, leads_assigned: 85, booking_target: 17, conversion_rate_pct: 20.7, deposit_pct: 73.6, missed_pct: 7.5, total_tasks: 182, avg_tasks_per_day: 13.0 },
  { name: "Diane Attard", brand: "slimming", team_type: "SDR", total_sales: 5480, dials: 189, bookings: 19, leads_assigned: 80, booking_target: 16, conversion_rate_pct: 19.2, deposit_pct: 64.1, missed_pct: 16.2, total_tasks: 168, avg_tasks_per_day: 12.0 },
  { name: "Nicole Mifsud", brand: "spa", team_type: "Chat", total_sales: 4720, dials: 0, bookings: 17, leads_assigned: 75, booking_target: 15, conversion_rate_pct: 17.4, deposit_pct: 71.9, missed_pct: 9.8, total_tasks: 154, avg_tasks_per_day: 11.0 },
  { name: "Claire Spiteri", brand: "aesthetics", team_type: "SDR", total_sales: 3890, dials: 156, bookings: 14, leads_assigned: 70, booking_target: 14, conversion_rate_pct: 15.8, deposit_pct: 58.3, missed_pct: 18.5, total_tasks: 126, avg_tasks_per_day: 9.0 },
];

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

function generateDummyDailyData(name: string): { date: string; Sales: number; Bookings: number; "Conv %": number; "Deposit %": number; "Missed %": number }[] {
  const baseDate = new Date("2026-04-05");
  const emp = DUMMY_EMPLOYEES.find((e) => e.name === name);
  if (!emp) return [];
  const dailyAvg = emp.total_sales / 14;
  return Array.from({ length: 14 }, (_, i) => ({
    date: format(addDays(baseDate, i), "MMM dd"),
    Sales: Math.round(dailyAvg * (0.6 + Math.random() * 0.8)),
    Bookings: Math.round((emp.bookings / 14) * (0.5 + Math.random())),
    "Conv %": emp.conversion_rate_pct * (0.8 + Math.random() * 0.4),
    "Deposit %": emp.deposit_pct * (0.85 + Math.random() * 0.3),
    "Missed %": emp.missed_pct * (0.7 + Math.random() * 0.6),
  }));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EmployeeTable({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const { agents, isLoading } = useCrmAgents(dateFrom, dateTo);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  const realTableData: AggregatedRep[] = agents.map((a) => {
    const meta = AGENT_META_BY_SLUG[a.slug];
    const brand = meta?.brand.toLowerCase() ?? "spa";
    const teamType = meta?.role ?? "-";
    const leadsAssigned = a.totals.total_messages;
    const bookingTarget = Math.max(Math.round(leadsAssigned * BOOKING_CONVERSION_TARGET), 1);
    const activeDays = a.totals.active_days || 1;
    return {
      name: a.name,
      brand,
      team_type: teamType,
      total_sales: a.totals.total_sales,
      dials: a.totals.total_messages,
      bookings: a.totals.total_bookings,
      leads_assigned: leadsAssigned,
      booking_target: bookingTarget,
      conversion_rate_pct: a.totals.avg_conversion_rate,
      deposit_pct: a.totals.avg_deposit_pct,
      missed_pct: 0,
      total_tasks: a.totals.total_messages,
      avg_tasks_per_day: a.totals.total_messages / activeDays,
    };
  });

  const hasRealData = realTableData.length > 0;
  const tableData = hasRealData
    ? realTableData
    : brandFilter
      ? DUMMY_EMPLOYEES.filter((e) => e.brand === brandFilter)
      : DUMMY_EMPLOYEES;

  const columns = [
    { key: "name", label: "Name" },
    {
      key: "brand",
      label: "Brand",
      render: (v: unknown) => (
        <span className="capitalize">{String(v)}</span>
      ),
    },
    { key: "team_type", label: "Role" },
    {
      key: "total_sales",
      label: "Total Sales",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => formatCurrency(Number(v) || 0),
    },
    {
      key: "dials",
      label: "Dials",
      align: "right" as const,
      sortable: true,
    },
    {
      key: "bookings",
      label: "Bookings",
      align: "right" as const,
      sortable: true,
      render: (v: unknown, row: Record<string, unknown>) => {
        const bookings = Number(v) || 0;
        const target = Number(row.booking_target) || 0;
        const hitTarget = bookings >= target;
        const nearTarget = bookings >= target * 0.8;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={`font-bold ${hitTarget ? "text-emerald-700" : nearTarget ? "text-amber-600" : "text-red-600"}`}>
              {bookings}
            </span>
            <span className="text-[10px] text-muted-foreground">/ {target}</span>
          </span>
        );
      },
    },
    {
      key: "conversion_rate_pct",
      label: "Conv %",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) =>
        statusBadge(Number(v) || 0, (Number(v) || 0) >= 20),
    },
    {
      key: "deposit_pct",
      label: "Deposit %",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) =>
        statusBadge(Number(v) || 0, (Number(v) || 0) >= 70),
    },
    {
      key: "missed_pct",
      label: "Missed %",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) =>
        statusBadge(Number(v) || 0, (Number(v) || 0) <= 12),
    },
    {
      key: "total_tasks",
      label: "Tasks",
      align: "right" as const,
      sortable: true,
    },
    {
      key: "avg_tasks_per_day",
      label: "Tasks/Day",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = Number(v) || 0;
        const color = val >= 20 ? "text-red-600 font-bold" : val >= 15 ? "text-amber-600 font-semibold" : "text-foreground font-semibold";
        return <span className={color}>{val.toFixed(1)}</span>;
      },
    },
  ];

  11  // --- Agent detail chart ---
  const selectedAgentRows = selectedAgent
    ? agents.find((a) => a.name === selectedAgent)?.rows ?? []
    : [];
  const agentDailyData = selectedAgent
    ? hasRealData
      ? [...selectedAgentRows]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          date: format(new Date(r.date), "MMM dd"),
          Sales: r.total_sales ?? 0,
          Bookings: r.total_booked ?? 0,
          "Conv %": r.conversion_rate_pct ?? 0,
          "Deposit %": r.deposit_pct ?? 0,
          "Missed %": 0,
        }))
      : generateDummyDailyData(selectedAgent)
    : [];

  // --- CRM Tasks by Brand ---
  const brandTaskStats = (() => {
    const brands = ["spa", "aesthetics", "slimming"];
    return brands
      .filter((b) => !brandFilter || b === brandFilter)
      .map((brand) => {
        const reps = tableData.filter((r) => r.brand === brand);
        const totalTasks = reps.reduce((s, r) => s + r.total_tasks, 0);
        const totalReps = reps.length;
        const avgTasksPerDay = totalReps > 0
          ? reps.reduce((s, r) => s + r.avg_tasks_per_day, 0) / totalReps
          : 0;
        return { brand, label: BRAND_LABELS[brand] ?? brand, totalTasks, totalReps, avgTasksPerDay };
      });
  })();

  const companyTotalTasks = brandTaskStats.reduce((s, b) => s + b.totalTasks, 0);
  const companyAvgTasksPerDay = brandTaskStats.length > 0
    ? brandTaskStats.reduce((s, b) => s + b.avgTasksPerDay * b.totalReps, 0) / tableData.length
    : 0;

  return (
    <div className="space-y-6 relative">
      {!hasRealData && (
        <div className="absolute top-0 right-0 text-[10px] uppercase tracking-wider text-text-secondary bg-gray-100 px-1.5 py-0.5 rounded z-10">
          sample data
        </div>
      )}

      {/* CRM Tasks by Brand */}
      <Card className="p-4 md:p-6">
        <h3 className="text-base font-semibold text-foreground mb-1">CRM Task Volume by Brand</h3>
        <p className="text-xs text-muted-foreground mb-4">Total tasks generated and average daily workload per rep — use this to balance CRM rep distribution across brands</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {brandTaskStats.map((b) => {
            const loadLevel = b.avgTasksPerDay >= 20 ? "High" : b.avgTasksPerDay >= 15 ? "Medium" : "Low";
            const loadColor = loadLevel === "High" ? "text-red-600" : loadLevel === "Medium" ? "text-amber-600" : "text-emerald-600";
            const loadBg = loadLevel === "High" ? "bg-red-50 border-red-200" : loadLevel === "Medium" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200";
            return (
              <div key={b.brand} className="rounded-lg border p-4" style={{ borderLeftWidth: 4, borderLeftColor: chartColors[b.brand as keyof typeof chartColors] ?? "#888" }}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{b.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{b.totalTasks}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{b.totalReps} rep{b.totalReps !== 1 ? "s" : ""} assigned</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Avg/day/rep</span>
                  <span className={`text-sm font-bold ${loadColor}`}>{b.avgTasksPerDay.toFixed(1)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className={`inline-block text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${loadBg}`}>{loadLevel} Load</span>
                </div>
                {/* Recommended reps */}
                {(() => {
                  const OPTIMAL_TASKS_PER_DAY = 15; // outbound calling sweet spot
                  const totalDailyTasks = b.avgTasksPerDay * b.totalReps;
                  const recommendedReps = Math.ceil(totalDailyTasks / OPTIMAL_TASKS_PER_DAY);
                  const delta = recommendedReps - b.totalReps;
                  return (
                    <div className="mt-2 pt-2 border-t border-dashed">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">Recommended</span>
                        <span className={`text-xs font-bold ${delta > 0 ? "text-red-600" : delta < 0 ? "text-emerald-600" : "text-foreground"}`}>
                          {recommendedReps} rep{recommendedReps !== 1 ? "s" : ""}
                          {delta > 0 && ` (+${delta})`}
                          {delta < 0 && ` (${delta})`}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* Company total */}
          <div className="rounded-lg border-2 border-gray-300 p-4 bg-gray-50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">All Brands</p>
            <p className="text-2xl font-bold text-foreground mt-1">{companyTotalTasks}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{tableData.length} total reps</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Avg/day/rep</span>
              <span className="text-sm font-bold text-foreground">{companyAvgTasksPerDay.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Outbound Calling Capacity Benchmarks */}
        <div className="mt-5 p-4 bg-gray-50 rounded-lg border">
          <h4 className="text-sm font-semibold text-foreground mb-2">Staffing Guidelines — Outbound Calling Benchmarks</h4>
          <p className="text-xs text-muted-foreground mb-3">
            Based on industry benchmarks for outbound SDR teams (BRIDGE Group, Salesforce, AA-ISP). Tasks include follow-up calls, lead qualification, appointment setting, and re-engagement.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div className="p-3 rounded-lg border bg-white text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Optimal Daily Tasks</p>
              <p className="text-xl font-black text-foreground">12–18</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">tasks per rep per day</p>
            </div>
            <div className="p-3 rounded-lg border bg-white text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Dial-to-Connect Rate</p>
              <p className="text-xl font-black text-foreground">15–25%</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">avg for outbound calling</p>
            </div>
            <div className="p-3 rounded-lg border bg-white text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Avg Call Duration</p>
              <p className="text-xl font-black text-foreground">4–6 min</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">connected calls only</p>
            </div>
            <div className="p-3 rounded-lg border bg-white text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Productive Hours</p>
              <p className="text-xl font-black text-foreground">5–6 hrs</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">of 8-hour shift</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Tasks/Day/Rep</th>
                  <th className="text-center py-1.5 px-2 font-semibold text-muted-foreground">Load Level</th>
                  <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Guidance</th>
                  <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground">Impact</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { range: "< 10", level: "Under-utilized", levelColor: "bg-blue-50 text-blue-700 border-blue-200", guidance: "Rep has capacity — consider assigning cross-brand tasks or additional responsibilities", impact: "Idle time reduces ROI on headcount" },
                  { range: "10–15", level: "Optimal", levelColor: "bg-emerald-50 text-emerald-700 border-emerald-200", guidance: "Sweet spot for quality outbound calls with proper CRM notes, follow-ups, and lead nurturing", impact: "Highest conversion rates; reps have time for personalized engagement" },
                  { range: "15–20", level: "Medium", levelColor: "bg-amber-50 text-amber-700 border-amber-200", guidance: "Manageable but quality may slip — monitor conversion rates and call quality scores", impact: "Call duration shortens; missed follow-ups increase by ~20%" },
                  { range: "20–25", level: "High", levelColor: "bg-orange-50 text-orange-700 border-orange-200", guidance: "Overloaded — assign an additional rep or redistribute tasks across brands", impact: "Conversion drops 30–40%; burnout risk; CRM hygiene deteriorates" },
                  { range: "25+", level: "Critical", levelColor: "bg-red-50 text-red-700 border-red-200", guidance: "Unsustainable — leads are being missed. Hire or reassign immediately", impact: "Speed-to-lead degrades; 50%+ of leads go cold before contact" },
                ].map((row) => (
                  <tr key={row.range} className="border-b border-gray-100">
                    <td className="py-2 px-2 font-bold text-foreground">{row.range}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold ${row.levelColor}`}>{row.level}</span>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground">{row.guidance}</td>
                    <td className="py-2 px-2 text-muted-foreground">{row.impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 italic">
            Formula: Recommended Reps = Total Daily Tasks ÷ 15 (optimal). Each outbound task includes dialing, CRM logging, and follow-up scheduling (~20min total cycle time). Sources: BRIDGE Group SDR Metrics Report, AA-ISP Inside Sales Benchmarks, Salesforce State of Sales.
          </p>
        </div>
      </Card>

      <Card className="p-3 md:p-6">
        <DataTable
          columns={columns}
          data={tableData as unknown as Record<string, unknown>[]}
          onRowClick={(row) => {
            const name = row.name as string;
            setSelectedAgent(selectedAgent === name ? null : name);
          }}
        />
      </Card>

      {/* Agent Detail */}
      {selectedAgent !== null && agentDailyData.length > 0 && (
        <Card className="p-3 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              {selectedAgent} — Daily Breakdown
            </h3>
            <button
              className="text-sm text-text-secondary hover:text-foreground"
              onClick={() => setSelectedAgent(null)}
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales + Bookings bar chart */}
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">
                Sales & Bookings
              </h4>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={agentDailyData} margin={chartDefaults.margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Sales" fill={chartColors.spa} />
                  <Bar dataKey="Bookings" fill={chartColors.aesthetics} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Conversion / Deposit / Missed line chart */}
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">
                Rate Metrics
              </h4>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={agentDailyData} margin={chartDefaults.margin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip formatter={(value) => formatPercent(Number(value))} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Conv %"
                    stroke={chartColors.aesthetics}
                    strokeWidth={chartDefaults.strokeWidth}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="Deposit %"
                    stroke={chartColors.spa}
                    strokeWidth={chartDefaults.strokeWidth}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="Missed %"
                    stroke={chartColors.target}
                    strokeWidth={chartDefaults.strokeWidth}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}