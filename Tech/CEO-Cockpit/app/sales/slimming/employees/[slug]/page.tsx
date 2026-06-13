"use client";

// Slimming — personal sales-employee dashboard.
// Commission headline (CommissionHero) + stat cards + daily trend + breakdown
// tables, plus slimming-specific extras: category mix and collected-vs-full
// price (packages are paid in installments, so collection rate matters).

import { use, useMemo, useState } from "react";
import Link from "next/link";
import type { EmployeeType } from "@/lib/sales-employees/types";
import { previousPeriod } from "@/lib/utils/period-comparison";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { CommissionHero, CommissionHeroSkeleton } from "@/components/sales/employees/CommissionHero";
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
import { Calendar, ChevronLeft, ChevronRight, Banknote, Lock, Wallet } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Cell,
} from "recharts";

const SLIMMING_GREEN = BRAND.slimming.dark;  // text colors, icons
const SLIMMING_SOFT  = BRAND.slimming.soft;  // fills, backgrounds, borders

// Pastel palette matching app/sales/slimming/page.tsx service-type colours
const CATEGORY_COLORS: Record<string, string> = {
  weight_loss: SLIMMING_SOFT,
  treatment:   "#B8C9E0", // soft blue
  medical:     "#D5C0E5", // soft purple
  product:     "#E5C088", // soft gold
};
const CATEGORY_LABELS: Record<string, string> = {
  weight_loss: "Weight Loss",
  treatment:   "Treatments",
  medical:     "Medical",
  product:     "Products",
};

// Shape of stats.brand_extras for the slimming brand
interface SlimmingExtras {
  category_mix?: Array<{ category: string; revenue: number }>;
  collected_vs_full?: { paid: number; full_price: number };
}

function fmtK(v: number): string {
  if (!Number.isFinite(v)) return "€0";
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function prettifyCategory(cat: string): string {
  return CATEGORY_LABELS[cat] ??
    cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Category mix — compact horizontal bar chart with value labels ─────────────
function CategoryMixChart({ mix }: { mix: Array<{ category: string; revenue: number }> }) {
  const data = mix
    .filter((m) => m.revenue > 0)
    .map((m) => ({
      name: prettifyCategory(m.category),
      Revenue: m.revenue,
      category: m.category,
    }));

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground mb-1">Category Mix</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Revenue split across weight loss, treatments, medical &amp; products
      </p>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No sales in this period.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(140, data.length * 44 + 30)}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: 80, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v: unknown, name: unknown): [string, string] =>
                [typeof v === "number" ? fmtK(v) : String(v ?? ""), String(name ?? "")]}
            />
            <Bar dataKey="Revenue" radius={[0, 4, 4, 0]} maxBarSize={26}>
              {data.map((entry, i) => (
                <Cell key={i} fill={CATEGORY_COLORS[entry.category] ?? "#C7C4BD"} />
              ))}
              <LabelList
                dataKey="Revenue"
                position="right"
                formatter={(v: unknown) => fmtK(Number(v))}
                style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// ── Collection — collected (paid) vs full price card pair ─────────────────────
