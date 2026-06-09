"use client";

import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

interface AgentComparisonTableProps {
  agents: CrmAgent[];
}

export function AgentComparisonTable({ agents }: AgentComparisonTableProps) {
  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const sorted = [...agents].sort(
    (a, b) => b.totals.total_sales - a.totals.total_sales
  );
  const topSlug = sorted[0]?.slug;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">All-Agent Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Agent
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Total Sales
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Conv Rate
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Deposit %
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  AOV
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bookings
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Messages
                </th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Days
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((agent) => {
                const isTop = agent.slug === topSlug;
                return (
                  <tr
                    key={agent.slug}
                    className={`border-b border-gray-100 last:border-0 transition-colors ${
                      isTop ? "bg-amber-50/60" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="py-2.5 pr-4 font-medium text-foreground">
                      {isTop && (
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                      )}
                      {agent.name}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-foreground">
                      {formatCurrency(agent.totals.total_sales)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {formatPercent(agent.totals.avg_conversion_rate)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {formatPercent(agent.totals.avg_deposit_pct)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {formatCurrency(agent.totals.avg_aov)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {agent.totals.total_bookings}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {agent.totals.total_messages.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-foreground">
                      {agent.totals.active_days}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
