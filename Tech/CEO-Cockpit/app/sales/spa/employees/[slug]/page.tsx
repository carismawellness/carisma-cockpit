"use client";

// Spa — personal sales-employee dashboard.

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSalesEmployeeStats } from "@/lib/hooks/useSalesEmployeeStats";
import { useSalesEmployees } from "@/lib/hooks/useSalesEmployees";
import { useSalesEmployeeMonthly } from "@/lib/hooks/useSalesEmployeeMonthly";
import { useIsAdmin } from "@/lib/hooks/useIsAdmin";
import { CommissionHero, CommissionHeroSkeleton } from "@/components/sales/employees/CommissionHero";
import { RetailTargetMeter, RetailTargetMeterSkeleton } from "@/components/sales/employees/RetailTargetMeter";
import { PerformanceCommentary } from "@/components/sales/employees/PerformanceCommentary";
import { LocationReviewsCard } from "@/components/sales/employees/LocationReviewsCard";
import { EmployeeStatCards } from "@/components/sales/employees/EmployeeStatCards";
import { EmployeeTrendChart } from "@/components/sales/employees/EmployeeTrendChart";
import { EmployeeBreakdownTable } from "@/components/sales/employees/EmployeeBreakdownTable";
import { PaceAlert } from "@/components/sales/employees/PaceAlert";
import { StreakBadge, StreakTooltip } from "@/components/sales/employees/StreakBadge";
import { PeerRankBadge } from "@/components/sales/employees/PeerRankBadge";
import { useEmployeeCoachingTip } from "@/lib/hooks/useEmployeeCoachingTip";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { previousPeriod } from "@/lib/utils/period-comparison";
import { BRAND } from "@/lib/constants/design-tokens";
import type { EmployeeType } from "@/lib/sales-employees/types";
import { AlertCircle, Calendar, ChevronLeft, ChevronRight, Lock, MapPin } from "lucide-react";

