"use client";

import { useRouter } from "next/navigation";
import {
  ComposedChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { CrmAgent } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG, BRAND_ORDER, type AgentBrand } from "@/lib/constants/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";

// ── Google brand palette — one distinct colour per channel ───────────────────
// Channels (Live Chat / GHL / Email / Chat / Inbound / Outbound) are non-brand
// categories, so they intentionally keep this palette for max distinguishability.
const CH = {
  liveChat: "#4285F4",
  ghl:      "#F9AB00",
  email:    "#EA4335",
  chat:     "#9334E6",
  inbound:  "#12B5CB",
  outbound: "#34A853",
};

function slotColor(role: string, slot: "lc" | "crm" | "other"): string {
  if (role === "Chat") return ({ lc: CH.liveChat, crm: CH.ghl,     other: CH.email    })[slot];
  return                       ({ lc: CH.chat,     crm: CH.inbound, other: CH.outbound })[slot];
}

function slotLabel(role: string, slot: "lc" | "crm" | "other"): string {
  if (role === "Chat") return ({ lc: "Live Chat", crm: "GHL",     other: "Email"    })[slot];
  return                       ({ lc: "Chat",      crm: "Inbound", other: "Outbound" })[slot];
}

// ── Brand colours — canonical palette (`soft` for backgrounds, `dark` for labels/marks) ──

const BRAND_BG: Record<AgentBrand, string> = {
  SPA:        BRAND.spa.soft,
  AESTHETICS: BRAND.aesthetics.soft,
  SLIMMING:   BRAND.slimming.soft,
};

const BRAND_LABEL_COLOR: Record<AgentBrand, string> = {
  SPA:        BRAND.spa.dark,
  AESTHETICS: BRAND.aesthetics.dark,
  SLIMMING:   BRAND.slimming.dark,
};

const SLIMMING_BAR_COLOR = BRAND.slimming.dark; // text/axis labels
// Use dark for bar fill — soft (#CCD8C3) is the same as the panel background,
// which makes bars invisible. Dark (#486A42) contrasts against the panel.
const SLIMMING_BAR_FILL  = BRAND.slimming.dark;

// ── Data shaping ──────────────────────────────────────────────────────────────

type ChartRow = {
  slug:        string;
  name:        string;
  brand:       AgentBrand;
  role:        string;
  inactive:    boolean;
  revenue:     number;
  revBarTotal: number;
  lc:          number;
  crm:         number;
  other:       number;
  bkgBar:      number;
  bookings:    number;
  bookingEff:  number;   // "Lead conversion"  — sheet col H (avg_booking_eff, conv-rate fallback for Chat)
  bookingRate: number;   // "Call conversion"  — sheet col I (avg_booking_rate)
  talkTime:    number;   // "Talk time"        — total minutes, sheet col V (total_talk_time)
  dials:       number;   // "Dials"            — outbound dials, SDR only (sum of other_messages / col C)
  depositPct:  number;   // "Deposit %"        — sheet col Y (avg_deposit_pct)
  aov:         number;
  activeDays:  number;
};

function toRow(agent: CrmAgent): ChartRow | null {
  const meta = AGENT_META_BY_SLUG[agent.slug];
  if (!meta) return null;

  const isSlimming = meta.brand === "SLIMMING";

  const lcRaw    = agent.rows.reduce((s, r) => s + (r.lc_sales    ?? 0), 0);
  const crmRaw   = agent.rows.reduce((s, r) => s + (r.crm_sales   ?? 0), 0);
  const otherRaw = agent.rows.reduce((s, r) => s + (r.other_sales ?? 0), 0);
  const channelSum = lcRaw + crmRaw + otherRaw;

  const lc    = isSlimming ? 0 : lcRaw;
  const crm   = isSlimming ? 0 : crmRaw;
  const other = isSlimming ? 0 : otherRaw;
  const revBarTotal = isSlimming ? 0 : (channelSum > 0 ? channelSum : agent.totals.total_sales);
  const revenue     = channelSum > 0 ? channelSum : agent.totals.total_sales;

  // Dials = outbound dials, an SDR-only metric (Chat agents don't dial — their
  // `other_messages` field holds Other-channel message counts, not dials).
  const dials = meta.role === "Chat"
    ? 0
    : agent.rows.reduce((s, r) => s + (r.other_messages ?? 0), 0);

  return {
    slug:        agent.slug,
    name:        agent.name,
    brand:       meta.brand,
    role:        meta.role,
    inactive:    meta.inactive,
    revenue,
    revBarTotal,
    lc, crm, other,
    bkgBar:      isSlimming ? agent.totals.total_bookings : 0,
    bookings:    agent.totals.total_bookings,
    bookingEff:  agent.totals.avg_booking_eff > 0 ? agent.totals.avg_booking_eff : agent.totals.avg_conversion_rate,
    bookingRate: agent.totals.avg_booking_rate,
    talkTime:    agent.totals.total_talk_time,
    dials,
    depositPct:  agent.totals.avg_deposit_pct,
    aov:         agent.totals.avg_aov,
    activeDays:  agent.totals.active_days,
  };
}

