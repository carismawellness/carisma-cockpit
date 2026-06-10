"use client";

import { useRouter } from "next/navigation";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG, BRAND_ORDER, type AgentBrand } from "@/lib/constants/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";

// ── Channel colours — consistent across all agents ───────────────────────────
// Role determines the display name, not the color.
const CH = {
  lc:    { color: "#7BA7BC" }, // Live Chat (Chat agents) / Chat (SDR agents)
  crm:   { color: "#C9A96E" }, // GHL (Chat agents) / Inbound (SDR agents)
  other: { color: "#9CAF88" }, // Email (Chat agents) / Outbound (SDR agents)
};

const BRAND_BG: Record<AgentBrand, string> = {
  SPA:        "#FBF9F7",
  AESTHETICS: "#F4F9F9",
  SLIMMING:   "#F6FAF4",
};

const BRAND_LABEL_COLOR: Record<AgentBrand, string> = {
  SPA:        "#B5936B",
  AESTHETICS: "#5A9090",
  SLIMMING:   "#6A9455",
};

// ── Data shaping ──────────────────────────────────────────────────────────────

type ChartRow = {
  slug:       string;
  name:       string;
  brand:      AgentBrand;
  role:       string;
  revenue:    number;
  lc:         number;
  crm:        number;
  other:      number;
  bookings:   number;
  depositPct: number;
  convRate:   number;
  aov:        number;
  activeDays: number;
};

function toRow(agent: CrmAgent): ChartRow | null {
  const meta = AGENT_META_BY_SLUG[agent.slug];
  if (!meta) return null;

  const lc    = agent.rows.reduce((s, r) => s + (r.lc_sales    ?? 0), 0);
  const crm   = agent.rows.reduce((s, r) => s + (r.crm_sales   ?? 0), 0);
  const other = agent.rows.reduce((s, r) => s + (r.other_sales ?? 0), 0);
  const channelSum = lc + crm + other;
  const revenue    = channelSum > 0 ? channelSum : agent.totals.total_sales;

  const depositPct = agent.totals.total_bookings > 0
    ? (agent.totals.total_deposits / agent.totals.total_bookings) * 100
    : 0;

  return {
    slug:       agent.slug,
    name:       agent.name,
    brand:      meta.brand,
    role:       meta.role,
    revenue,
    lc,
    crm,
    other,
    bookings:   agent.totals.total_bookings,
    depositPct: Math.round(depositPct * 10) / 10,
    convRate:   agent.totals.avg_conversion_rate,
    aov:        agent.totals.avg_aov,
    activeDays: agent.totals.active_days,
  };
}

// Brand-first sort: Spa → Aesthetics → Slimming, revenue desc within each brand
function sortRows(rows: ChartRow[]): ChartRow[] {
  const result: ChartRow[] = [];
  for (const brand of BRAND_ORDER) {
    const group = rows
      .filter((r) => r.brand === brand)
      .sort((a, b) => b.revenue - a.revenue);
    result.push(...group);
  }
  return result;
}

function chLabel(role: string, ch: "lc" | "crm" | "other"): string {
  if (role === "Chat") return { lc: "Live Chat", crm: "GHL", other: "Email" }[ch];
  return { lc: "Chat", crm: "Inbound", other: "Outbound" }[ch];
}

// ── Custom X-axis tick ────────────────────────────────────────────────────────