function CollectionCards({ paid, fullPrice }: { paid: number; fullPrice: number }) {
  const ratePct = fullPrice > 0 ? (paid / fullPrice) * 100 : null;

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-base font-semibold text-foreground mb-1">Collection</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Packages are paid in installments — collected vs full package value
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div
          className="rounded-lg border px-4 py-3"
          style={{ backgroundColor: SLIMMING_SOFT, borderColor: SLIMMING_SOFT }}
        >
          <div className="flex items-center gap-1.5 mb-1" style={{ color: SLIMMING_GREEN }}>
            <Banknote className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-wide">Collected (Paid)</p>
          </div>
          <p className="text-xl font-bold tabular-nums" style={{ color: SLIMMING_GREEN }}>
            {fmtK(paid)}
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-wide">Full Price</p>
          </div>
          <p className="text-xl font-bold text-foreground tabular-nums">{fmtK(fullPrice)}</p>
        </div>
      </div>
      {/* Collection rate */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">Collection rate</span>
          <span className="font-semibold tabular-nums" style={{ color: SLIMMING_GREEN }}>
            {ratePct != null ? `${ratePct.toFixed(0)}%` : "—"}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, ratePct ?? 0))}%`,
              backgroundColor: SLIMMING_SOFT,
            }}
          />
        </div>
      </div>
    </Card>
  );
}

// ── Page content ──────────────────────────────────────────────────────────────
function SlimmingEmployeeContent({
  slug,
  dateFrom,
  dateTo,
}: {
  slug: string;
  dateFrom: Date;
  dateTo: Date;
}) {
  const { stats, isLoading, isError, error, notFound } =
    useSalesEmployeeStats("slimming", slug, dateFrom, dateTo);

  const { prevFrom, prevTo } = useMemo(() => previousPeriod(dateFrom, dateTo), [dateFrom, dateTo]);
  const { stats: prevStats } = useSalesEmployeeStats("slimming", slug, prevFrom, prevTo);

  // 6-month longitudinal data for StreakBadge
  const { months: monthlyData, isLoading: monthlyLoading } = useSalesEmployeeMonthly("slimming", slug);

  const periodLabel = formatDateRangeLabel(dateFrom, dateTo);
  const extras = (stats?.brand_extras ?? {}) as SlimmingExtras;
  const basisLabel =
    stats?.employee.commission_basis === "inc_vat" ? "gross (paid, inc-VAT)" : "ex-VAT";
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

  return (
    <>
      {/* Breadcrumb + header */}
      <div className="space-y-1">
        <Link
          href="/sales/slimming/employees"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Slimming Employees
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            {stats?.employee.display_name ?? slug}
          </h1>
          <span
            className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: SLIMMING_SOFT, borderColor: SLIMMING_SOFT, color: SLIMMING_GREEN }}
          >
            Slimming
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
          {stats?.employee.role ?? "Sales"} · {periodLabel} · figures in {basisLabel}
        </p>
      </div>

      {/* Not found */}
      {notFound && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">
            No slimming employee found for "{slug}"
          </p>
          <Link
            href="/sales/slimming/employees"
            className="underline hover:text-foreground transition-colors"
          >
            Back to the team index
          </Link>
        </div>
      )}

      {/* Error (non-404) */}
      {isError && !notFound && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load employee stats{error ? ` — ${error}` : ""}. Try refreshing.
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <>
          <CommissionHeroSkeleton />
          <RetailTargetMeterSkeleton />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
          <div className="h-80 animate-pulse rounded-xl bg-gray-100" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
            <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
          </div>
        </>
      )}

      {/* Dashboard */}
      {!isLoading && stats && (
        <>
          <CommissionHero
            commissionService={stats.totals.commission_service}
            commissionRetail={stats.totals.commission_retail}
            commissionTotal={stats.totals.commission_total}
            commissionBonus={bonusEarned}
            serviceRate={stats.rates?.service_rate ?? 0}
            retailRate={stats.rates?.retail_rate ?? 0}
            bookingRate={stats.rates?.booking_rate ?? 0}
            spaTotalRate={stats.rates?.spa_total_rate ?? 0}
            employeeType={empType}
            ratesSet={stats.employee.rates_set}
            accentColor={SLIMMING_SOFT}
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

          {/* Breakdown tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmployeeBreakdownTable
              title="Top Programs & Treatments"
              rows={stats.service_breakdown}
            />
            <EmployeeBreakdownTable title="Products" rows={stats.retail_breakdown} />
          </div>

          {/* Slimming extras */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CategoryMixChart mix={extras.category_mix ?? []} />
            <CollectionCards
              paid={extras.collected_vs_full?.paid ?? 0}
              fullPrice={extras.collected_vs_full?.full_price ?? 0}
            />
          </div>
        </>
      )}
    </>
  );
}

// Rolling lookback enforced for non-admin users — mirrors API-side constant.
const EMPLOYEE_MAX_LOOKBACK_MONTHS = 6;

function SlimmingEmployeeDateGate({
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
      <SlimmingEmployeeContent slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
    </>
  );
}

export default function SlimmingEmployeePage({
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
          <SlimmingEmployeeDateGate slug={slug} rawDateFrom={dateFrom} dateTo={dateTo} />
        </>
      )}
    </DashboardShell>
  );
}
