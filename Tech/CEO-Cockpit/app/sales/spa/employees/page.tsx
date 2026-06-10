"use client";

// Spa — Employee Dashboards team index.
// Lists every spa sales employee from the registry (useSalesEmployees) and
// links each one through to their personal commission dashboard at
// /sales/spa/employees/[slug]. Date range persists via DateRangeProvider,
// so plain links are fine.

import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import type { SalesEmployeeWithRates } from "@/lib/sales-employees/types";
import { BRAND } from "@/lib/constants/design-tokens";
import {
  AlertCircle, ChevronDown, ChevronRight, MapPin, Tags, Users,
} from "lucide-react";

function RatesBadge({ employee }: { employee: SalesEmployeeWithRates }) {
  const set = employee.current_rates != null;
  return set ? (
    <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      Rates set
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      No rates
    </span>
  );
}

function EmployeeCard({ employee }: { employee: SalesEmployeeWithRates }) {
  return (
    <Link href={`/sales/spa/employees/${employee.slug}`} className="block group">
      <Card className="p-4 h-full transition-colors hover:border-[#8C7A5A]/50 hover:bg-muted/20">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate group-hover:underline underline-offset-2">
              {employee.display_name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {employee.role ?? "Sales employee"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {employee.is_active ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border"
              style={{ backgroundColor: BRAND.spa.soft, borderColor: "#ddd2bb", color: BRAND.spa.dark }}>
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              Inactive
            </span>
          )}
          <RatesBadge employee={employee} />
        </div>

        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {employee.location_name ?? "—"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Tags className="h-3 w-3" />
            {employee.aliases.length} alias{employee.aliases.length === 1 ? "" : "es"}
          </span>
        </div>
      </Card>
    </Link>
  );
}

function SpaEmployeesContent() {
  const { employees, isLoading, isError, error, migrationMissing } = useSalesEmployees("spa");
  const [showInactive, setShowInactive] = useState(false);

  const active = useMemo(() => employees.filter((e) => e.is_active), [employees]);
  const inactive = useMemo(() => employees.filter((e) => !e.is_active), [employees]);

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" style={{ color: BRAND.spa.dark }} />
          Spa — Employee Dashboards
        </h1>
        <p className="text-sm text-muted-foreground">
          Personal commission &amp; revenue dashboards for every spa therapist and consultant.
        </p>
      </div>

      {/* ── Migration missing ───────────────────────────────────────── */}
      {migrationMissing && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>
            Run migration <code className="font-mono text-xs">073_create_sales_employees.sql</code> in
            Supabase, then seed employees in Settings → Sales Employees.
          </span>
        </div>
      )}

      {/* ── Error (non-migration) ───────────────────────────────────── */}
      {isError && !migrationMissing && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load employees{error ? `: ${error}` : ""}. Try refreshing.</span>
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!isLoading && !isError && employees.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">
            No spa employees yet. Seed and manage employees in{" "}
            <Link href="/settings/sales-employees" className="underline underline-offset-2 hover:text-foreground">
              Settings → Sales Employees
            </Link>.
          </p>
        </Card>
      )}

      {/* ── Active employees ────────────────────────────────────────── */}
      {!isLoading && active.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
          {active.map((e) => (
            <EmployeeCard key={e.id} employee={e} />
          ))}
        </div>
      )}

      {/* ── Inactive employees (collapsed) ──────────────────────────── */}
      {!isLoading && inactive.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInactive((s) => !s)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showInactive ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Inactive employees ({inactive.length})
          </button>
          {showInactive && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 mt-3 opacity-75">
              {inactive.map((e) => (
                <EmployeeCard key={e.id} employee={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function SpaEmployeesPage() {
  return (
    <DashboardShell>
      {() => <SpaEmployeesContent />}
    </DashboardShell>
  );
}
