"use client";

import { useRouter } from "next/navigation";
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

interface AgentLeaderboardCardsProps {
  agents: CrmAgent[];
}

// Brand fill colours — slightly stronger than the soft pastels used elsewhere
// so the bars actually read against a white card background.
const BRAND_FILL: Record<string, string> = {
  SPA:        "#D4B896", // warm sand
  AESTHETICS: "#7FB3B3", // soft teal
  SLIMMING:   "#9CAF88", // sage
};

// ── Data shaping ──────────────────────────────────────────────────────────────

type ChartRow = {
  slug:          string;
  name:          string;
  brand:         string;
  role:          string;
  fill:          string;
  revenue:       number;
  bookings:      number;
  depositPct:    number;
  convRate:      number;
  aov:           number;
  activeDays:    number;
};

function toRow(agent: CrmAgent): ChartRow {
  const meta       = AGENT_META_BY_SLUG[agent.slug];
  const brand      = meta?.brand ?? "SPA";
  const role       = meta?.role  ?? "—";
  const totals     = agent.totals;
  const depositPct =
    totals.total_bookings > 0
      ? (totals.total_deposits / totals.total_bookings) * 100
      : 0;
  return {
    slug:       agent.slug,
    name:       agent.name,
    brand,
    role,
    fill:       BRAND_FILL[brand] ?? "#D4B896",
    revenue:    totals.total_sales,
    bookings:   totals.total_bookings,
    depositPct: Math.round(depositPct * 10) / 10,
    convRate:   totals.avg_conversion_rate,
    aov:        totals.avg_aov,
    activeDays: totals.active_days,
  };
}

// ── Custom multi-line X-axis tick ─────────────────────────────────────────────
//
// Renders the agent name plus 4 supporting metrics stacked beneath it.

