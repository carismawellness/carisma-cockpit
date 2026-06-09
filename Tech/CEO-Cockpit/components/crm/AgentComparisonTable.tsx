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

const CONV_TARGET    = 25;
const DEPOSIT_TARGET = 70;

// ── Cell colour helpers ───────────────────────────────────────────────────────

function convClass(val: number, inactive: boolean): string {
  if (inactive || val === 0) return "text-muted-foreground";
  return val >= CONV_TARGET ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold";
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
  avg_conv:       number;
  avg_deposit:    number;
}

function groupTotals(agents: CrmAgent[]): GroupTotals {
  const active = agents.filter((a) => a.totals.active_days > 0);
  return {
    total_sales:    agents.reduce((s, a) => s + a.totals.total_sales,    0),
    total_bookings: agents.reduce((s, a) => s + a.totals.total_bookings, 0),
    total_deposits: agents.reduce((s, a) => s + a.totals.total_deposits, 0),
    total_messages: agents.reduce((s, a) => s + a.totals.total_messages, 0),
    avg_conv:    active.length ? active.reduce((s, a) => s + a.totals.avg_conversion_rate, 0) / active.length : 0,
    avg_deposit: active.length ? active.reduce((s, a) => s + a.totals.avg_deposit_pct,     0) / active.length : 0,
  };
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
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messages</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bookings</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deposits</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conv %</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dep %</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">AOV</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active Days</th>
              </tr>
            </thead>
            <tbody>
              {BRAND_ORDER.map((brand) => {
                const brandAgents = byBrand[brand];
                if (brandAgents.length === 0) return null;
                const bt = groupTotals(brandAgents);

                return (
                  <Fragment key={brand}>
                    {/* Brand section header */}
                    <tr>
                      <td
                        colSpan={11}
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

                      const rowBase = inactive
                        ? "opacity-50"
                        : "hover:bg-gray-50";

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
                          <td className="py-2 text-xs text-muted-foreground">{meta?.role ?? "—"}</td>
                          <td className="py-2 text-right font-semibold tabular-nums text-foreground">
                            {formatCurrency(agent.totals.total_sales)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {agent.totals.total_messages.toLocaleString()}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {agent.totals.total_bookings}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {agent.totals.total_deposits}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${convClass(agent.totals.avg_conversion_rate, inactive)}`}>
                            {agent.totals.avg_conversion_rate > 0
                              ? formatPercent(agent.totals.avg_conversion_rate)
                              : "—"}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${depositClass(agent.totals.avg_deposit_pct, inactive)}`}>
                            {agent.totals.avg_deposit_pct > 0
                              ? formatPercent(agent.totals.avg_deposit_pct)
                              : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {agent.totals.avg_aov > 0 ? formatCurrency(agent.totals.avg_aov) : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-foreground">
                            {agent.totals.active_days}
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
                      <td className={`py-1.5 text-right tabular-nums ${convClass(bt.avg_conv, false)}`}>
                        {bt.avg_conv > 0 ? formatPercent(bt.avg_conv) : "—"}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${depositClass(bt.avg_deposit, false)}`}>
                        {bt.avg_deposit > 0 ? formatPercent(bt.avg_deposit) : "—"}
                      </td>
                      <td className="py-1.5" />
                      <td className="py-1.5" />
                    </tr>
                  </Fragment>
                );
              })}

              {/* Grand total */}
              <tr className="bg-gray-100 font-bold">
                <td className="py-2" />
                <td colSpan={2} className="py-2 pl-2 text-xs uppercase tracking-wide text-foreground">
                  Grand Total
                </td>
                <td className="py-2 text-right tabular-nums">{formatCurrency(grandTotals.total_sales)}</td>
                <td className="py-2 text-right tabular-nums">{grandTotals.total_messages.toLocaleString()}</td>
                <td className="py-2 text-right tabular-nums">{grandTotals.total_bookings}</td>
                <td className="py-2 text-right tabular-nums">{grandTotals.total_deposits}</td>
                <td className={`py-2 text-right tabular-nums ${convClass(grandTotals.avg_conv, false)}`}>
                  {grandTotals.avg_conv > 0 ? formatPercent(grandTotals.avg_conv) : "—"}
                </td>
                <td className={`py-2 text-right tabular-nums ${depositClass(grandTotals.avg_deposit, false)}`}>
                  {grandTotals.avg_deposit > 0 ? formatPercent(grandTotals.avg_deposit) : "—"}
                </td>
                <td className="py-2" />
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
