"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";
import {
  useLocationSplits,
  type EmployeeLocationSplit,
  type LocationSplitsData,
} from "@/lib/hooks/useHRData";

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const SLUG_DISPLAY: Record<string, string> = {
  hugos: "Hugo's Lounge",
  inter: "InterContinental",
  ramla: "Ramla Bay",
  hyatt: "Hyatt",
  excelsior: "Excelsior",
  odycy: "ODYCY",
  labranda: "Labranda Riviera",
  novotel: "Novotel",
  hq: "HQ / Management",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

// Colour palette for location bar chart
const LOCATION_COLORS: Record<string, string> = {
  hugos: "#6366f1",
  inter: "#0ea5e9",
  ramla: "#10b981",
  hyatt: "#f59e0b",
  excelsior: "#8b5cf6",
  odycy: "#ec4899",
  labranda: "#14b8a6",
  novotel: "#f97316",
  hq: "#94a3b8",
  aesthetics: "#96B2B2",
  slimming: "#024C27",
};

const FALLBACK_COLOR = "#64748b";

function slugDisplay(slug: string): string {
  return SLUG_DISPLAY[slug] ?? slug;
}

function slugColor(slug: string): string {
  return LOCATION_COLORS[slug] ?? FALLBACK_COLOR;
}

// ════════════════════════════════════════════════════════════════════════════
// MONTH HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function lastSixMonths(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" });
}

// ════════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ════════════════════════════════════════════════════════════════════════════

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE BADGE
// ════════════════════════════════════════════════════════════════════════════

function SourceBadge({
  source,
}: {
  source: EmployeeLocationSplit["attributionSource"];
}) {
  if (source === "gps_timelogs") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
        GPS
      </span>
    );
  }
  if (source === "org_unit_static") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        org unit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      no position
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY BAR
// ════════════════════════════════════════════════════════════════════════════

function SummaryBar({ data }: { data: LocationSplitsData }) {
  const staticCount = data.employees.filter(
    (e) => e.attributionSource === "org_unit_static"
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: "Total Payroll", value: fmtCurrency(data.totalPayroll) },
        { label: "Employees", value: String(data.employeeCount) },
        {
          label: "Cross-location (GPS)",
          value: String(data.crossLocationCount),
          accent: "text-blue-600",
        },
        {
          label: "Static (org unit)",
          value: String(staticCount),
          accent: "text-emerald-600",
        },
      ].map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {item.label}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              item.accent ?? "text-slate-900"
            }`}
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOCATION CARDS ROW
// ════════════════════════════════════════════════════════════════════════════

function LocationCardsRow({
  totals,
  total,
}: {
  totals: Record<string, number>;
  total: number;
}) {
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map(([slug, wage]) => (
        <div
          key={slug}
          className="flex min-w-[140px] flex-col rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          style={{ borderTopColor: slugColor(slug), borderTopWidth: 3 }}
        >
          <span className="text-xs font-semibold text-slate-500">
            {slugDisplay(slug)}
          </span>
          <span className="mt-0.5 text-base font-bold tabular-nums text-slate-900">
            {fmtCurrency(wage)}
          </span>
          <span className="text-xs text-slate-400">
            {total > 0 ? fmtPct(wage / total) : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOCATION BAR CHART — permanent labels per AGENTS.md
// ════════════════════════════════════════════════════════════════════════════

function LocationBarChart({ totals }: { totals: Record<string, number> }) {
  const data = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([slug, wage]) => ({
      slug,
      name: slugDisplay(slug),
      wage: Math.round(wage),
    }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        Payroll by Location
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 40)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 100, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
          />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: unknown) => fmtCurrency(Number(v))} />
          <Bar dataKey="wage" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.slug} fill={slugColor(entry.slug)} />
            ))}
            {/* AGENTS.md: permanent labels — never hover-only */}
            <LabelList
              dataKey="wage"
              position="right"
              style={{ fontSize: 12, fontWeight: 700, fill: "#1f2937" }}
              formatter={(v: unknown) =>
                typeof v === "number" ? fmtCurrency(v) : ""
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FILTER BAR
// ════════════════════════════════════════════════════════════════════════════

function FilterBar({
  slugs,
  active,
  onSelect,
}: {
  slugs: string[];
  active: string;
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {["all", ...slugs].map((slug) => (
        <button
          key={slug}
          onClick={() => onSelect(slug)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            active === slug
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {slug === "all" ? "All Locations" : slugDisplay(slug)}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EMPLOYEE TABLE
// ════════════════════════════════════════════════════════════════════════════

function LocationSplitCell({ splits }: { splits: Record<string, number> }) {
  const entries = Object.entries(splits).filter(([, v]) => v > 0.005);
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([slug, pct]) => (
        <span
          key={slug}
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: slugColor(slug) + "22",
            color: slugColor(slug),
            border: `1px solid ${slugColor(slug)}44`,
          }}
        >
          {slugDisplay(slug)} {fmtPct(pct)}
        </span>
      ))}
    </div>
  );
}

function WageAttributionCell({
  attribution,
}: {
  attribution: Record<string, number>;
}) {
  const entries = Object.entries(attribution).filter(([, v]) => v > 0);
  return (
    <div className="space-y-0.5">
      {entries.map(([slug, wage]) => (
        <div key={slug} className="text-xs tabular-nums text-slate-700">
          <span className="font-medium">{slugDisplay(slug)}</span>{" "}
          {fmtCurrency(wage)}
        </div>
      ))}
    </div>
  );
}

function EmployeeRow({ emp }: { emp: EmployeeLocationSplit }) {
  const isGPS = emp.attributionSource === "gps_timelogs";

  return (
    <tr
      className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${
        isGPS ? "border-l-4 border-l-blue-400 bg-blue-50/30" : ""
      }`}
    >
      <td className="py-3 pl-4 pr-2">
        <span className="font-medium text-slate-900">{emp.employeeName}</span>
      </td>
      <td className="px-2 py-3 text-sm text-slate-600">
        {emp.homeLocation || slugDisplay(emp.homeLocationSlug)}
      </td>
      <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
        {fmtCurrency(emp.grossWage)}
      </td>
      <td className="px-2 py-3">
        <LocationSplitCell splits={emp.locationSplits} />
      </td>
      <td className="px-2 py-3">
        <WageAttributionCell attribution={emp.wageAttribution} />
      </td>
      <td className="px-2 py-3 pr-4">
        <SourceBadge source={emp.attributionSource} />
      </td>
    </tr>
  );
}

