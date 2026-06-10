"use client";

// Grid of small stat cards for an employee dashboard — reuses SalesKPICard
// so the look matches the brand sales pages.

import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { Euro, Sparkles, ShoppingBag, Receipt, Gauge, CalendarDays } from "lucide-react";
import type { EmployeeStatsTotals } from "@/lib/sales-employees/types";

export interface EmployeeStatCardsProps {
  totals: EmployeeStatsTotals;
  /** e.g. "ex-VAT" | "inc-VAT" — shown in subtitles for clarity */
  basisLabel?: string;
}

function fmtEur(v: number): string {
  if (!Number.isFinite(v)) return "€0";
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

export function EmployeeStatCards({ totals, basisLabel = "ex-VAT" }: EmployeeStatCardsProps) {
  const pct = (part: number) =>
    totals.total_revenue > 0 ? `${((part / totals.total_revenue) * 100).toFixed(1)}% of total` : undefined;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
      <SalesKPICard
        label="Total Revenue"
        value={fmtEur(totals.total_revenue)}
        subtitle={basisLabel}
        icon={Euro}
      />
      <SalesKPICard
        label="Service Revenue"
        value={fmtEur(totals.service_revenue)}
        subtitle={pct(totals.service_revenue)}
        icon={Sparkles}
      />
      <SalesKPICard
        label="Retail Revenue"
        value={fmtEur(totals.retail_revenue)}
        subtitle={pct(totals.retail_revenue)}
        icon={ShoppingBag}
      />
      <SalesKPICard
        label="Transactions"
        value={String(totals.total_tx)}
        subtitle={`${totals.service_tx} service · ${totals.retail_tx} retail`}
        icon={Receipt}
      />
      <SalesKPICard
        label="Avg Ticket"
        value={fmtEur(totals.avg_ticket)}
        subtitle="per transaction"
        icon={Gauge}
      />
      <SalesKPICard
        label="Active Days"
        value={String(totals.active_days)}
        subtitle="days with sales"
        icon={CalendarDays}
      />
    </div>
  );
}
