"use client";

// Slimming — Employee Dashboards (team index).
// Lists every slimming sales employee from the sales_employees registry and
// links each to their personal dashboard at /sales/slimming/employees/[slug].
// Visual language follows app/sales/slimming/page.tsx (slimming green accent).

import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import type { SalesEmployeeWithRates } from "@/lib/sales-employees/types";
import { BRAND } from "@/lib/constants/design-tokens";
import { AlertTriangle, BadgePercent, ChevronRight, Settings, Users } from "lucide-react";

const SLIMMING_GREEN = BRAND.slimming.dark;  // #3D6B3D
const SLIMMING_SOFT  = BRAND.slimming.soft;  // #C9D8C1

// ── Employee row card ─────────────────────────────────────────────────────────
function EmployeeCard({ employee }: { employee: SalesEmployeeWithRates }) {
  const ratesSet = employee.current_rates != null;

  return (
    <Link href={`/sales/slimming/employees/${employee.slug}`} className="block group">
      <Card className="p-4 flex items-center gap-3 transition-colors hover:bg-muted/30">
        {/* Initial avatar */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ backgroundColor: SLIMMING_SOFT, color: SLIMMING_GREEN }}
        >
          {employee.display_name.trim().charAt(0).toUpperCase() || "?"}
        </div>

        {/* Name + role */}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground truncate">
            {employee.display_name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {employee.role ?? "Sales"}
            {employee.location_name ? ` · ${employee.location_name}` : ""}
          </p>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {employee.is_active ? (
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: SLIMMING_SOFT, borderColor: SLIMMING_SOFT, color: SLIMMING_GREEN }}
            >
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Inactive
            </span>
          )}
          {ratesSet ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <BadgePercent className="h-3 w-3" />
              Rates set
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              No rates
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </Card>
    </Link>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function IndexSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[72px] animate-pulse rounded-xl bg-gray-100" />
      ))}
    </div>
  );
}

// ── Page content ──────────────────────────────────────────────────────────────
function SlimmingEmployeesContent() {
  const { employees, isLoading, isError, error, migrationMissing } =
    useSalesEmployees("slimming");

  const active = employees.filter((e) => e.is_active);
  const inactive = employees.filter((e) => !e.is_active);

  return (
    <>
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" style={{ color: SLIMMING_GREEN }} />
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Slimming — Employee Dashboards
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Personal commission &amp; sales dashboards for every slimming team member
        </p>
      </div>

      {/* Migration not applied yet */}
      {migrationMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Run migration <code className="font-mono text-xs">073_create_sales_employees.sql</code> in
            Supabase, then seed employees in Settings → Sales Employees.
          </span>
        </div>
      )}

      {/* Generic error */}
      {isError && !migrationMissing && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load employees{error ? ` — ${error}` : ""}. Try refreshing.
        </div>
      )}

      {/* Loading */}
      {isLoading && <IndexSkeleton />}

      {/* Empty */}
      {!isLoading && !isError && employees.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">No slimming employees yet</p>
          <p className="flex items-center justify-center gap-1.5">
            <Settings className="h-4 w-4" />
            Add them in Settings → Sales Employees
          </p>
        </div>
      )}

      {/* Active employees */}
      {!isLoading && active.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {active.map((e) => (
            <EmployeeCard key={e.slug} employee={e} />
          ))}
        </div>
      )}

      {/* Inactive employees — collapsed secondary section */}
      {!isLoading && inactive.length > 0 && (
        <details className="group/inactive">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Inactive employees ({inactive.length})
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 opacity-70">
            {inactive.map((e) => (
              <EmployeeCard key={e.slug} employee={e} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function SlimmingEmployeesIndexPage() {
  return (
    <DashboardShell>
      {() => <SlimmingEmployeesContent />}
    </DashboardShell>
  );
}
