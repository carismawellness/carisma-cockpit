"use client";

// Spa — personal sales-employee dashboard.
// Commission is the headline metric (CommissionHero), backed by revenue
// stat cards, the daily trend, service/retail breakdowns and a spa-specific
// "Revenue by Location" bar chart (stats.brand_extras.by_location).

import { use, useMemo } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSalesEmployeeStats } from "@/lib/hooks/useSalesEmployeeStats";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import { CommissionHero, CommissionHeroSkeleton } from "@/components/sales/employees/CommissionHero";
import { EmployeeStatCards } from "@/components/sales/employees/EmployeeStatCards";
import { EmployeeTrendChart } from "@/components/sales/employees/EmployeeTrendChart";
import { EmployeeBreakdownTable } from "@/components/sales/employees/EmployeeBreakdownTable";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { previousPeriod } from "@/lib/utils/period-comparison";
import { BRAND } from "@/lib/constants/design-tokens";
import type { EmployeeType } from "@/lib/sales-employees/types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList,
} from "recharts";
import { AlertCircle, ChevronLeft, MapPin } from "lucide-react";

const TYPE_LABELS: Record<EmployeeType, string> = {
  therapist:  "Therapist",
  advisor:    "Advisor / Reception",
  management: "Management",
};
function typeBadgeClass(t: EmployeeType) {
  if (t === "advisor")    return "bg-sky-50 border-sky-200 text-sky-700";
  if (t === "management") return "bg-violet-50 border-violet-200 text-violet-700";
  return "bg-emerald-50 border-emerald-200 text-emerald-700";
}

interface LocationRevenue {
  name: string;
  revenue: number;
}

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function SpaEmployeeContent({
  slug,
  dateFrom,
  dateTo,
}: {
  slug: string;
  dateFrom: Date;
  dateTo: Date;
}) {
  const { stats, isLoading, isError, error, notFound } =
    useSalesEmployeeStats("spa", slug, dateFrom, dateTo);

  const { prevFrom, prevTo } = useMemo(() => previousPeriod(dateFrom, dateTo), [dateFrom, dateTo]);
  const { stats: prevStats } = useSalesEmployeeStats("spa", slug, prevFrom, prevTo);

  // The stats payload doesn't carry location_name — look it up in the registry.
  const { employees } = useSalesEmployees("spa");
  const locationName = useMemo(
    () => employees.find((e) => e.slug === slug)?.location_name ?? null,
    [employees, slug],
  );
  const empType: EmployeeType = (stats?.employee.employee_type as EmployeeType | undefined) ?? "therapist";

  const periodLabel = useMemo(
    () => formatDateRangeLabel(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const basisLabel =
    stats?.employee.commission_basis === "inc_vat" ? "inc-VAT" : "ex-VAT";

  // Spa extra: revenue by location (compact horizontal bars)
  const byLocation = useMemo<LocationRevenue[]>(() => {
    const raw = (stats?.brand_extras as { by_location?: LocationRevenue[] } | undefined)
      ?.by_location;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && typeof l.revenue === "number" && l.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [stats?.brand_extras]);

  /* ── Not found ─────────────────────────────────────────────────── */
  if (notFound) {
    return (
      <Card className="p-10 text-center text-muted-foreground">
        <p className="text-sm font-medium text-foreground mb-1">Employee not found</p>
        <p className="text-sm">
          No spa employee matches “{slug}” — they may have been renamed or removed.
        </p>
        <Link
          href="/sales/spa/employees"
          className="mt-3 inline-block text-xs underline underline-offset-2 hover:text-foreground"
        >
          Back to Spa employee dashboards
        </Link>
      </Card>
    );
  }

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <Link
          href="/sales/spa/employees"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Spa employees
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            {isLoading ? "Loading…" : stats?.employee.display_name ?? slug}
          </h1>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border"
            style={{ backgroundColor: BRAND.spa.soft, borderColor: "#ddd2bb", color: BRAND.spa.dark }}
          >
            Spa
          </span>
          {stats && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${typeBadgeClass(empType)}`}>
              {TYPE_LABELS[empType]}
            </span>
          )}
          {stats && !stats.employee.is_active && (
            <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              Inactive
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>{stats?.employee.role ?? "Sales employee"}</span>
          {locationName && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {locationName}
            </span>
          )}
          <span>· {periodLabel}</span>
        </p>
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {isError && !notFound && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load stats{error ? `: ${error}` : ""}. Try refreshing.</span>
        </div>
      )}

      {/* ── Loading skeletons ───────────────────────────────────────── */}
      {isLoading && (
        <>
          <CommissionHeroSkeleton />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
            <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
          </div>
        </>
      )}

      {/* ── Dashboard ───────────────────────────────────────────────── */}
      {!isLoading && stats && (
        <>
          <CommissionHero
            commissionService={stats.totals.commission_service}
            commissionRetail={stats.totals.commission_retail}
            commissionTotal={stats.totals.commission_total}
            serviceRate={stats.rates?.service_rate ?? 0}
            retailRate={stats.rates?.retail_rate ?? 0}
            ratesSet={stats.employee.rates_set}
            accentColor={BRAND.spa.soft}
            periodLabel={periodLabel}
            prevCommissionTotal={prevStats?.totals.commission_total}
            prevCommissionService={prevStats?.totals.commission_service}
            prevCommissionRetail={prevStats?.totals.commission_retail}
          />

          <EmployeeStatCards totals={stats.totals} basisLabel={basisLabel} prevTotals={prevStats?.totals} />

          <EmployeeTrendChart daily={stats.daily} accentColor={BRAND.spa.soft} />

          {/* Service + retail breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmployeeBreakdownTable title="Top Services" rows={stats.service_breakdown} />
            <EmployeeBreakdownTable title="Top Retail Products" rows={stats.retail_breakdown} />
          </div>

          {/* Spa extra: revenue by location */}
          {byLocation.length > 0 && (
            <Card className="p-4 md:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Location</h2>
              <p className="text-xs text-muted-foreground mb-5">
                This employee&apos;s revenue per venue · {basisLabel}
              </p>
              <ResponsiveContainer width="100%" height={Math.max(140, byLocation.length * 44)}>
                <BarChart
                  layout="vertical"
                  data={byLocation}
                  margin={{ top: 4, right: 70, left: 10, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0ede8" />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => fmtShort(v)}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: unknown) => [fmtShort(Number(v)), "Revenue"]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="revenue" fill={BRAND.spa.soft} radius={[0, 4, 4, 0]} barSize={24}>
                    <LabelList
                      dataKey="revenue"
                      position="right"
                      formatter={(v: unknown) => fmtShort(Number(v))}
                      style={{ fontSize: 11, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </>
  );
}

export default function SpaEmployeePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <SpaEmployeeContent slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
