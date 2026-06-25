"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
// DATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISO(from), to: toISO(to) };
}

function monthToRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0);
  return { from: toISO(from), to: toISO(to) };
}

function lastSixMonths(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
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
  if (source === "cost_centre") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        roster
      </span>
    );
  }
  if (source === "org_unit_fallback") {
    return (
      <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
        org unit
      </span>
    );
  }
  if (source === "mixed") {
    return (
      <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
        mixed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      no roster
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY BAR
// ════════════════════════════════════════════════════════════════════════════

function SummaryBar({ data }: { data: LocationSplitsData }) {
  const rosterCount = data.employees.filter(
    (e) => e.attributionSource === "cost_centre"
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        { label: "Total Payroll", value: fmtCurrency(data.totalPayroll) },
        { label: "Employees", value: String(data.employeeCount) },
        {
          label: "Roster-based",
          value: String(rosterCount),
          accent: "text-emerald-600",
        },
        {
          label: "Estimated wages",
          value: String(data.extrapolatedCount),
          accent: data.extrapolatedCount > 0 ? "text-amber-600" : "text-slate-900",
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
  const isRoster = emp.attributionSource === "cost_centre";

  return (
    <tr
      className={`border-b border-slate-100 transition-colors hover:bg-slate-50 ${
        isRoster ? "border-l-4 border-l-emerald-400 bg-emerald-50/30" : ""
      }`}
    >
      <td className="py-3 pl-4 pr-2">
        <span className="font-medium text-slate-900">{emp.employeeName}</span>
        {emp.isExtrapolated && (
          <span className="ml-1.5 inline-flex items-center rounded-sm bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700">
            est.
          </span>
        )}
      </td>
      <td className="px-2 py-3 text-sm text-slate-600">
        {slugDisplay(emp.homeLocationSlug) || "—"}
      </td>
      <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
        {fmtCurrency(emp.grossWage)}
      </td>
      <td className="px-2 py-3 text-right text-sm tabular-nums text-slate-600">
        {emp.rosteredDays}
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
              Wage (range)
            </th>
            <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
              Rostered Days
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
            <EmployeeRow key={emp.talexioId} emp={emp} />
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
        No attribution data for this range.
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

function LocationAttributionContent() {
  const searchParams = useSearchParams();

  // Seed the range from URL params (from/to or month), else current month.
  const initial = (() => {
    const f = searchParams.get("from");
    const t = searchParams.get("to");
    if (f && t) return { from: f, to: t };
    const m = searchParams.get("month");
    if (m && /^\d{4}-\d{2}$/.test(m)) return monthToRange(m);
    return currentMonthRange();
  })();

  // URL params (from drill-down links) seed the initial range on mount; after
  // that the user drives the range via the date inputs / quick-select.
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [activeSlug, setActiveSlug] = useState<string>("all");

  const { data, isLoading, error } = useLocationSplits(from, to);

  const months = lastSixMonths();

  // Derive ordered list of slugs present in data for filter buttons
  const allSlugs: string[] = data
    ? Object.keys(data.locationTotals).sort(
        (a, b) =>
          (data.locationTotals[b] ?? 0) - (data.locationTotals[a] ?? 0)
      )
    : [];

  function handleMonthQuickSelect(m: string) {
    const r = monthToRange(m);
    setFrom(r.from);
    setTo(r.to);
    setActiveSlug("all");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
            {/* Quick-select month */}
            <select
              onChange={(e) => handleMonthQuickSelect(e.target.value)}
              value=""
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="" disabled>
                Quick month…
              </option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
            {/* Arbitrary date range */}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setActiveSlug("all");
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value);
                  setActiveSlug("all");
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* Extrapolated notice */}
        {!isLoading && !error && data && data.extrapolatedCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Salaries for this period are estimated from the most recent payslip
            for {data.extrapolatedCount} employee
            {data.extrapolatedCount !== 1 ? "s" : ""}.
          </div>
        )}

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
                <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-400" />
                roster (location from shift cost-centre)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-sky-100 ring-1 ring-sky-400" />
                org unit (fallback from Talexio org structure when no roster)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-violet-100 ring-1 ring-violet-400" />
                mixed (more than one source across the range)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-400" />
                est. (wage extrapolated from most recent payslip)
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function LocationAttributionPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-6 py-6">
          <div className="mx-auto max-w-7xl space-y-4">
            <div className="h-20 animate-pulse rounded-xl bg-slate-200" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
          </div>
        </div>
      }
    >
      <LocationAttributionContent />
    </Suspense>
  );
}
