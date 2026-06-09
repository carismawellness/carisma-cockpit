"use client";

import { useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmAgent, CrmAgentRow } from "@/lib/hooks/useCrmAgents";
import { chartColors, formatCurrency, formatPercent } from "@/lib/charts/config";

// ── Targets ────────────────────────────────────────────────────────────────────
const TARGET_CONV_RATE = 25;
const TARGET_DEPOSIT_PCT = 70;

// ── Helpers ────────────────────────────────────────────────────────────────────

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
            {entry.name.includes("%") || entry.name.includes("Conv")
              ? formatPercent(entry.value)
              : formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Agent Detail Panel ─────────────────────────────────────────────────────────

function AgentDetail({ agent }: { agent: CrmAgent }) {
  const { totals, rows } = agent;

  const chartRows = rows.map((r: CrmAgentRow) => ({
    date:         format(parseISO(r.date), "d MMM"),
    "Total Sales": r.total_sales,
    "Conv %":      Number((r.conversion_rate_pct ?? 0).toFixed(1)),
    "LC":          r.lc_sales,
    "CRM":         r.crm_sales,
    "Other":       r.other_sales,
  }));

  return (
    <div className="space-y-6 mt-4">
      {/* Sub-section A: KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Sales" value={formatCurrency(totals.total_sales)} />
        <KpiCard
          label="Conversion Rate"
          value={formatPercent(totals.avg_conversion_rate)}
          target={TARGET_CONV_RATE}
          rawValue={totals.avg_conversion_rate}
        />
        <KpiCard
          label="Deposit %"
          value={formatPercent(totals.avg_deposit_pct)}
          target={TARGET_DEPOSIT_PCT}
          rawValue={totals.avg_deposit_pct}
        />
        <KpiCard label="AOV" value={formatCurrency(totals.avg_aov)} />
      </div>

      {/* Sub-section B: Daily Sales + Conversion Trend */}
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
                  dataKey="Conv %"
                  stroke={chartColors.target}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartColors.target }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Sub-section C: Channel Breakdown */}
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
                <Bar dataKey="LC"    stackId="ch" fill={chartColors.spa}        radius={[0, 0, 0, 0]} />
                <Bar dataKey="CRM"   stackId="ch" fill={chartColors.aesthetics} radius={[0, 0, 0, 0]} />
                <Bar dataKey="Other" stackId="ch" fill={chartColors.slimming}   radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

interface AgentDetailTabsProps {
  agents: CrmAgent[];
}

export function AgentDetailTabs({ agents }: AgentDetailTabsProps) {
  const agentsWithData = agents.filter((a) => a.totals.total_sales > 0 || a.rows.length > 0);
  const displayAgents  = agentsWithData.length > 0 ? agentsWithData : agents;

  const [activeSlug, setActiveSlug] = useState<string>(
    displayAgents[0]?.slug ?? ""
  );

  if (displayAgents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const activeAgent = displayAgents.find((a) => a.slug === activeSlug) ?? displayAgents[0];

  return (
    <Tabs value={activeSlug} onValueChange={setActiveSlug}>
      <TabsList className="h-auto flex-wrap gap-1 bg-muted p-1">
        {displayAgents.map((agent) => (
          <TabsTrigger key={agent.slug} value={agent.slug} className="text-xs">
            {agent.name}
          </TabsTrigger>
        ))}
      </TabsList>

      {displayAgents.map((agent) => (
        <TabsContent key={agent.slug} value={agent.slug}>
          {activeAgent.slug === agent.slug && <AgentDetail agent={agent} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
