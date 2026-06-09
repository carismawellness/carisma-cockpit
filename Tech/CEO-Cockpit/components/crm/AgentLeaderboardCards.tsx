"use client";

import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

interface AgentLeaderboardCardsProps {
  agents: CrmAgent[];
}

export function AgentLeaderboardCards({ agents }: AgentLeaderboardCardsProps) {
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

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {sorted.map((agent, idx) => (
        <Card key={agent.slug} className="relative">
          {idx === 0 && (
            <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              #1
            </span>
          )}
          <CardHeader className="pb-1">
            <CardTitle className="truncate text-sm font-semibold">
              {agent.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-2xl font-bold text-foreground leading-tight">
              {formatCurrency(agent.totals.total_sales)}
            </p>
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Conv Rate</span>
                <span className="font-medium text-foreground">
                  {formatPercent(agent.totals.avg_conversion_rate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>AOV</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(agent.totals.avg_aov)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Active Days</span>
                <span className="font-medium text-foreground">
                  {agent.totals.active_days}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
