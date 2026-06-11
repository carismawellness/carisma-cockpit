"use client";

// Aesthetics — personal sales-employee dashboard.
// Commission headline (service + retail split), KPI cards, daily trend,
// service/retail breakdowns and the aesthetics-specific Payment Mix chart.
// Data: GET /api/sales/employee-stats via useSalesEmployeeStats.

import { use } from "react";
import Link from "next/link";
import type { EmployeeType } from "@/lib/sales-employees/types";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommissionHero,
  CommissionHeroSkeleton,
} from "@/components/sales/employees/CommissionHero";
import { EmployeeStatCards } from "@/components/sales/employees/EmployeeStatCards";
import { EmployeeTrendChart } from "@/components/sales/employees/EmployeeTrendChart";
import { EmployeeBreakdownTable } from "@/components/sales/employees/EmployeeBreakdownTable";
import { useSalesEmployeeStats } from "@/lib/hooks/useSalesEmployeeStats";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { BRAND } from "@/lib/constants/design-tokens";
import { formatCurrency } from "@/lib/charts/config";
import { ChevronLeft, ShoppingBag } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const ACCENT      = BRAND.aesthetics.dark; // text colors, icons
const ACCENT_SOFT = BRAND.aesthetics.soft; // fills, backgrounds, borders

interface PaymentMixEntry {
  type: string;
  revenue: number;
}

function fmtK(v: number): string {
  if (!Number.isFinite(v)) return "€0";
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

// ── Payment Mix (aesthetics brand extra) ──────────────────────────────────────

function PaymentMixCard({ mix }: { mix: PaymentMixEntry[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Payment Mix</CardTitle>
      </CardHeader>
      <CardContent>
        {mix.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No payment data in this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, mix.length * 44)}>
            <BarChart
              layout="vertical"
              data={mix}
              margin={{ top: 4, right: 80, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => fmtK(Number(v))}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="type"
                width={110}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: unknown) => [formatCurrency(Number(v)), "Revenue"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="revenue" fill={ACCENT_SOFT} radius={[0, 4, 4, 0]} barSize={22}>
                <LabelList
                  dataKey="revenue"
                  position="right"
                  formatter={(v: unknown) => fmtK(Number(v))}
                  style={{ fontSize: 11, fill: "#111827", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page content ──────────────────────────────────────────────────────────────

function EmployeeDashboardContent({
  slug,
  dateFrom,
  dateTo,
}: {
  slug: string;
  dateFrom: Date;
  dateTo: Date;
}) {
  const { stats, isLoading, isError, error, notFound } = useSalesEmployeeStats(
    "aesthetics",
    slug,
    dateFrom,
    dateTo,
  );

  const periodLabel = formatDateRangeLabel(dateFrom, dateTo);
  const basisLabel =
    stats?.employee.commission_basis === "inc_vat" ? "inc-VAT" : "ex-VAT";
  const paymentMix =
    ((stats?.brand_extras?.payment_mix as PaymentMixEntry[] | undefined) ?? []);
  const empType: EmployeeType = (stats?.employee.employee_type as EmployeeType | undefined) ?? "therapist";

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          No aesthetics employee found for “{slug}”.
        </p>
        <Link
          href="/sales/aesthetics/employees"
          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          style={{ color: ACCENT }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to all employees
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* ── Breadcrumb + header ─────────────────────────────────────── */}
      <div className="space-y-1">
        <Link
          href="/sales/aesthetics/employees"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Aesthetics Employees
        </Link>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            {stats?.employee.display_name ?? slug}
          </h1>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: ACCENT_SOFT, color: ACCENT }}
          >
            Aesthetics
          </span>
          {empType !== "therapist" && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              empType === "management" ? "bg-violet-50 border-violet-200 text-violet-700" : "bg-sky-50 border-sky-200 text-sky-700"
            }`}>
              {empType === "management" ? "Management" : "Advisor / Reception"}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {stats?.employee.role ?? "Sales employee"} · {periodLabel} · figures {basisLabel}
        </p>
      </div>

      {/* ── Error ───────────────────────────────────────────────────── */}
      {isError && !notFound && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load dashboard{error ? ` — ${error}` : ""}. Try refreshing.
        </div>
      )}

      {/* ── Loading ─────────────────────────────────────────────────── */}
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
            accentColor={ACCENT_SOFT}
            periodLabel={periodLabel}
          />

          <EmployeeStatCards totals={stats.totals} basisLabel={basisLabel} />

          <EmployeeTrendChart daily={stats.daily} accentColor={ACCENT} />

          {/* Breakdowns — retail is keyword-classified for aesthetics and may be sparse */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmployeeBreakdownTable
              title="Top Treatments"
              rows={stats.service_breakdown}
            />
            {stats.retail_breakdown.length > 0 ? (
              <EmployeeBreakdownTable
                title="Retail / Products"
                rows={stats.retail_breakdown}
              />
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold">Retail / Products</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="py-8 text-center">
                    <ShoppingBag className="mx-auto h-6 w-6 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No retail sales in this period
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Aesthetics extra — payment mix */}
          <PaymentMixCard mix={paymentMix} />
        </>
      )}
    </>
  );
}

export default function AestheticsEmployeePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <EmployeeDashboardContent slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