function sortByRevenue(rows: ChartRow[]): ChartRow[] {
  return [...rows].sort((a, b) => b.revenue - a.revenue);
}

// Talk Time is sourced from the CRM Master Sheet "Talk Time" column, which agents
// currently fill in inconsistently (mixed HH:MM:SS / decimals / "OFF") and whose
// total column frequently errors to #VALUE! — so the stored values are unreliable
// (e.g. 6651m). Render "—" until the sheet column is standardized; flip to true to
// surface the raw values. The metric is fully wired end-to-end and ready to enable.
const TALK_TIME_RELIABLE = false;

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
      <text x={0} y={16}  textAnchor="middle" fontSize={13} fontWeight={700} fill={vc}>{row.name}</text>
      <text x={0} y={32}  textAnchor="middle" fontSize={10} fill={lc}>
        <tspan fill={BRAND_LABEL_COLOR[row.brand]} fontWeight={700}>●</tspan>
        <tspan dx={3}>{row.role}</tspan>
      </text>
      <text x={0} y={54}  textAnchor="middle" fontSize={10} fill={lc}>Bookings</text>
      <text x={0} y={68}  textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.bookings}</text>
      <text x={0} y={86}  textAnchor="middle" fontSize={10} fill={lc}>Lead Conv</text>
      <text x={0} y={100} textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.bookingEff > 0 ? `${row.bookingEff.toFixed(1)}%` : "—"}</text>
      <text x={0} y={118} textAnchor="middle" fontSize={10} fill={lc}>Call Conv</text>
      <text x={0} y={132} textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.bookingRate > 0 ? `${row.bookingRate.toFixed(1)}%` : "—"}</text>
      <text x={0} y={150} textAnchor="middle" fontSize={10} fill={lc}>Talk Time</text>
      <text x={0} y={164} textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{TALK_TIME_RELIABLE && row.talkTime > 0 ? `${row.talkTime}m` : "—"}</text>
      <text x={0} y={182} textAnchor="middle" fontSize={10} fill={lc}>Dials</text>
      <text x={0} y={196} textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.dials > 0 ? row.dials.toLocaleString() : "—"}</text>
      <text x={0} y={214} textAnchor="middle" fontSize={10} fill={lc}>Deposit %</text>
      <text x={0} y={228} textAnchor="middle" fontSize={12} fontWeight={600} fill={vc}>{row.depositPct > 0 ? `${row.depositPct.toFixed(1)}%` : "—"}</text>
    </g>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({
  active, payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const isSlimming = row.brand === "SLIMMING";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg space-y-0.5 min-w-[190px]">
      <p className="font-semibold text-foreground">{row.name}</p>
      <p className="text-muted-foreground">{row.brand} · {row.role}</p>
      <div className="border-t border-gray-100 my-1.5" />
      {isSlimming ? (
        <div className="flex justify-between gap-4">
          <span style={{ color: SLIMMING_BAR_COLOR }} className="font-medium">Bookings</span>
          <span className="font-semibold tabular-nums">{row.bkgBar}</span>
        </div>
      ) : (
        <>
          {row.lc > 0 && (
            <div className="flex justify-between gap-4">
              <span style={{ color: slotColor(row.role, "lc") }} className="font-medium">{slotLabel(row.role, "lc")}</span>
              <span className="font-semibold tabular-nums">{formatCurrency(row.lc)}</span>
            </div>
          )}
          {row.crm > 0 && (
            <div className="flex justify-between gap-4">
              <span style={{ color: slotColor(row.role, "crm") }} className="font-medium">{slotLabel(row.role, "crm")}</span>
              <span className="font-semibold tabular-nums">{formatCurrency(row.crm)}</span>
            </div>
          )}
          {row.other > 0 && (
            <div className="flex justify-between gap-4">
              <span style={{ color: slotColor(row.role, "other") }} className="font-medium">{slotLabel(row.role, "other")}</span>
              <span className="font-semibold tabular-nums">{formatCurrency(row.other)}</span>
            </div>
          )}
          <div className="border-t border-gray-100 my-1.5" />
          <div className="flex justify-between gap-4"><span>Total Revenue</span><span className="font-semibold tabular-nums">{formatCurrency(row.revenue)}</span></div>
        </>
      )}
      <div className="flex justify-between gap-4"><span>Total Bookings</span><span className="font-semibold tabular-nums">{row.bookings}</span></div>
      <div className="flex justify-between gap-4"><span>Lead conversion</span><span className="font-semibold tabular-nums">{row.bookingEff > 0 ? formatPercent(row.bookingEff) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Call conversion</span><span className="font-semibold tabular-nums">{row.bookingRate > 0 ? formatPercent(row.bookingRate) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Talk time</span><span className="font-semibold tabular-nums">{TALK_TIME_RELIABLE && row.talkTime > 0 ? `${row.talkTime}m` : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Dials</span><span className="font-semibold tabular-nums">{row.dials > 0 ? row.dials.toLocaleString() : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>Deposit %</span><span className="font-semibold tabular-nums">{row.depositPct > 0 ? formatPercent(row.depositPct) : "—"}</span></div>
      <div className="flex justify-between gap-4"><span>AOV</span><span className="font-semibold tabular-nums">{row.aov > 0 ? formatCurrency(row.aov) : "—"}</span></div>
    </div>
  );
}

// ── Per-brand chart panel ─────────────────────────────────────────────────────

function BrandPanel({
  brand,
  rows,
  revDomain,
  bkgDomain,
  medianRevenue,
  hideYAxis,
  onClick,
}: {
  brand: AgentBrand;
  rows: ChartRow[];
  revDomain: [number, number];
  bkgDomain: [number, number];
  medianRevenue: number;
  hideYAxis: boolean;
  onClick: (slug: string) => void;
}) {
  const isSlimming = brand === "SLIMMING";

  return (
    <div
      className="flex flex-col min-w-0"
      style={{ backgroundColor: BRAND_BG[brand] }}
    >
      {/* Brand header */}
      <div className="px-3 pt-3 pb-1">
        <p
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: BRAND_LABEL_COLOR[brand] }}
        >
          {brand}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {isSlimming ? "Bookings" : "Revenue"}
        </p>
      </div>

      <div className="h-[490px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 24, right: isSlimming ? 8 : 4, left: hideYAxis ? -32 : 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />

            <XAxis
              dataKey="name"
              interval={0}
              tickLine={false}
              axisLine={{ stroke: "#E5E7EB" }}
              height={240}
              tick={<MetricTick rows={rows} onClick={onClick} />}
            />

            {!isSlimming && (
              <YAxis
                yAxisId="rev"
                orientation="left"
                tickFormatter={(v) => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
                tick={{ fontSize: 10, fill: "#71717A" }}
                axisLine={false}
                tickLine={false}
                domain={revDomain}
                hide={hideYAxis}
              />
            )}

            {isSlimming && (
              <YAxis
                yAxisId="bkg"
                orientation="left"
                tickFormatter={(v) => `${v}`}
                tick={{ fontSize: 10, fill: SLIMMING_BAR_COLOR }}
                axisLine={false}
                tickLine={false}
                domain={bkgDomain}
              />
            )}

            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />

            {/* Median reference line (revenue charts only) */}
            {!isSlimming && medianRevenue > 0 && (
              <ReferenceLine
                yAxisId="rev"
                y={medianRevenue}
                stroke="#A1A1AA"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `Median ${formatCurrency(medianRevenue)}`,
                  position: "insideTopRight",
                  fill: "#71717A",
                  fontSize: 9,
                }}
              />
            )}

            {/* Revenue bars — Spa + Aesthetics */}
            {!isSlimming && (
              <>
                <Bar yAxisId="rev" dataKey="lc" stackId="ch" barSize={72} radius={[0, 0, 0, 0]}>
                  {rows.map((r) => <Cell key={r.slug} fill={slotColor(r.role, "lc")} />)}
                </Bar>
                <Bar yAxisId="rev" dataKey="crm" stackId="ch" barSize={72} radius={[0, 0, 0, 0]}>
                  {rows.map((r) => <Cell key={r.slug} fill={slotColor(r.role, "crm")} />)}
                </Bar>
                <Bar yAxisId="rev" dataKey="other" stackId="ch" barSize={72} radius={[6, 6, 0, 0]}>
                  {rows.map((r) => <Cell key={r.slug} fill={slotColor(r.role, "other")} />)}
                  <LabelList
                    dataKey="revBarTotal"
                    position="top"
                    formatter={(v: unknown) => {
                      const n = Number(v);
                      if (n === 0) return "";
                      return n >= 1000 ? `€${(n / 1000).toFixed(0)}k` : `€${n}`;
                    }}
                    style={{ fontSize: 11, fill: "#27272A", fontWeight: 700 }}
                  />
                </Bar>
              </>
            )}

            {/* Bookings bar — Slimming only */}
            {isSlimming && (
              <Bar yAxisId="bkg" dataKey="bkgBar" stackId="bkg" barSize={72} radius={[6, 6, 0, 0]} fill={SLIMMING_BAR_FILL}>
                <LabelList
                  dataKey="bkgBar"
                  position="top"
                  formatter={(v: unknown) => {
                    const n = Number(v);
                    return n > 0 ? `${n}` : "";
                  }}
                  style={{ fontSize: 11, fill: "#27272A", fontWeight: 700 }}
                />
              </Bar>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
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

  const allRows = agents.map(toRow).filter((r): r is ChartRow => r !== null);
  const activeRows = allRows.filter((r) => !r.inactive && (r.revenue > 0 || r.activeDays > 0));
  const inactiveRows = allRows.filter((r) => r.inactive || (r.revenue === 0 && r.activeDays === 0));

  if (activeRows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-10 text-center text-sm text-muted-foreground">
        No agent activity in this period.
      </div>
    );
  }

  // Group by brand, sorted by revenue desc within each brand
  const brandGroups: Record<AgentBrand, ChartRow[]> = {
    SPA:        sortByRevenue(activeRows.filter((r) => r.brand === "SPA")),
    AESTHETICS: sortByRevenue(activeRows.filter((r) => r.brand === "AESTHETICS")),
    SLIMMING:   sortByRevenue(activeRows.filter((r) => r.brand === "SLIMMING")),
  };

  // Shared revenue domain for Spa + Aesthetics comparison
  const nonSlimmingMax = Math.max(
    ...activeRows.filter((r) => r.brand !== "SLIMMING").map((r) => r.revBarTotal),
    0,
  );
  const revDomain: [number, number] = [0, Math.ceil(nonSlimmingMax * 1.25)];

  // Slimming bookings domain
  const slimmingBkgMax = Math.max(...brandGroups.SLIMMING.map((r) => r.bkgBar), 0);
  const bkgDomain: [number, number] = [0, Math.ceil(slimmingBkgMax * 1.25)];

  // Median across Spa + Aesthetics
  const nonSlimmingRevenues = activeRows
    .filter((r) => r.brand !== "SLIMMING")
    .map((r) => r.revBarTotal)
    .sort((a, b) => a - b);
  const mid = Math.floor(nonSlimmingRevenues.length / 2);
  const medianRevenue = nonSlimmingRevenues.length === 0 ? 0
    : nonSlimmingRevenues.length % 2 === 0
      ? (nonSlimmingRevenues[mid - 1] + nonSlimmingRevenues[mid]) / 2
      : nonSlimmingRevenues[mid];

  // Legend items
  const legendItems = [
    { color: CH.liveChat, label: "Live Chat" },
    { color: CH.ghl,      label: "GHL"       },
    { color: CH.email,    label: "Email"      },
    { color: CH.chat,     label: "Chat"       },
    { color: CH.inbound,  label: "Inbound"    },
    { color: CH.outbound, label: "Outbound"   },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <CardTitle className="text-base font-semibold">Agent Leaderboard</CardTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {legendItems.map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: SLIMMING_BAR_FILL }} />
              <span style={{ color: BRAND_LABEL_COLOR.SLIMMING }} className="font-medium">Bookings</span>
              <span>(Slimming)</span>
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0 px-0">
        {/* Three brand charts side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
          {BRAND_ORDER.map((brand, i) => (
            <BrandPanel
              key={brand}
              brand={brand}
              rows={brandGroups[brand]}
              revDomain={revDomain}
              bkgDomain={bkgDomain}
              medianRevenue={medianRevenue}
              hideYAxis={i > 0 && brand !== "SLIMMING"}
              onClick={(slug) => router.push(`/crm/individual/${slug}`)}
            />
          ))}
        </div>

        {inactiveRows.length > 0 && (
          <div className="mx-4 mt-3 border-t border-gray-100 pt-3 pb-2">
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
