"use client";

import { format, parseISO } from "date-fns";
import {
  ComposedChart,
  Bar,
  Line,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmAgent, CrmAgentRow } from "@/lib/hooks/useCrmAgents";
import { chartColors, formatCurrency, formatPercent } from "@/lib/charts/config";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";

// Channel labels differ by agent role:
//   Chat agents → Live Chat / GHL / Email  (matches their sheet column headers)
//   SDR agents  → Chat / Inbound / Outbound
function channelLabels(slug: string): [string, string, string] {
  const role = AGENT_META_BY_SLUG[slug]?.role;
  return role === "Chat"
    ? ["Live Chat", "GHL", "Email"]
    : ["Chat", "Inbound", "Outbound"];
}

const TARGET_CONV_RATE = 25;
const TARGET_DEPOSIT_PCT = 70;

function TrendBadge({ value, target }: { value: number; target: number }) {
  const delta = value - target;
  const color = delta >= 0 ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50";
  const sign  = delta >= 0 ? "+" : "";
  return (
    <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      {sign}{delta.toFixed(1)}% vs target
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  target?: number;
  rawValue?: number;
}

function KpiCard({ label, value, target, rawValue }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold text-foreground leading-tight">{value}</p>
        {target !== undefined && rawValue !== undefined && (
          <div className="mt-1">
            <TrendBadge value={rawValue} target={target} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4" style={{ color: entry.color }}>
          <span>{entry.name}</span>
          <span className="font-semibold">
            {entry.name.includes("%") || entry.name.includes("Bkg")
              ? formatPercent(entry.value)
              : formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface AgentDetailPanelProps {
  agent: CrmAgent;
}

export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  const { totals, rows } = agent;
  const [ch1, ch2, ch3] = channelLabels(agent.slug);

  const chartRows = rows.map((r: CrmAgentRow) => {
    // Sheet's total_sales column is often empty for SDR — derive from channels
    const channelSum = (r.lc_sales ?? 0) + (r.crm_sales ?? 0) + (r.other_sales ?? 0);
    const bkgEff = (r.booking_eff_pct ?? 0) > 0 ? (r.booking_eff_pct ?? 0) : (r.conversion_rate_pct ?? 0);
    return {
      date:          format(parseISO(r.date), "d MMM"),
      "Total Sales": channelSum > 0 ? channelSum : (r.total_sales ?? 0),
      "Bkg Eff %":   Number(bkgEff.toFixed(1)),
      [ch1]:         r.lc_sales,
      [ch2]:         r.crm_sales,
      [ch3]:         r.other_sales,
    };
  });

  return (
    <div className="space-y-6">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <KpiCard label="Total Sales" value={formatCurrency(totals.total_sales)} />
        <KpiCard
          label="Booking Eff"
          value={formatPercent(totals.avg_booking_eff > 0 ? totals.avg_booking_eff : totals.avg_conversion_rate)}
          target={TARGET_CONV_RATE}
          rawValue={totals.avg_booking_eff > 0 ? totals.avg_booking_eff : totals.avg_conversion_rate}
        />
        <KpiCard
          label="Booking Rate"
          value={totals.avg_booking_rate > 0 ? formatPercent(totals.avg_booking_rate) : "—"}
        />
        <KpiCard
          label="Deposit %"
          value={formatPercent(totals.avg_deposit_pct)}
          target={TARGET_DEPOSIT_PCT}
          rawValue={totals.avg_deposit_pct}
        />
        <KpiCard label="AOV"            value={formatCurrency(totals.avg_aov)} />
        <KpiCard label="Active Days"    value={String(totals.active_days)} />
        <KpiCard label="Total Messages" value={String(totals.total_messages)} />
      </div>

      {/* Daily Sales & Conversion Trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Daily Sales & Conversion Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="sales"
                  orientation="left"
                  tickFormatter={(v) => `€${v}`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar
                  yAxisId="sales"
                  dataKey="Total Sales"
                  fill={chartColors.spa}
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="Bkg Eff %"
                  stroke={chartColors.target}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColors.target }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Channel Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Channel Breakdown (Daily Sales)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `€${v}`} tick={{ fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey={ch1} stackId="ch" fill={chartColors.spa}        radius={[0, 0, 0, 0]} />
                <Bar dataKey={ch2} stackId="ch" fill={chartColors.aesthetics} radius={[0, 0, 0, 0]} />
                <Bar dataKey={ch3} stackId="ch" fill={chartColors.slimming}   radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
