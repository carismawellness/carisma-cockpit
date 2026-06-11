"use client";

import { Card } from "@/components/ui/card";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import {
  formatCurrency,
  formatPercent,
} from "@/lib/charts/config";
import type { CrmDailyRow } from "@/lib/types/crm";
import {
  countExcludedCrmDatesInRange,
  isExcludedCrmDate,
} from "@/lib/constants/excluded-dates";
import { BRAND } from "@/lib/constants/design-tokens";

// Canonical brand palette — `soft` for left-border accents.
const BRAND_BORDER: Record<string, string> = {
  spa:        BRAND.spa.soft,
  aesthetics: BRAND.aesthetics.soft,
  slimming:   BRAND.slimming.soft,
};

const BRANDS = ["spa", "aesthetics", "slimming"] as const;
const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};
const DAILY_BOOKING_MIN = 8;
const SLIMMING_DAILY_TARGET = 15;

function depositColor(pct: number): string {
  if (pct >= 70) return "text-emerald-600";
  if (pct >= 50) return "text-amber-500";
  return "text-red-600";
}

export function SalesPerformance({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading } = useCrmAgents(dateFrom, dateTo);
  const { brandMap } = useLookups();
  const { data: crmDailyData, loading: crmDailyLoading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  if (isLoading || crmDailyLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const calendarDays = Math.ceil(
    (dateTo.getTime() - dateFrom.getTime()) / 86_400_000,
  ) + 1;
  const numDays = Math.max(
    1,
    calendarDays - countExcludedCrmDatesInRange(dateFrom, dateTo),
  );

  const visibleBrands = brandFilter
    ? BRANDS.filter((b) => b === brandFilter)
    : [...BRANDS];

  const brandCards = visibleBrands.map((slug) => {
    const brandAgents = agents.filter((a) => {
      const meta = AGENT_META_BY_SLUG[a.slug];
      return meta && meta.brand.toLowerCase() === slug;
    });

    const totalSales     = brandAgents.reduce((s, a) => s + a.totals.total_sales,    0);
    const totalBookings  = brandAgents.reduce((s, a) => s + a.totals.total_bookings, 0);
    const totalDeposits  = brandAgents.reduce((s, a) => s + a.totals.total_deposits, 0);
    const totalMessages  = brandAgents.reduce((s, a) => s + a.totals.total_messages, 0);

    const dailyAvgRevenue = totalSales / numDays;
    const depositPct      = totalBookings > 0 ? (totalDeposits / totalBookings) * 100 : 0;
    const convMsgPct      = totalMessages > 0 ? (totalBookings / totalMessages) * 100 : 0;

    // Slimming: conv over leads from crm_daily (excluding migration days)
    const brandId = brandMap[slug];
    const totalLeads = slug === "slimming"
      ? crmDailyData
          .filter((r) => r.brand_id === brandId && !isExcludedCrmDate(r.date))
          .reduce((sum, r) => sum + (r.total_leads ?? 0), 0)
      : 0;
    const convLeadsPct = totalLeads > 0 ? (totalBookings / totalLeads) * 100 : 0;

    const bookingTargetBase = slug === "slimming"
      ? numDays * SLIMMING_DAILY_TARGET
      : Math.max(Math.round(totalMessages * 0.20), numDays * DAILY_BOOKING_MIN);

    const dailyBookingRate = totalBookings / numDays;

    return {
      slug,
      label: BRAND_LABELS[slug],
      totalSales,
      dailyAvgRevenue,
      depositPct,
      convMsgPct,
      convLeadsPct,
      totalBookings,
      bookingTarget: bookingTargetBase,
      dailyBookingRate,
      hasData: brandAgents.length > 0,
    };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {brandCards.map((b) => (
        <Card
          key={b.slug}
          className="p-5 border-l-4"
          style={{
            borderLeftColor: BRAND_BORDER[b.slug] ?? "#888",
          }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-4">
            {b.label}
          </h3>

          {!b.hasData ? (
            <p className="text-sm text-text-secondary">No agent data for this period.</p>
          ) : b.slug === "slimming" ? (
            // ── Slimming card ────────────────────────────────────────────────
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Total Bookings</span>
                <span className="text-sm font-bold text-foreground tabular-nums">
                  {b.totalBookings.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Avg Bookings / Day</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {b.dailyBookingRate.toFixed(1)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Conv / Leads</span>
                <span
                  className={`text-sm font-bold ${
                    b.convLeadsPct >= 20
                      ? "text-emerald-600"
                      : b.convLeadsPct >= 12
                      ? "text-amber-500"
                      : "text-red-600"
                  }`}
                >
                  {formatPercent(b.convLeadsPct)}
                </span>
              </div>

              {/* Appointments Booked — Slimming, 15/day target */}
              <div className="mt-2 pt-3 border-t border-dashed">
                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-medium mb-2">
                  Appointments Booked
                </p>
                <div className="flex justify-between items-baseline mb-1">
                  <span
                    className={`text-lg font-bold ${
                      b.totalBookings >= b.bookingTarget
                        ? "text-emerald-600"
                        : b.totalBookings >= b.bookingTarget * 0.8
                        ? "text-amber-500"
                        : "text-red-600"
                    }`}
                  >
                    {b.totalBookings}
                  </span>
                  <span className="text-xs text-text-secondary">
                    / {b.bookingTarget} target
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                  <div
                    className={`h-full rounded-full transition-all ${
                      b.totalBookings >= b.bookingTarget
                        ? "bg-emerald-500"
                        : b.totalBookings >= b.bookingTarget * 0.8
                        ? "bg-amber-500"
                        : "bg-red-500"
                    }`}
                    style={{
                      width: `${Math.min((b.totalBookings / Math.max(b.bookingTarget, 1)) * 100, 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-text-secondary">
                  <span>{b.dailyBookingRate.toFixed(1)}/day avg</span>
                  <span
                    className={
                      b.dailyBookingRate >= SLIMMING_DAILY_TARGET
                        ? "text-emerald-600 font-semibold"
                        : "text-red-500 font-semibold"
                    }
                  >
                    {SLIMMING_DAILY_TARGET}/day target
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // ── Spa & Aesthetics card ────────────────────────────────────────
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Total Sales</span>
                <span className="text-sm font-bold text-foreground">
                  {formatCurrency(b.totalSales)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Daily Average</span>
                <span className="text-sm font-semibold text-foreground">
                  {formatCurrency(b.dailyAvgRevenue)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Deposit %</span>
                <span className={`text-sm font-bold ${depositColor(b.depositPct)}`}>
                  {formatPercent(b.depositPct)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Conv / Messages</span>
                <span
                  className={`text-sm font-bold ${
                    b.convMsgPct >= 20
                      ? "text-emerald-600"
                      : b.convMsgPct >= 12
                      ? "text-amber-500"
                      : "text-red-600"
                  }`}
                >
                  {formatPercent(b.convMsgPct)}
                </span>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
