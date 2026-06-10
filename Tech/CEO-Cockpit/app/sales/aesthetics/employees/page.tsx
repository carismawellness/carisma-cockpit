"use client";

// Aesthetics — Employee Dashboards (team index).
// Lists every aesthetics sales employee from the registry and links each
// card to their personal commission dashboard at
// /sales/aesthetics/employees/[slug].

import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import type { SalesEmployeeWithRates } from "@/lib/sales-employees/types";
import { BRAND } from "@/lib/constants/design-tokens";
import { AlertTriangle, BadgeCheck, ChevronRight, Settings, Users } from "lucide-react";

const ACCENT = BRAND.aesthetics.dark; // #3B7676
const ACCENT_SOFT = BRAND.aesthetics.soft; // #DEEBEB

function RatesPill({ ratesSet }: { ratesSet: boolean }) {
  return ratesSet ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <BadgeCheck className="h-3 w-3" />
      Rates set
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      Rates not set
    </span>
  );
}

function EmployeeCard({ employee }: { employee: SalesEmployeeWithRates }) {
  return (
    <Link href={`/sales/aesthetics/employees/${employee.slug}`} className="block group">
      <Card className="p-4 h-full transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{ backgroundColor: ACCENT_SOFT, color: ACCENT }}
            >
              {employee.display_name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p.charAt(0).toUpperCase())
                .join("")}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate group-hover:underline">
                {employee.display_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {employee.role ?? "—"}
                {employee.location_name ? ` · ${employee.location_name}` : ""}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {employee.is_active ? (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: ACCENT_SOFT, color: ACCENT }}
            >
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
              Inactive
            </span>
          )}
          <RatesPill ratesSet={employee.current_rates != null} />
        </div>
      </Card>
    </Link>
  );
}

function AestheticsEmployeesIndexContent() {
  const { employees, isLoading, isError, error, migrationMissing } =
    useSalesEmployees("aesthetics");

  const active = employees.filter((e) => e.is_active);
  const inactive = employees.filter((e) => !e.is_active);

  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" style={{ color: ACCENT }} />
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Aesthetics — Employee Dashboards
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Personal commission dashboards for every aesthetics sales employee. Click a name to
          open their dashboard.
        </p>
      </div>

      {/* ── Migration missing ───────────────────────────────────────── */}
      {migrationMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Run migration <code className="font-mono text-xs">073_create_sales_employees.sql</code>{" "}
            in Supabase, then seed employees in Settings → Sales Employees.
          </span>
        </div>
      )}

      {/* ── Error (non-migration) ───────────────────────────────────── */}
      {isError && !migrationMissing && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load employees{error ? ` — ${error}` : ""}. Try refreshing.
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!isLoading && !isError && employees.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No aesthetics employees yet.
          </p>
          <Link
            href="/settings/sales-employees"
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
            style={{ color: ACCENT }}
          >
            <Settings className="h-3.5 w-3.5" />
            Add employees in Settings → Sales Employees
          </Link>
        </div>
      )}

      {/* ── Active employees ────────────────────────────────────────── */}
      {!isLoading && active.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {active.map((e) => (
            <EmployeeCard key={e.slug} employee={e} />
          ))}
        </div>
      )}

      {/* ── Inactive employees (collapsed secondary section) ────────── */}
      {!isLoading && inactive.length > 0 && (
        <details className="group/inactive">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/inactive:rotate-90" />
            Inactive employees ({inactive.length})
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 opacity-70">
            {inactive.map((e) => (
              <EmployeeCard key={e.slug} employee={e} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function AestheticsEmployeesIndexPage() {
  return (
    <DashboardShell>
      {() => <AestheticsEmployeesIndexContent />}
    </DashboardShell>
  );
}
