"use client";

import { ResponsiveContainer, Treemap } from "recharts";

/* ── Public types ─────────────────────────────────────────────────────────── */

export interface ServiceTreemapRow {
  service: string;
  revenue: number;
  tx_count: number;
  nav_group: string;
}

export interface ServiceTreemapGroup {
  group: string;
  color: string;
  services: ServiceTreemapRow[];
  total_revenue: number;
  total_count: number;
}

interface Props {
  title?: string;
  subtitle?: string;
  byGroup: ServiceTreemapGroup[];
  totalRevenue: number;
  totalCount: number;
  loading?: boolean;
  emptyLabel?: string;
  height?: number;
  /** Optional QC line shown under the total — e.g. "matches Spa KPI €76.0K". */
  qcLine?: React.ReactNode;
}

/* ── Cell renderer ─────────────────────────────────────────────────────────── */

interface TreemapCellProps {
  x?:        number;
  y?:        number;
  width?:    number;
  height?:   number;
  name?:     string;
  value?:    number;
  fill?:     string;
  depth?:    number;
  totalRev?: number;
}

function TreemapCell(props: TreemapCellProps) {
  const {
    x = 0, y = 0, width = 0, height = 0,
    name = "", value = 0, fill = "#cbd5e1",
    depth = 1, totalRev = 0,
  } = props;
  if (depth === 0) return null;
  const pct       = totalRev > 0 ? (value / totalRev) * 100 : 0;
  const showName  = width > 56 && height > 22;
  const showValue = width > 70 && height > 38;
  const maxChars  = Math.floor(width / 7);
  const truncated = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
  const fmt = (v: number) =>
    v >= 1000 ? `€${(v / 1000).toFixed(1)}K` : `€${v.toFixed(0)}`;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#ffffff" strokeWidth={2} />
      {showName && (
        <text x={x + 6} y={y + 14} fill="#ffffff" fontSize={11} fontWeight={600}>
          {truncated}
        </text>
      )}
      {showValue && (
        <text x={x + 6} y={y + 28} fill="rgba(255,255,255,0.85)" fontSize={10}>
          {fmt(value)} · {pct.toFixed(1)}%
        </text>
      )}
    </g>
  );
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function ServiceTreemap({
  title    = "Revenue by Service / Product",
  subtitle = "Each rectangle = one service · Area = revenue share · Colour = category",
  byGroup,
  totalRevenue,
  totalCount,
  loading = false,
  emptyLabel,
  height = 420,
  qcLine,
}: Props) {
  const treemapData = byGroup.flatMap(g =>
    g.services
      .filter(s => s.revenue > 0)
      .map(s => ({
        name: s.service,
        size: s.revenue,
        fill: g.color,
        group: g.group,
      }))
  );

  const fmtK = (v: number) =>
    Math.abs(v) >= 1_000_000 ? `€${(v / 1_000_000).toFixed(1)}M`
    : Math.abs(v) >= 1_000   ? `€${(v / 1_000).toFixed(1)}K`
    : `€${v.toFixed(0)}`;

  return (
    <div className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-base font-bold tabular-nums">{fmtK(totalRevenue)}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{totalCount.toLocaleString()} bookings</p>
          {qcLine && <div className="mt-1">{qcLine}</div>}
        </div>
      </div>

      {treemapData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {loading ? "Loading…" : (emptyLabel ?? "No data for selected period")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px]">
            {byGroup.map(({ group, color, total_revenue, total_count }) => {
              const pct = totalRevenue > 0 ? (total_revenue / totalRevenue) * 100 : 0;
              return (
                <div key={group} className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="font-medium text-foreground">{group}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtK(total_revenue)} · {pct.toFixed(1)}% · {total_count} tx
                  </span>
                </div>
              );
            })}
          </div>

          <ResponsiveContainer width="100%" height={height}>
            <Treemap
              data={treemapData}
              dataKey="size"
              stroke="#fff"
              fill="#cbd5e1"
              content={<TreemapCell totalRev={totalRevenue} />}
              animationDuration={400}
            />
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
