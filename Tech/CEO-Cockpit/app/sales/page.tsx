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
import { Building2, Sparkles, Scale } from "lucide-react";

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function calcYoY(curr: number, ly: number): number | undefined {
  if (!ly) return undefined;
  return ((curr - ly) / ly) * 100;
}

function GroupSalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const router = useRouter();
  const { period, ly, spa_locations, monthly, forecast, isFetching } = useGroupRevenue(dateFrom, dateTo);

  const yoy = useMemo(() => ({
    total:      calcYoY(period.total,      ly.total),
    spa:        calcYoY(period.spa,        ly.spa),
    aesthetics: calcYoY(period.aesthetics, ly.aesthetics),
    slimming:   calcYoY(period.slimming,   ly.slimming),
  }), [period, ly]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Group Sales</h1>
        <p className="text-xs text-muted-foreground mt-0.5">All brands · Gross (inc-VAT) · Source: Cockpit Datasheet</p>
      </div>

      <SalesKPIGrid columns={4}>
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
            subtitle="Single location"
            yoyChange={isFetching ? undefined : yoy.slimming}
            icon={Scale}
          />
        </button>
      </SalesKPIGrid>

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