function _pad(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

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

  // 6-month longitudinal data for StreakBadge
  const { months: monthlyData, isLoading: monthlyLoading } = useSalesEmployeeMonthly("spa", slug);

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

  // Spa extra: revenue by location — used for locationId fallback (no chart rendered)
  const byLocation = useMemo<LocationRevenue[]>(() => {
    const raw = (stats?.brand_extras as { by_location?: LocationRevenue[] } | undefined)
      ?.by_location;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && typeof l.revenue === "number" && l.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [stats?.brand_extras]);

  // Derive locationId: prefer DB column, fallback to byLocation reverse map
  const LOCATION_REVERSE: Record<string, number> = {
    Inter: 1, Hugos: 2, Hyatt: 3, Ramla: 4, Riviera: 5,
    Odycy: 6, Excelsior: 7, Novotel: 8,
  };
  const locationId = useMemo(
    () =>
      stats?.employee.location_id ??
      (byLocation[0]?.name ? (LOCATION_REVERSE[byLocation[0].name] ?? null) : null),
    [stats?.employee.location_id, byLocation],
  );

  // Total days in the selected period (for PaceAlert pace calculation)
  const periodDays = useMemo(() => {
    const diff = dateTo.getTime() - dateFrom.getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
  }, [dateFrom, dateTo]);

  // Retail tier bonus: €100 per €800 earned in retail sales this period
  const RETAIL_TIER_SIZE   = 800;
  const RETAIL_BONUS_EACH  = 100;
  const bonusEarned     = stats  ? Math.floor(stats.totals.retail_revenue  / RETAIL_TIER_SIZE) * RETAIL_BONUS_EACH : 0;
  const prevBonusEarned = prevStats ? Math.floor(prevStats.totals.retail_revenue / RETAIL_TIER_SIZE) * RETAIL_BONUS_EACH : 0;

  // All-time best commission from 6-month history + current period (includes bonus)
  const allTimeBestCommission = useMemo(() => {
    const all = [...monthlyData.map((m) => m.total_commission)];
    if (stats) all.push(stats.totals.commission_total + bonusEarned);
    return all.length > 0 ? Math.max(...all) : 0;
  }, [monthlyData, stats, bonusEarned]);

  // Daily AI coaching tip from Claude Haiku (cached per day in Supabase)
  const tipParams = stats ? {
    slug,
    brand: "spa",
    from: toDateStr(dateFrom),
    to: toDateStr(dateTo),
    commissionTotal: stats.totals.commission_total,
    retailRevenue: stats.totals.retail_revenue,
    avgTicket: stats.totals.avg_ticket,
    activeDays: stats.totals.active_days,
    prevCommissionTotal: prevStats?.totals.commission_total,
  } : null;
  const { data: aiTip } = useEmployeeCoachingTip(tipParams);

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
          {/* Strategic performance commentary (+ daily AI coaching insight) */}
          <PerformanceCommentary
            employeeName={stats.employee.display_name}
            commissionTotal={stats.totals.commission_total}
            retailRevenue={stats.totals.retail_revenue}
            retailTarget={800}
            totalRevenue={stats.totals.total_revenue}
            avgTicket={stats.totals.avg_ticket}
            activeDays={stats.totals.active_days}
            prevCommissionTotal={prevStats?.totals.commission_total}
            periodLabel={periodLabel}
            aiTip={aiTip ?? undefined}
          />

          <CommissionHero
            commissionService={stats.totals.commission_service}
            commissionRetail={stats.totals.commission_retail}
            commissionTotal={stats.totals.commission_total}
            commissionBooking={0}
            commissionBonus={bonusEarned}
            serviceRate={stats.rates?.service_rate ?? 0}
            retailRate={stats.rates?.retail_rate ?? 0}
            ratesSet={stats.employee.rates_set}
            accentColor={BRAND.spa.soft}
            periodLabel={periodLabel}
            prevCommissionTotal={prevStats?.totals.commission_total}
            prevCommissionService={prevStats?.totals.commission_service}
            prevCommissionRetail={prevStats?.totals.commission_retail}
            prevCommissionBooking={0}
            prevCommissionBonus={prevBonusEarned}
            allTimeBestCommission={allTimeBestCommission}
          />

          {/* Peer rank badge (anonymous — shows position among all spa therapists) */}
          <div className="flex justify-end -mt-2">
            <PeerRankBadge brand="spa" slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
          </div>

          {/* Catch-up pace alert — shown when behind last period's trajectory */}
          <PaceAlert
            commissionTotal={stats.totals.commission_total}
            prevCommissionTotal={prevStats?.totals.commission_total}
            activeDays={stats.totals.active_days}
            periodDays={periodDays}
            avgTicketEur={stats.totals.avg_ticket}
            serviceRate={stats.rates?.service_rate ?? 0.03}
          />

          {/* Retail target tracker — only for therapists who sell retail */}
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

          {/* Service + retail breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EmployeeBreakdownTable title="Top Services" rows={stats.service_breakdown} />
            <EmployeeBreakdownTable title="Top Retail Products" rows={stats.retail_breakdown} />
          </div>

          {/* Google Reviews for this employee's location */}
          <LocationReviewsCard
            locationId={locationId}
            locationName={locationName}
          />
        </>
      )}
    </>
  );
}

// Rolling lookback enforced for non-admin users — mirrors API-side constant.
const EMPLOYEE_MAX_LOOKBACK_MONTHS = 6;

function SpaEmployeeDateGate({
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
      <SpaEmployeeContent slug={slug} dateFrom={dateFrom} dateTo={dateTo} />
    </>
  );
}

export default function SpaEmployeePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  // Month state: { year, month } (month is 1-based)
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1); // 1-based

  // Compute dateFrom / dateTo from selected month
  const { dateFrom, dateTo } = useMemo(() => {
    const from = new Date(selectedYear, selectedMonth - 1, 1);
    const isCurrentMonth =
      selectedYear === today.getFullYear() && selectedMonth === (today.getMonth() + 1);
    const to = isCurrentMonth
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
      : new Date(selectedYear, selectedMonth, 0); // last day of selectedMonth
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
    const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    // Don't allow navigating past current month
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
          <SpaEmployeeDateGate slug={slug} rawDateFrom={dateFrom} dateTo={dateTo} />
        </>
      )}
    </DashboardShell>
  );
}