function MetricTick({
  x, y, payload, rows, onClick,
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
  const vc = "#27272A";
  const lc = "#71717A";

  return (
    <g transform={`translate(${x},${y})`} style={{ cursor: "pointer" }} onClick={() => onClick(row.slug)}>
      <text x={0} y={14}  textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.name}</text>
      <text x={0} y={28}  textAnchor="middle" fontSize={9}  fill={lc}>
        <tspan fill={BRAND_LABEL_COLOR[row.brand]} fontWeight={700}>●</tspan>
        <tspan dx={3}>{row.brand} · {row.role}</tspan>
      </text>
      <text x={0} y={46}  textAnchor="middle" fontSize={10} fill={lc}>Bookings</text>
      <text x={0} y={58}  textAnchor="middle" fontSize={11} fontWeight={600} fill={vc}>{row.bookings}</text>
      <text x={0} y={74}  textAnchor="middle" fontSize={10} fill={lc}>Conv Rate</text>
      <text x={0} y={86}  textAnchor="middle" fontSize={11} fontWeight={600} fill={vc}>{row.convRate > 0 ? `${row.convRate.toFixed(1)}%` : "—"}</text>
      <text x={0} y={102} textAnchor="middle" fontSize={10} fill={lc}>AOV</text>
      <text x={0} y={114} textAnchor="middle" fontSize={11} fontWeight={600} fill={vc}>{row.aov > 0 ? `€${row.aov.toFixed(0)}` : "—"}</text>
      <text x={0} y={130} textAnchor="middle" fontSize={10} fill={lc}>Active Days</text>
      <text x={0} y={142} textAnchor="middle" fontSize={11} fontWeight={600} fill={vc}>{row.activeDays}</text>
    </g>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const isChat = row.role === "Chat";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg space-y-0.5 min-w-[190px]">
      <p className="font-semibold text-foreground">{row.name}</p>
      <p className="text-muted-foreground">{row.brand} · {row.role}</p>
      <div className="border-t border-gray-100 my-1.5" />
      {row.lc > 0 && (
        <div className="flex justify-between gap-4">
          <span style={{ color: CH.lc.color }} className="font-medium">{isChat ? "Live Chat" : "Chat"}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(row.lc)}</span>
        </div>
      )}
      {row.crm > 0 && (
        <div className="flex justify-between gap-4">
          <span style={{ color: CH.crm.color }} className="font-medium">{isChat ? "GHL" : "Inbound"}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(row.crm)}</span>
        </div>
      )}
      {row.other > 0 && (
        <div className="flex justify-between gap-4">
          <span style={{ color: CH.other.color }} className="font-medium">{isChat ? "Email" : "Outbound"}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(row.other)}</span>
        </div>
      )}
      <div className="border-t border-gray-100 my-1.5" />
      <div className="flex justify-between gap-4"><span>Total Revenue</span><span className="font-semibold tabular-nums">{formatCurrency(row.revenue)}</span></div>
      <div className="flex justify-between gap-4"><span>Bookings</span><span className="font-semibold tabular-nums">{row.bookings}</span></div>
      <div className="flex justify-between gap-4"><span>Deposit %</span><span className="font-semibold tabular-nums">{row.depositPct > 0 ? formatPercent(row.depositPct) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Conv Rate</span><span className="font-semibold tabular-nums">{row.convRate > 0 ? formatPercent(row.convRate) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>AOV</span><span className="font-semibold tabular-nums">{row.aov > 0 ? formatCurrency(row.aov) : "—"}</span></div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AgentLeaderboardCardsProps {
  agents: CrmAgent[];
}

export function AgentLeaderboardCards({ agents }: AgentLeaderboardCardsProps) {
  const router = useRouter();

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No data for selected period — run the ETL sync first
      </div>
    );
  }

  const allRows = agents
    .map(toRow)
    .filter((r): r is ChartRow => r !== null);

  const rows = sortRows(allRows.filter((r) => r.revenue > 0 || r.activeDays > 0));
  const inactiveRows = allRows.filter((r) => r.revenue === 0 && r.activeDays === 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No agent activity in this period.
      </div>
    );
  }

  // Team median revenue
  const teamMedianRevenue = (() => {
    const sorted = [...rows].map((r) => r.revenue).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  })();

  // Brand section boundaries for background shading
  const brandSections: Array<{ brand: AgentBrand; x1: string; x2: string }> = [];
  for (const brand of BRAND_ORDER) {
    const group = rows.filter((r) => r.brand === brand);
    if (group.length > 0) {
      brandSections.push({ brand, x1: group[0].name, x2: group[group.length - 1].name });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold">Agent Leaderboard</CardTitle>
          {/* Channel colour legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: CH.lc.color }} />
              Live Chat · Chat
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: CH.crm.color }} />
              GHL · Inbound
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: CH.other.color }} />
              Email · Outbound
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-5 rounded-full" style={{ backgroundColor: "#E07A5F" }} />
              Deposit %
            </span>
          </div>
        </div>
        {/* Brand group labels */}
        <div className="mt-1 flex gap-3 text-[10px] font-semibold uppercase tracking-widest">
          {brandSections.map(({ brand }) => (
            <span key={brand} style={{ color: BRAND_LABEL_COLOR[brand] }}>{brand}</span>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-2 px-2 md:px-6">
        <div className="overflow-x-auto -mx-2 md:mx-0">
          <div className="h-[520px]" style={{ minWidth: Math.max(rows.length * 90, 360) }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 22, right: 30, left: 0, bottom: 130 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />

                {/* Brand background sections */}
                {brandSections.map(({ brand, x1, x2 }) => (
                  <ReferenceArea
                    key={brand}
                    x1={x1}
                    x2={x2}
                    fill={BRAND_BG[brand]}
                    fillOpacity={1}
                    stroke="none"
                  />
                ))}

                <XAxis
                  dataKey="name"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: "#E5E7EB" }}
                  height={150}
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
                  tickFormatter={(v) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
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
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />

                {/* Team median reference line */}
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

                {/* Stacked channel bars — lc bottom, crm middle, other top */}
                <Bar
                  yAxisId="rev"
                  dataKey="lc"
                  stackId="ch"
                  name={`${chLabel("Chat", "lc")} / ${chLabel("SDR", "lc")}`}
                  fill={CH.lc.color}
                  barSize={52}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  yAxisId="rev"
                  dataKey="crm"
                  stackId="ch"
                  name={`${chLabel("Chat", "crm")} / ${chLabel("SDR", "crm")}`}
                  fill={CH.crm.color}
                  barSize={52}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  yAxisId="rev"
                  dataKey="other"
                  stackId="ch"
                  name={`${chLabel("Chat", "other")} / ${chLabel("SDR", "other")}`}
                  fill={CH.other.color}
                  barSize={52}
                  radius={[6, 6, 0, 0]}
                >
                  {/* Total revenue label above the full stacked bar */}
                  <LabelList
                    dataKey="revenue"
                    position="top"
                    formatter={(v: unknown) => {
                      const n = Number(v);
                      return n >= 1000 ? `€${(n / 1000).toFixed(0)}k` : `€${n}`;
                    }}
                    style={{ fontSize: 10, fill: "#27272A", fontWeight: 700 }}
                  />
                </Bar>

                {/* Deposit % overlay line */}
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
        </div>

        {/* Inactive agents */}
        {inactiveRows.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Inactive ({inactiveRows.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {inactiveRows.map((r) => (
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
