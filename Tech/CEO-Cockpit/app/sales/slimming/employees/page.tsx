"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import type { EmployeeType, SalesEmployeeWithRates } from "@/lib/sales-employees/types";
import { BRAND } from "@/lib/constants/design-tokens";
import { AlertTriangle, BadgePercent, ChevronDown, ChevronRight, Settings, Users } from "lucide-react";
import { Card } from "@/components/ui/card";

const SLIMMING_GREEN = BRAND.slimming.dark;
const SLIMMING_SOFT  = BRAND.slimming.soft;

type TypeFilter = "all" | EmployeeType;

const TYPE_LABELS: Record<EmployeeType, string> = {
  therapist:  "Therapists",
  advisor:    "Advisors & Reception",
  management: "Management",
};

function EmployeeCard({ employee }: { employee: SalesEmployeeWithRates }) {
  const empType = (employee as SalesEmployeeWithRates & { employee_type?: EmployeeType }).employee_type ?? "therapist";
  const ratesSet = employee.current_rates != null;

  return (
    <Link href={`/sales/slimming/employees/${employee.slug}`} className="block group">
      <Card className="p-4 flex items-center gap-3 transition-colors hover:bg-muted/30">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
          style={{ backgroundColor: SLIMMING_SOFT, color: SLIMMING_GREEN }}
        >
          {employee.display_name.trim().charAt(0).toUpperCase() || "?"}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-foreground truncate">{employee.display_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {employee.role ?? "Sales"}
            {employee.location_name ? ` · ${employee.location_name}` : ""}
          </p>
        </div>

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
          {empType !== "therapist" && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              empType === "management"
                ? "bg-violet-50 border-violet-200 text-violet-700"
                : "bg-sky-50 border-sky-200 text-sky-700"
            }`}>
              {TYPE_LABELS[empType]}
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

function TypeFilterTabs({
  counts,
  value,
  onChange,
}: {
  counts: Record<TypeFilter, number>;
  value: TypeFilter;
  onChange: (t: TypeFilter) => void;
}) {
  const tabs: { key: TypeFilter; label: string }[] = [
    { key: "all",        label: `All (${counts.all})` },
    { key: "therapist",  label: `Therapists (${counts.therapist})` },
    { key: "advisor",    label: `Advisors & Reception (${counts.advisor})` },
    { key: "management", label: `Management (${counts.management})` },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
            value === t.key
              ? "text-white"
              : "border-gray-200 bg-white text-muted-foreground hover:text-foreground"
          }`}
          style={
            value === t.key
              ? { backgroundColor: SLIMMING_GREEN, borderColor: SLIMMING_GREEN }
              : { borderColor: "#e5e7eb" }
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SlimmingEmployeesContent() {
  const { employees, isLoading, isError, error, migrationMissing } = useSalesEmployees("slimming");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showInactive, setShowInactive] = useState(false);

  const getType = (e: SalesEmployeeWithRates): EmployeeType =>
    (e as SalesEmployeeWithRates & { employee_type?: EmployeeType }).employee_type ?? "therapist";

  const active   = useMemo(() => employees.filter((e) => e.is_active), [employees]);
  const inactive = useMemo(() => employees.filter((e) => !e.is_active), [employees]);

  const counts = useMemo<Record<TypeFilter, number>>(() => ({
    all:        active.length,
    therapist:  active.filter((e) => getType(e) === "therapist").length,
    advisor:    active.filter((e) => getType(e) === "advisor").length,
    management: active.filter((e) => getType(e) === "management").length,
  }), [active]);

  const visibleActive = useMemo(
    () => typeFilter === "all" ? active : active.filter((e) => getType(e) === typeFilter),
    [active, typeFilter],
  );

  return (
    <>
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

      {migrationMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Run migrations <code className="font-mono text-xs">073</code> and <code className="font-mono text-xs">074</code> in
            Supabase, then seed employees in Settings → Sales Employees.
          </span>
        </div>
      )}

      {isError && !migrationMissing && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load employees{error ? ` — ${error}` : ""}. Try refreshing.
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {!isLoading && !isError && employees.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">No slimming employees yet</p>
          <p className="flex items-center justify-center gap-1.5">
            <Settings className="h-4 w-4" />
            Add them in Settings → Sales Employees
          </p>
        </div>
      )}

      {!isLoading && active.length > 0 && (
        <>
          <TypeFilterTabs counts={counts} value={typeFilter} onChange={setTypeFilter} />
          {visibleActive.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active employees in this category.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleActive.map((e) => (
                <EmployeeCard key={e.slug} employee={e} />
              ))}
            </div>
          )}
        </>
      )}

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 opacity-70">
              {inactive.map((e) => (
                <EmployeeCard key={e.slug} employee={e} />
              ))}
            </div>
          )}
        </div>
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