function EmployeeTable({
  employees,
  activeSlug,
}: {
  employees: EmployeeLocationSplit[];
  activeSlug: string;
}) {
  const filtered =
    activeSlug === "all"
      ? employees
      : employees.filter(
          (e) =>
            Object.entries(e.wageAttribution).some(
              ([slug, wage]) => slug === activeSlug && wage > 0
            )
        );

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No employees with attribution at this location.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="py-3 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Name
            </th>
            <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Home Location
            </th>
            <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              Gross Wage
            </th>
            <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Location Split
            </th>
            <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attribution
            </th>
            <th className="px-2 py-3 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((emp) => (
            <EmployeeRow key={emp.id} emp={emp} />
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-100 px-4 py-2 text-right text-xs text-slate-400">
        {filtered.length} employee{filtered.length !== 1 ? "s" : ""} shown
        {activeSlug !== "all" && ` (filtered: ${slugDisplay(activeSlug)})`}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ════════════════════════════════════════════════════════════════════════════

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-8 py-16 text-center">
      <p className="text-base font-semibold text-slate-600">
        No attribution data for this month.
      </p>
      <p className="mt-2 text-sm text-slate-400">
        Go to{" "}
        <span className="font-medium text-slate-600">
          Settings → EBITDA Mapping → Location Splits
        </span>{" "}
        and click <span className="font-medium text-slate-600">Compute</span>.
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function LocationAttributionPage() {
  const [month, setMonth] = useState<string>(getDefaultMonth);
  const [activeSlug, setActiveSlug] = useState<string>("all");

  const { data, isLoading, error } = useLocationSplits(month);

  const months = lastSixMonths();

  // Derive ordered list of slugs present in data for filter buttons
  const allSlugs: string[] = data
    ? Object.keys(data.locationTotals).sort((a, b) =>
        (data.locationTotals[b] ?? 0) - (data.locationTotals[a] ?? 0)
      )
    : [];

  function handleMonthChange(m: string) {
    setMonth(m);
    setActiveSlug("all");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/hr"
              className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              ← HR Dashboard
            </Link>
            <span className="text-slate-200">|</span>
            <h1 className="text-lg font-bold text-slate-900">
              Wage Location Attribution
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {data?.lastComputed && (
              <span className="text-xs text-slate-400">
                Last computed: {fmtDate(data.lastComputed)}
              </span>
            )}
            <select
              value={month}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {isLoading && (
          <div className="space-y-4">
            {/* Summary skeleton */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl bg-slate-200"
                />
              ))}
            </div>
            {/* Table skeleton */}
            <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load attribution data:{" "}
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}

        {!isLoading && !error && data && data.employeeCount === 0 && (
          <EmptyState />
        )}

        {!isLoading && !error && data && data.employeeCount > 0 && (
          <>
            {/* Summary bar */}
            <SummaryBar data={data} />

            {/* Location mini-cards */}
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payroll by Location
              </h2>
              <LocationCardsRow
                totals={data.locationTotals}
                total={data.totalPayroll}
              />
            </div>

            {/* Bar chart — permanent labels per AGENTS.md */}
            {Object.keys(data.locationTotals).length > 0 && (
              <LocationBarChart totals={data.locationTotals} />
            )}

            {/* Filter bar */}
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Filter by Location
              </h2>
              <FilterBar
                slugs={allSlugs}
                active={activeSlug}
                onSelect={setActiveSlug}
              />
            </div>

            {/* Employee table */}
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Employee Attribution Detail
              </h2>
              <EmployeeTable
                employees={data.employees}
                activeSlug={activeSlug}
              />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-blue-100 ring-1 ring-blue-400" />
                GPS (cross-location employee — timelogs used for split)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-400" />
                org unit (static assignment from Talexio org structure)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-slate-100 ring-1 ring-slate-400" />
                no position (employee has no org unit — not yet assigned)
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
