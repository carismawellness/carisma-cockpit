"use client";

import { Card } from "@/components/ui/card";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import {
  chartColors,
  formatCurrency,
  formatPercent,
} from "@/lib/charts/config";

const BRANDS = ["spa", "aesthetics", "slimming"] as const;
const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};
const DAILY_BOOKING_MIN = 8;
const DAILY_BOOKING_MAX = 10;

function depositColor(pct: number): string {
  if (pct >= 70) return "text-emerald-600";
  if (pct >= 50) return "text-amber-500";
  return "text-red-600";
}

function stlColor(min: number): string {
  if (min <= 3) return "text-emerald-600";
  if (min <= 5) return "text-amber-500";
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

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const numDays = Math.max(
    1,
    Math.ceil((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1,
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

    const dailyAvg    = totalSales / numDays;
    const depositPct  = totalBookings > 0 ? (totalDeposits / totalBookings) * 100 : 0;
    const convPct     = totalMessages > 0 ? (totalBookings / totalMessages) * 100 : 0;

    const bookingTarget  = Math.max(
      Math.round(totalMessages * 0.20),
      numDays * DAILY_BOOKING_MIN,
    );
    const dailyBookingRate = totalBookings / numDays;

    return {
      slug,
      label: BRAND_LABELS[slug],
      totalSales,
      dailyAvg,
      depositPct,
      convPct,
      totalBookings,
      bookingTarget,
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
            borderLeftColor:
              chartColors[b.slug as keyof typeof chartColors] ?? "#888",
          }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-4">
            {b.label}
          </h3>

          {!b.hasData ? (
            <p className="text-sm text-text-secondary">No agent data for this period.</p>
          ) : (
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
                  {formatCurrency(b.dailyAvg)}
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
                    b.convPct >= 20
                      ? "text-emerald-600"
                      : b.convPct >= 12
                      ? "text-amber-500"
                      : "text-red-600"
                  }`}
                >
                  {formatPercent(b.convPct)}
                </span>
              </div>

              {/* Booking Benchmark */}
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
                      b.dailyBookingRate >= DAILY_BOOKING_MIN
                        ? "text-emerald-600 font-semibold"
                        : "text-red-500 font-semibold"
                    }
                  >
                    {DAILY_BOOKING_MIN}–{DAILY_BOOKING_MAX}/day benchmark
                  </span>
                </div>
              </div>

              {/* Speed to Lead placeholder */}
              <div className="mt-2 pt-3 border-t border-dashed">
                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-medium mb-2">
                  Speed to Lead
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["Median", "Mean"] as const).map((label) => (
                    <div key={label} className="text-center p-2 rounded-lg bg-gray-50">
                      <p className="text-[10px] text-text-secondary mb-0.5">{label}</p>
                      <p className={`text-lg font-bold ${stlColor(0)}`}>—</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
