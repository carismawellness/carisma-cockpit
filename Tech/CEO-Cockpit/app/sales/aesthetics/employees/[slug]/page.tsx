"use client";

// Aesthetics — personal sales-employee dashboard.
// Commission headline (service + retail split), KPI cards, daily trend,
// service/retail breakdowns and the aesthetics-specific Payment Mix chart.
// Data: GET /api/sales/employee-stats via useSalesEmployeeStats.

import { use, useMemo, useState } from "react";
import Link from "next/link";
import type { EmployeeType } from "@/lib/sales-employees/types";
import { previousPeriod } from "@/lib/utils/period-comparison";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CommissionHero,
  CommissionHeroSkeleton,
} from "@/components/sales/employees/CommissionHero";
import { RetailTargetMeter, RetailTargetMeterSkeleton } from "@/components/sales/employees/RetailTargetMeter";
import { StreakBadge, StreakTooltip } from "@/components/sales/employees/StreakBadge";
import { EmployeeStatCards } from "@/components/sales/employees/EmployeeStatCards";
import { EmployeeTrendChart } from "@/components/sales/employees/EmployeeTrendChart";
import { EmployeeBreakdownTable } from "@/components/sales/employees/EmployeeBreakdownTable";
import { useSalesEmployeeStats } from "@/lib/hooks/useSalesEmployeeStats";
import { useSalesEmployeeMonthly } from "@/lib/hooks/useSalesEmployeeMonthly";
import { useIsAdmin } from "@/lib/hooks/useIsAdmin";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { BRAND } from "@/lib/constants/design-tokens";
import { formatCurrency } from "@/lib/charts/config";
import { Calendar, ChevronLeft, ChevronRight, Lock, ShoppingBag } from "lucide-react";
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

  const { prevFrom, prevTo } = useMemo(() => previousPeriod(dateFrom, dateTo), [dateFrom, dateTo]);
  const { stats: prevStats } = useSalesEmployeeStats("aesthetics", slug, prevFrom, prevTo);

  // 6-month longitudinal data for StreakBadge
  const { months: monthlyData, isLoading: monthlyLoading } = useSalesEmployeeMonthly("aesthetics", slug);

  const periodLabel = formatDateRangeLabel(dateFrom, dateTo);
  const basisLabel =
    stats?.employee.commission_basis === "inc_vat" ? "inc-VAT" : "ex-VAT";
  const paymentMix =
    ((stats?.brand_extras?.payment_mix as PaymentMixEntry[] | undefined) ?? []);
  const empType: EmployeeType = (stats?.employee.employee_type as EmployeeType | undefined) ?? "therapist";

  // Retail tier bonus: €100 per €800 earned in retail sales this period
  const RETAIL_TIER_SIZE  = 800;
  const RETAIL_BONUS_EACH = 100;
  const bonusEarned     = stats     ? Math.floor(stats.totals.retail_revenue     / RETAIL_TIER_SIZE) * RETAIL_BONUS_EACH : 0;
  const prevBonusEarned = prevStats  ? Math.floor(prevStats.totals.retail_revenue  / RETAIL_TIER_SIZE) * RETAIL_BONUS_EACH : 0;

  // All-time best commission (includes bonus) from 6-month history + current period
  const allTimeBestCommission = useMemo(() => {
    const all = [...monthlyData.map((m) => m.total_commission)];
    if (stats) all.push(stats.totals.commission_total + bonusEarned);
    return all.length > 0 ? Math.max(...all) : 0;
  }, [monthlyData, stats, bonusEarned]);

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          No aesthetics employee found for "{slug}".
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
          <RetailTargetMeterSkeleton />
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
            commissionBonus={bonusEarned}
            serviceRate={stats.rates?.service_rate ?? 0}
            retailRate={stats.rates?.retail_rate ?? 0}
            ratesSet={stats.employee.rates_set}
            accentColor={ACCENT_SOFT}
            periodLabel={periodLabel}
            prevCommissionTotal={prevStats?.totals.commission_total}
            prevCommissionService={prevStats?.totals.commission_service}
            prevCommissionRetail={prevStats?.totals.commission_retail}
            prevCommissionBonus={prevBonusEarned}
            allTimeBestCommission={allTimeBestCommission}
          />

          {/* Retail target tracker — only for therapists/advisors who sell retail */}
          {(empType === "therapist" || empType === "advisor") && (
            <>
              <RetailTargetMeter
                retailRevenue={stats.totals.retail_revenue}
                targetRevenue={800}
                bonusAmount={100}
                periodLabel={periodLabel}
                dateTo={dateTo}
              />
              {!monthlyLoading && (
                <div className="flex flex-col items-start gap-0.5 px-1">
                  <StreakBadge months={monthlyData} retailTarget={800} />
                  <StreakTooltip months={monthlyData} retailTarget={800} />
                </div>
              )}
            </>
          )}

          <EmployeeStatCards totals={stats.totals} basisLabel={basisLabel} prevTotals={prevStats?.totals} />

          <EmployeeTrendChart
            daily={stats.daily}
            serviceRate={stats.rates?.service_rate ?? 0}
            retailRate={stats.rates?.retail_rate ?? 0}
          />

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

