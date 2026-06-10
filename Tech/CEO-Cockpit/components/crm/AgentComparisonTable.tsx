"use client";

import { Fragment } from "react";
import Link from "next/link";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";
import {
  AGENT_META_BY_SLUG,
  BRAND_ORDER,
  type AgentBrand,
} from "@/lib/constants/agents";

interface AgentComparisonTableProps {
  agents: CrmAgent[];
}

// ── Targets ───────────────────────────────────────────────────────────────────

const BOOKING_RATE_TARGET = 25;
const DEPOSIT_TARGET      = 70;

// ── Cell colour helpers ───────────────────────────────────────────────────────

function bookingRateClass(val: number, inactive: boolean): string {
  if (inactive || val === 0) return "text-muted-foreground";
  return val >= BOOKING_RATE_TARGET ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold";
}

function depositClass(val: number, inactive: boolean): string {
  if (inactive || val === 0) return "text-muted-foreground";
  return val >= DEPOSIT_TARGET ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold";
}

// ── Brand label colours ───────────────────────────────────────────────────────

const BRAND_STYLE: Record<AgentBrand, string> = {
  SPA:        "bg-sky-50 text-sky-700",
  AESTHETICS: "bg-violet-50 text-violet-700",
  SLIMMING:   "bg-teal-50 text-teal-700",
};

// ── Subtotal helper ───────────────────────────────────────────────────────────

interface GroupTotals {
  total_sales:    number;
  total_bookings: number;
  total_deposits: number;
  total_messages: number;
}

function groupTotals(agents: CrmAgent[]): GroupTotals {
  return {
    total_sales:    agents.reduce((s, a) => s + a.totals.total_sales,    0),
    total_bookings: agents.reduce((s, a) => s + a.totals.total_bookings, 0),
    total_deposits: agents.reduce((s, a) => s + a.totals.total_deposits, 0),
    total_messages: agents.reduce((s, a) => s + a.totals.total_messages, 0),
  };
}

function depositRate(deposits: number, bookings: number): number {
  return bookings > 0 ? (deposits / bookings) * 100 : 0;
}

