"use client";

import { useQuery } from "@tanstack/react-query";
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
import { toLocalDateStr } from "@/lib/utils/dates";

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
  const from = toLocalDateStr(dateFrom);
  const to   = toLocalDateStr(dateTo);

  const { agents, isLoading } = useCrmAgents(dateFrom, dateTo);
  const { brandMap } = useLookups();
  const { data: crmDailyData, loading: crmDailyLoading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  // Authoritative revenue from brand revenue tables (spa_revenue_daily, aesthetics_sales_daily,
  // slimming_sales_daily) — same source as Sales pages and Constraint Heatmap.
  // NEVER use crm_agent_daily.total_sales for revenue display: it is agent-reported pipeline
  // value from personal tracking sheets and does NOT equal verified POS revenue.
  const { data: heatmapData } = useQuery({
    queryKey: ["crm-brand-revenue", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/funnel/constraint-heatmap?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`revenue fetch ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
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

    const totalBookings  = brandAgents.reduce((s, a) => s + a.totals.total_bookings, 0);
    const totalDeposits  = brandAgents.reduce((s, a) => s + a.totals.total_deposits, 0);
    const totalMessages  = brandAgents.reduce((s, a) => s + a.totals.total_messages, 0);

    const depositPct = totalBookings > 0 ? (totalDeposits / totalBookings) * 100 : 0;
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

    // Verified revenue from POS tables — authoritative source, matches Sales pages.
    // DO NOT use totalSales (crm_agent_daily.total_sales) for revenue display.
    const trueRevenue: number | null = heatmapData?.brands?.[slug]?.total_revenue ?? null;

    return {
      slug,
      label: BRAND_LABELS[slug],
      trueRevenue,
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
            // Bookings sourced from agent tracking sheets — count may differ from
            // GHL "Booking Won" stage if agents book contacts that land in other
            // GHL stages (e.g. Active Member). A GHL pipeline ETL is required for
            // an exact match. See AGENTS.md for the data-source rule.
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-sm text-text-secondary">Total Bookings</span>
                <div className="text-right">
                  <span className="text-sm font-bold text-foreground tabular-nums block">
                    {b.totalBookings.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">agent-tracked</span>
                </div>
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
            // Revenue sourced from POS tables (spa_revenue_daily / aesthetics_sales_daily).
            // CRM metrics (Deposit %, Conv) sourced from agent tracking sheets.
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Total Sales</span>
                <span className="text-sm font-bold text-foreground">
                  {b.trueRevenue !== null ? formatCurrency(b.trueRevenue) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Daily Average</span>
                <span className="text-sm font-semibold text-foreground">
                  {b.trueRevenue !== null ? formatCurrency(b.trueRevenue / numDays) : "—"}
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
              <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-dashed">
                Revenue from POS · Deposit &amp; Conv from agent tracking sheets
              </p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