// Rolling lookback enforced for non-admin users — mirrors API-side constant.
const EMPLOYEE_MAX_LOOKBACK_MONTHS = 6;

function AestheticsEmployeeDateGate({
  slug,
  rawDateFrom,
  dateTo,
}: {
  slug: string;
  rawDateFrom: Date;
  dateTo: Date;
}) {
  const { isAdmin, isLoaded } = useIsAdmin();

  const { dateFrom, isClamped } = useMemo(() => {
    if (!isLoaded || isAdmin) return { dateFrom: rawDateFrom, isClamped: false };
    const earliest = new Date();
    earliest.setMonth(earliest.getMonth() - EMPLOYEE_MAX_LOOKBACK_MONTHS);
    earliest.setHours(0, 0, 0, 0);
    if (rawDateFrom < earliest) return { dateFrom: earliest, isClamped: true };
    return { dateFrom: rawDateFrom, isClamped: false };
  }, [isAdmin, isLoaded, rawDateFrom]);

  if (!isLoaded) {
    return <div className="text-center py-12 text-gray-400 text-sm">Verifying access…</div>;
  }

  return (
    <>
      {isClamped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
          <Lock className="h-4 w-4 flex-shrink-0" />
          <span className="font-semibold">Data restricted to the last {EMPLOYEE_MAX_LOOKBACK_MONTHS} months.</span>
        </div>
      )}
      <EmployeeDashboardContent slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
    </>
  );
}

export default function AestheticsEmployeePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);

  const { dateFrom, dateTo } = useMemo(() => {
    const from = new Date(selectedYear, selectedMonth - 1, 1);
    const isCurrentMonth =
      selectedYear === today.getFullYear() && selectedMonth === (today.getMonth() + 1);
    const to = isCurrentMonth
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
      : new Date(selectedYear, selectedMonth, 0);
    return { dateFrom: from, dateTo: to };
  }, [selectedYear, selectedMonth]);

  function goPrev() {
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  }

  function goNext() {
    const now = new Date();
    const nextYear  = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    if (nextYear > now.getFullYear() || (nextYear === now.getFullYear() && nextMonth > now.getMonth() + 1)) return;
    setSelectedYear(nextYear);
    setSelectedMonth(nextMonth);
  }

  const isCurrentMonth =
    selectedYear === today.getFullYear() && selectedMonth === (today.getMonth() + 1);

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function goToCurrentMonth() {
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
  }

  return (
    <DashboardShell hideDatePicker>
      {() => (
        <>
          {/* Month selector */}
          <div className="flex flex-col items-center gap-1.5 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Viewing data for
            </p>
            <div className="inline-flex items-center gap-1 rounded-2xl border border-border bg-card shadow-md px-2 py-1.5">
              <button
                type="button"
                onClick={goPrev}
                className="rounded-xl h-9 w-9 flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2 px-3">
                <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-base font-bold text-foreground min-w-[160px] text-center tracking-tight">
                  {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                </span>
              </div>
              <button
                type="button"
                onClick={goNext}
                disabled={isCurrentMonth}
                className="rounded-xl h-9 w-9 flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-25 disabled:cursor-not-allowed"
                aria-label="Next month"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={goToCurrentMonth}
                className="text-xs text-primary font-medium underline-offset-2 hover:underline"
              >
                Back to current month
              </button>
            )}
          </div>
          <AestheticsEmployeeDateGate slug={slug} rawDateFrom={dateFrom} dateTo={dateTo} />
        </>
      )}
    </DashboardShell>
  );
}