function groupAvgBkgEff(agents: CrmAgent[]): number {
  const vals = agents.map((a) => a.totals.avg_booking_eff).filter((v) => v > 0);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

function groupAvgBkgRate(agents: CrmAgent[]): number {
  const vals = agents.map((a) => a.totals.avg_booking_rate).filter((v) => v > 0);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentComparisonTable({ agents }: AgentComparisonTableProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  // Group agents by brand in the defined order
  const byBrand: Record<AgentBrand, CrmAgent[]> = {
    SPA: [], AESTHETICS: [], SLIMMING: [],
  };

  for (const agent of agents) {
    const meta = AGENT_META_BY_SLUG[agent.slug];
    if (meta) byBrand[meta.brand].push(agent);
  }

  // Within each brand, sort active first then by total_sales desc
  for (const brand of BRAND_ORDER) {
    byBrand[brand].sort((a, b) => {
      const aMeta = AGENT_META_BY_SLUG[a.slug];
      const bMeta = AGENT_META_BY_SLUG[b.slug];
      if (aMeta?.inactive !== bMeta?.inactive) return aMeta?.inactive ? 1 : -1;
      return b.totals.total_sales - a.totals.total_sales;
    });
  }

  const grandTotals = groupTotals(agents);

  let rowIndex = 0;

  const COLS = 9; // # | Rep | Role | Revenue | Dials | Bookings | Deposits | Bkg Eff | Bkg Rate | Deposit %

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Team Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="w-6 pb-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">#</th>
                <th className="pb-2 pl-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rep</th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dials</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bookings</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deposits</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bkg Eff</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bkg Rate</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deposit %</th>
              </tr>
            </thead>
            <tbody>
              {BRAND_ORDER.map((brand) => {
                const brandAgents = byBrand[brand];
                if (brandAgents.length === 0) return null;
                const bt = groupTotals(brandAgents);
                const bt_bkgEff      = groupAvgBkgEff(brandAgents);
                const bt_bkgRate     = groupAvgBkgRate(brandAgents);
                const bt_depositRate = depositRate(bt.total_deposits, bt.total_bookings);

                return (
                  <Fragment key={brand}>
                    {/* Brand section header */}
                    <tr>
                      <td
                        colSpan={COLS + 1}
                        className={`py-1.5 pl-2 text-xs font-bold uppercase tracking-widest ${BRAND_STYLE[brand]}`}
                      >
                        {brand}
                      </td>
                    </tr>

                    {/* Agent rows */}
                    {brandAgents.map((agent) => {
                      const meta     = AGENT_META_BY_SLUG[agent.slug];
                      const inactive = meta?.inactive ?? false;
                      rowIndex += 1;
                      const num = rowIndex;

                      const rowBase = inactive ? "opacity-50" : "hover:bg-gray-50";
                      const t = agent.totals;
                      const bkgEff   = t.avg_booking_eff > 0 ? t.avg_booking_eff : 0;
                      const bkgRate  = t.avg_booking_rate;
                      const depositPct = depositRate(t.total_deposits, t.total_bookings);

                      return (
                        <tr
                          key={agent.slug}
                          className={`border-b border-gray-100 transition-colors ${rowBase}`}
                        >
                          <td className="py-2 text-center text-xs text-muted-foreground">{num}</td>
                          <td className="py-2 pl-2 font-medium text-foreground">
                            <Link
                              href={`/crm/individual/${agent.slug}`}
                              className="hover:underline"
                            >
                              {agent.name}
                            </Link>
                          </td>
                          <td className="py-2 text-xs text-muted-foreground">
                            {inactive ? <span className="italic">INACTIVE</span> : (meta?.role ?? "—")}
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums text-foreground">
                            {formatCurrency(t.total_sales)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {t.total_messages.toLocaleString()}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {t.total_bookings}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {t.total_deposits}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${bookingRateClass(bkgEff, inactive)}`}>
                            {bkgEff > 0 ? formatPercent(bkgEff) : "—"}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${bookingRateClass(bkgRate, inactive)}`}>
                            {bkgRate > 0 ? formatPercent(bkgRate) : "—"}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${depositClass(depositPct, inactive)}`}>
                            {depositPct > 0 ? formatPercent(depositPct) : "—"}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Brand subtotal */}
                    <tr className="border-b-2 border-gray-300 bg-gray-50 font-semibold">
                      <td className="py-1.5" />
                      <td colSpan={2} className="py-1.5 pl-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {brand} Total
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatCurrency(bt.total_sales)}</td>
                      <td className="py-1.5 text-right tabular-nums">{bt.total_messages.toLocaleString()}</td>
                      <td className="py-1.5 text-right tabular-nums">{bt.total_bookings}</td>
                      <td className="py-1.5 text-right tabular-nums">{bt.total_deposits}</td>
                      <td className={`py-1.5 text-right tabular-nums ${bookingRateClass(bt_bkgEff, false)}`}>
                        {bt_bkgEff > 0 ? formatPercent(bt_bkgEff) : "—"}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${bookingRateClass(bt_bkgRate, false)}`}>
                        {bt_bkgRate > 0 ? formatPercent(bt_bkgRate) : "—"}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${depositClass(bt_depositRate, false)}`}>
                        {bt_depositRate > 0 ? formatPercent(bt_depositRate) : "—"}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}

              {/* Grand total */}
              {(() => {
                const g_bkgEff      = groupAvgBkgEff(agents);
                const g_bkgRate     = groupAvgBkgRate(agents);
                const g_depositRate = depositRate(grandTotals.total_deposits, grandTotals.total_bookings);
                return (
                  <tr className="bg-gray-100 font-bold">
                    <td className="py-2" />
                    <td colSpan={2} className="py-2 pl-2 text-xs uppercase tracking-wide text-foreground">
                      Grand Total
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(grandTotals.total_sales)}</td>
                    <td className="py-2 text-right tabular-nums">{grandTotals.total_messages.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{grandTotals.total_bookings}</td>
                    <td className="py-2 text-right tabular-nums">{grandTotals.total_deposits}</td>
                    <td className={`py-2 text-right tabular-nums ${bookingRateClass(g_bkgEff, false)}`}>
                      {g_bkgEff > 0 ? formatPercent(g_bkgEff) : "—"}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${bookingRateClass(g_bkgRate, false)}`}>
                      {g_bkgRate > 0 ? formatPercent(g_bkgRate) : "—"}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${depositClass(g_depositRate, false)}`}>
                      {g_depositRate > 0 ? formatPercent(g_depositRate) : "—"}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