function MetricTick({
  x,
  y,
  payload,
  rows,
  onClick,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  rows: ChartRow[];
  onClick: (slug: string) => void;
}) {
  if (x === undefined || y === undefined || !payload) return null;
  const row = rows.find((r) => r.name === payload.value);
  if (!row) return null;
  const inactive = row.revenue === 0 && row.activeDays === 0;

  const labelColour = inactive ? "#A1A1AA" : "#71717A";
  const valueColour = inactive ? "#A1A1AA" : "#27272A";

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: "pointer" }}
      onClick={() => onClick(row.slug)}
    >
      {/* Agent name */}
      <text
        x={0}
        y={14}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={inactive ? "#A1A1AA" : "#18181B"}
      >
        {row.name}
      </text>
      {/* Brand · Role chip line */}
      <text x={0} y={28} textAnchor="middle" fontSize={9} fill={labelColour}>
        <tspan fill={row.fill} fontWeight={700}>●</tspan>
        <tspan dx={3}>{row.brand} · {row.role}</tspan>
      </text>

      {/* Bookings */}
      <text x={0} y={46} textAnchor="middle" fontSize={10} fill={labelColour}>
        Bookings
      </text>
      <text x={0} y={58} textAnchor="middle" fontSize={11} fontWeight={600} fill={valueColour}>
        {row.bookings}
      </text>

      {/* Conv Rate */}
      <text x={0} y={74} textAnchor="middle" fontSize={10} fill={labelColour}>
        Conv Rate
      </text>
      <text x={0} y={86} textAnchor="middle" fontSize={11} fontWeight={600} fill={valueColour}>
        {row.convRate > 0 ? `${row.convRate.toFixed(1)}%` : "—"}
      </text>

      {/* AOV */}
      <text x={0} y={102} textAnchor="middle" fontSize={10} fill={labelColour}>
        AOV
      </text>
      <text x={0} y={114} textAnchor="middle" fontSize={11} fontWeight={600} fill={valueColour}>
        {row.aov > 0 ? `€${row.aov.toFixed(0)}` : "—"}
      </text>

      {/* Active Days */}
      <text x={0} y={130} textAnchor="middle" fontSize={10} fill={labelColour}>
        Active Days
      </text>
      <text x={0} y={142} textAnchor="middle" fontSize={11} fontWeight={600} fill={valueColour}>
        {row.activeDays}
      </text>
    </g>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  dataKey: string;
  value: number;
  payload: ChartRow;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg space-y-0.5 min-w-[160px]">
      <p className="font-semibold text-foreground">{row.name}</p>
      <p className="text-muted-foreground">{row.brand} · {row.role}</p>
      <div className="border-t border-gray-100 my-1.5" />
      <div className="flex justify-between gap-4"><span>Revenue</span><span className="font-semibold tabular-nums">{formatCurrency(row.revenue)}</span></div>
      <div className="flex justify-between gap-4"><span>Bookings</span><span className="font-semibold tabular-nums">{row.bookings}</span></div>
      <div className="flex justify-between gap-4"><span>Deposit %</span><span className="font-semibold tabular-nums">{row.depositPct > 0 ? formatPercent(row.depositPct) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Conv Rate</span><span className="font-semibold tabular-nums">{row.convRate > 0 ? formatPercent(row.convRate) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>AOV</span><span className="font-semibold tabular-nums">{row.aov > 0 ? formatCurrency(row.aov) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Active Days</span><span className="font-semibold tabular-nums">{row.activeDays}</span></div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentLeaderboardCards({ agents }: AgentLeaderboardCardsProps) {
  const router = useRouter();

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const rows = agents
    .map(toRow)
    .filter((r) => r.revenue > 0 || r.activeDays > 0)
    .sort((a, b) => b.revenue - a.revenue);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No agent activity in this period.
      </div>
    );
  }

  // Team median revenue — robust to outliers (Abid/Rana inflate the mean badly)
  const teamMedianRevenue = (() => {
    const sortedRev = [...rows].map((r) => r.revenue).sort((a, b) => a - b);
    const mid = Math.floor(sortedRev.length / 2);
    return sortedRev.length % 2 === 0
      ? (sortedRev[mid - 1] + sortedRev[mid]) / 2
      : sortedRev[mid];
  })();

  const inactiveAgents = agents
    .map(toRow)
    .filter((r) => r.revenue === 0 && r.activeDays === 0);

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base font-semibold">Agent Leaderboard</CardTitle>
          <p className="text-xs text-muted-foreground">
            Revenue bars · deposit % line · click any agent
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-[420px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={rows}
              margin={{ top: 12, right: 30, left: 0, bottom: 110 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="name"
                interval={0}
                tickLine={false}
                axisLine={{ stroke: "#E5E7EB" }}
                height={140}
                tick={
                  <MetricTick
                    rows={rows}
                    onClick={(slug) => router.push(`/crm/individual/${slug}`)}
                  />
                }
              />
              <YAxis
                yAxisId="rev"
                orientation="left"
                tickFormatter={(v) =>
                  v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`
                }
                tick={{ fontSize: 11, fill: "#71717A" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="dep"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "#71717A" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F4F4F5" }} />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="square"
                wrapperStyle={{ fontSize: 11 }}
              />

              {/* Team median revenue line */}
              <ReferenceLine
                yAxisId="rev"
                y={teamMedianRevenue}
                stroke="#A1A1AA"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `Median ${formatCurrency(teamMedianRevenue)}`,
                  position: "insideTopRight",
                  fill: "#71717A",
                  fontSize: 10,
                }}
              />

              {/* Revenue bars (brand-coloured per cell) */}
              <Bar
                yAxisId="rev"
                dataKey="revenue"
                name="Revenue"
                radius={[6, 6, 0, 0]}
                barSize={42}
              >
                {rows.map((r) => (
                  <Cell key={r.slug} fill={r.fill} />
                ))}
              </Bar>

              {/* Deposit % overlay */}
              <Line
                yAxisId="dep"
                type="monotone"
                dataKey="depositPct"
                name="Deposit %"
                stroke="#E07A5F"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#E07A5F", stroke: "#fff", strokeWidth: 1.5 }}
                activeDot={{ r: 6 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Inactive agents row */}
        {inactiveAgents.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Inactive ({inactiveAgents.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {inactiveAgents.map((r) => (
                <button
                  key={r.slug}
                  onClick={() => router.push(`/crm/individual/${r.slug}`)}
                  className="text-xs px-2 py-0.5 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100"
                  title={`${r.brand} · ${r.role}`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
