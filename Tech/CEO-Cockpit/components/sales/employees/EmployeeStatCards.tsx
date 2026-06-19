"use client";

import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { Euro, Sparkles, ShoppingBag, Receipt, Gauge, CalendarDays } from "lucide-react";
import type { EmployeeStatsTotals } from "@/lib/sales-employees/types";
import { deltaPct } from "@/lib/utils/period-comparison";

export interface EmployeeStatCardsProps {
  totals: EmployeeStatsTotals;
  basisLabel?: string;
  /** Previous period totals — when provided, "vs last period" delta badges are shown */
  prevTotals?: EmployeeStatsTotals;
}

function fmtEur(v: number): string {
  if (!Number.isFinite(v)) return "€0";
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

export function EmployeeStatCards({ totals, basisLabel = "ex-VAT", prevTotals }: EmployeeStatCardsProps) {
  const pct = (part: number) =>
    totals.total_revenue > 0 ? `${((part / totals.total_revenue) * 100).toFixed(1)}% of total` : undefined;

  const d = (cur: number, prev: number | undefined) =>
    prev !== undefined ? deltaPct(cur, prev) : undefined;

  const avgRetailTicket = totals.retail_tx > 0 ? totals.retail_revenue / totals.retail_tx : 0;
  const prevAvgRetailTicket =
    prevTotals && prevTotals.retail_tx > 0 ? prevTotals.retail_revenue / prevTotals.retail_tx : 0;

  const dailyRevenue = totals.active_days > 0 ? totals.total_revenue / totals.active_days : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
      <SalesKPICard
        label="Total Revenue"
        value={fmtEur(totals.total_revenue)}
        subtitle={basisLabel}
        icon={Euro}
        yoyChange={d(totals.total_revenue, prevTotals?.total_revenue)}
        yoyLabel="vs last period"
      />
      <SalesKPICard
        label="Service Revenue"
        value={fmtEur(totals.service_revenue)}
        subtitle={pct(totals.service_revenue)}
        icon={Sparkles}
        yoyChange={d(totals.service_revenue, prevTotals?.service_revenue)}
        yoyLabel="vs last period"
      />
      <SalesKPICard
        label="Retail Revenue"
        value={fmtEur(totals.retail_revenue)}
        subtitle={pct(totals.retail_revenue)}
        icon={ShoppingBag}
        yoyChange={d(totals.retail_revenue, prevTotals?.retail_revenue)}
        yoyLabel="vs last period"
      />
      <SalesKPICard
        label="Avg Retail Ticket"
        value={fmtEur(avgRetailTicket)}
        subtitle="per retail tx"
        icon={Gauge}
        yoyChange={prevTotals ? d(avgRetailTicket, prevAvgRetailTicket) : undefined}
        yoyLabel="vs last period"
      />
      <SalesKPICard
        label="Daily Revenue"
        value={fmtEur(dailyRevenue)}
        subtitle="per active day"
        icon={CalendarDays}
      />
      <SalesKPICard
        label="Commission"
        value={fmtEur(totals.commission_total)}
        subtitle="this period"
        icon={Receipt}
        yoyChange={d(totals.commission_total, prevTotals?.commission_total)}
        yoyLabel="vs last period"
      />
    </div>
  );
}
