"use client";

import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

interface AgentTeamBannerProps {
  agents: CrmAgent[];
}

interface KpiTile {
  label: string;
  value: string;
  sub?: string;
}

export function AgentTeamBanner({ agents }: AgentTeamBannerProps) {
  if (agents.length === 0) return null;

  const totalRevenue   = agents.reduce((s, a) => s + a.totals.total_sales,    0);
  const totalBookings  = agents.reduce((s, a) => s + a.totals.total_bookings,  0);
  const totalMessages  = agents.reduce((s, a) => s + a.totals.total_messages,  0);
  const totalDeposits  = agents.reduce((s, a) => s + (a.totals.total_deposits ?? 0), 0);

  // Weighted-average conv % and deposit % over agents with activity
  const activeAgents = agents.filter((a) => a.totals.active_days > 0);
  const avgConv = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_conversion_rate, 0) / activeAgents.length
    : 0;
  const avgDeposit = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_deposit_pct, 0) / activeAgents.length
    : 0;

  const tiles: KpiTile[] = [
    { label: "Total Revenue",  value: formatCurrency(totalRevenue) },
    { label: "Bookings",       value: totalBookings.toLocaleString() },
    { label: "Deposits",       value: totalDeposits.toLocaleString() },
    { label: "Conv %",         value: formatPercent(avgConv),   sub: "target 25%" },
    { label: "Deposit %",      value: formatPercent(avgDeposit), sub: "target 70%" },
    { label: "Total Messages", value: totalMessages.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-0.5 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t.label}
          </span>
          <span className="text-xl font-bold tabular-nums text-foreground">
            {t.value}
          </span>
          {t.sub && (
            <span className="text-xs text-muted-foreground">{t.sub}</span>
          )}
        </div>
      ))}
    </div>
  );
}
