// app/sales/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { GroupBrandBreakdown } from "@/components/sales/GroupBrandBreakdown";
import { GroupForecastSummary } from "@/components/sales/GroupForecastSummary";
import { GroupLongitudinal } from "@/components/sales/GroupLongitudinal";
import { useGroupRevenue } from "@/lib/hooks/useGroupRevenue";
import { Building2, Sparkles, Scale, ShoppingBag } from "lucide-react";
import { SpaIntegrityBadge } from "@/components/sales/SpaIntegrityBadge";
import { SalesStrategicCommentary } from "@/components/sales/SalesStrategicCommentary";
import { computeSalesCommentary } from "@/lib/commentary/engine";

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

// Returns YoY % only when the LY baseline is large enough to be meaningful.
// Slimming opened Feb 2026, so its "LY" row contains a handful of euros at
// best — dividing by that produces +5,859% and similar nonsense. Suppress
// the badge entirely when LY < 5% of current OR LY < €500 (absolute floor
// for the smallest brands).
function calcYoY(curr: number, ly: number): number | undefined {
  if (!ly || ly < 0) return undefined;
  if (curr > 0 && ly / curr < 0.05) return undefined;
  if (ly < 500) return undefined;
  return ((curr - ly) / ly) * 100;
}

function GroupSalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const router = useRouter();
  const { period, ly, spa_locations, monthly, forecast, isFetching } = useGroupRevenue(dateFrom, dateTo);

  // Prior-period (same-length immediately-preceding window) for momentum
  // signals in the strategic commentary.
  const { priorFrom, priorTo } = useMemo(() => {
    const spanDays = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000));
    const pTo   = new Date(dateFrom.getTime() - 86_400_000);
    const pFrom = new Date(pTo.getTime() - spanDays * 86_400_000);
    return { priorFrom: pFrom, priorTo: pTo };
  }, [dateFrom, dateTo]);
  const { period: priorPeriod, isFetching: isPriorFetching } = useGroupRevenue(priorFrom, priorTo);

  const yoy = useMemo(() => ({
    total:      calcYoY(period.total,             ly.total),
    spa:        calcYoY(period.spa,               ly.spa),
    spa_retail: calcYoY(period.spa_retail ?? 0,   ly.spa_retail ?? 0),
    aesthetics: calcYoY(period.aesthetics,        ly.aesthetics),
    slimming:   calcYoY(period.slimming,          ly.slimming),
  }), [period, ly]);

  // Spa retail share of the brand — surfaces alongside the standalone retail
  // card so you can see how much of Spa revenue is product-driven at a glance.
  const retailSharePct = period.spa > 0 && period.spa_retail !== undefined
    ? (period.spa_retail / period.spa) * 100
    : null;

  // Strategic commentary — recomputed on every date-filter change.
  const commentary = useMemo(() => {
    const periodLabel = `${dateFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${dateTo.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    const revenuePopPct = priorPeriod.total > 0
      ? ((period.total - priorPeriod.total) / priorPeriod.total) * 100
      : null;
    // Top-brand concentration = max brand share %.
    const brandShares = period.total > 0
      ? [period.spa, period.aesthetics, period.slimming].map((v) => (v / period.total) * 100)
      : [];
    const topBrandSharePct = brandShares.length > 0 ? Math.max(...brandShares) : null;
    const spaRetailAttachPct = period.total > 0 && period.spa_retail !== undefined
      ? (period.spa_retail / period.total) * 100
      : null;
    return computeSalesCommentary({
      scope:               "group",
      periodRevenue:       period.total,
      periodLabel,
      revenueYoyPct:       yoy.total ?? null,
      revenuePopPct,
      spaRetailAttachPct,
      topBrandSharePct,
    });
  }, [dateFrom, dateTo, period, priorPeriod, yoy.total]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Group Sales</h1>
          <p className="text-xs text-muted-foreground mt-0.5">All brands · Gross (inc-VAT) · Source: Cockpit Datasheet</p>
        </div>
        <SpaIntegrityBadge dateFrom={dateFrom} dateTo={dateTo} />
      </div>

      <SalesKPIGrid columns={5}>
        <div className="h-full">
          <SalesKPICard
            label="Group Revenue"
            value={isFetching ? "—" : fmtK(period.total)}
            subtitle="Spa + Aesthetics + Slimming"
            yoyChange={isFetching ? undefined : yoy.total}
          />
        </div>
        <button
          type="button"
          className="h-full text-left cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => router.push("/sales/spa")}
          aria-label="View Spa dashboard"
        >
          <SalesKPICard
            label="Spa Revenue"
            value={isFetching ? "—" : fmtK(period.spa)}
            subtitle="8 locations"
            yoyChange={isFetching ? undefined : yoy.spa}
            icon={Building2}
          />
        </button>
        <button
          type="button"
          className="h-full text-left cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => router.push("/sales/aesthetics")}
          aria-label="View Aesthetics dashboard"
        >
          <SalesKPICard
            label="Aesthetics Revenue"
            value={isFetching ? "—" : fmtK(period.aesthetics)}
            subtitle="Single location"
            yoyChange={isFetching ? undefined : yoy.aesthetics}
            icon={Sparkles}
          />
        </button>
        <button
          type="button"
          className="h-full text-left cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => router.push("/sales/slimming")}
          aria-label="View Slimming dashboard"
        >
          <SalesKPICard
            label="Slimming Revenue"
            value={isFetching ? "—" : fmtK(period.slimming)}
            subtitle="Launched Feb 2026 · No LY baseline"
            yoyChange={isFetching ? undefined : yoy.slimming}
            icon={Scale}
          />
        </button>
        {/* Retail revenue callout — subset of Spa, not exclusive. Linked to the
            Spa Retail drill-down for full breakdown. */}
        <button
          type="button"
          className="h-full text-left cursor-pointer rounded-2xl focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => router.push("/sales/spa/retail")}
          aria-label="View Spa retail dashboard"
        >
          <SalesKPICard
            label="Spa Retail"
            value={isFetching ? "—" : fmtK(period.spa_retail ?? 0)}
            subtitle={
              isFetching
                ? "—"
                : retailSharePct != null
                  ? `${retailSharePct.toFixed(1)}% of Spa revenue`
                  : "Subset of Spa"
            }
            yoyChange={isFetching ? undefined : yoy.spa_retail}
            icon={ShoppingBag}
          />
        </button>
      </SalesKPIGrid>

      <SalesStrategicCommentary
        result={commentary}
        loading={isFetching || isPriorFetching}
      />

      <GroupBrandBreakdown
        period={period}
        ly={ly}
        spaLocations={spa_locations}
        isFetching={isFetching}
      />

      <GroupForecastSummary
        forecast={forecast}
        isFetching={isFetching}
      />

      <GroupLongitudinal
        monthly={monthly}
        forecast={forecast}
        isFetching={isFetching}
      />
    </div>
  );
}

export default function GroupSalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <GroupSalesContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
