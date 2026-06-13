"use client";

import { useEffect, useMemo, useRef } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { useAestheticsSales } from "@/lib/hooks/useAestheticsSales";
import { useSalaryRoster } from "@/lib/hooks/useSalaryRoster";
import { formatCurrency } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";
import { FileSpreadsheet } from "lucide-react";
import { SyncButton } from "@/components/dashboard/SyncButton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
  Treemap,
} from "recharts";

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

// Cell renderer for the service/product treemap. Recharts passes geometry
// (x/y/width/height) and node data (name, value, fill) to content. We only
// label cells big enough to fit text — small "long tail" cells stay visual
// but unlabeled, which is the whole point of replacing the long table.
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
  const { x = 0, y = 0, width = 0, height = 0, name = "", value = 0, fill = "#cbd5e1", depth = 1, totalRev = 0 } = props;
  if (depth === 0) return null; // root container — no rect
  const pct = totalRev > 0 ? (value / totalRev) * 100 : 0;
  const showName  = width > 56 && height > 22;
  const showValue = width > 70 && height > 38;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#ffffff" strokeWidth={2} />
      {showName && (
        <text x={x + 6} y={y + 14} fill="#ffffff" fontSize={11} fontWeight={600}>
          {name.length > Math.floor(width / 7) ? `${name.slice(0, Math.floor(width / 7) - 1)}…` : name}
        </text>
      )}
      {showValue && (
        <text x={x + 6} y={y + 28} fill="rgba(255,255,255,0.85)" fontSize={10}>
          {value >= 1000 ? `€${(value / 1000).toFixed(1)}K` : `€${value.toFixed(0)}`} · {pct.toFixed(1)}%
        </text>
      )}
    </g>
  );
}

function AestheticsSalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { byPerson, byService, byCashType, totals, isFetching, isSyncing, syncError, triggerSync } =
    useAestheticsSales(dateFrom, dateTo);

  const syncedRef = useRef(false);
  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      triggerSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lyDateFrom = useMemo(
    () => new Date(dateFrom.getFullYear() - 1, dateFrom.getMonth(), dateFrom.getDate()),
    [dateFrom]
  );
  const lyDateTo = useMemo(
    () => new Date(dateTo.getFullYear() - 1, dateTo.getMonth(), dateTo.getDate()),
    [dateTo]
  );
  const { totals: lyTotals } = useAestheticsSales(lyDateFrom, lyDateTo, { skipSync: true });

  const yoy = useMemo(() => {
    const calc = (curr: number, prior: number) => prior > 0 ? ((curr - prior) / prior) * 100 : undefined;
    return {
      net:      calc(totals.revenue_inc, lyTotals.revenue_inc),
      bookings: calc(totals.tx_count,    lyTotals.tx_count),
    };
  }, [totals, lyTotals]);

  const { getAesSalary } = useSalaryRoster(dateFrom, dateTo);

  const GROUP_ORDER = ["Face", "Body", "Packages", "Membership", "Consultation", "Admin", "Other"] as const;
  const GROUP_COLORS: Record<string, string> = {
    Face:         "#6366f1",
    Body:         "#0ea5e9",
    Packages:     "#a855f7",
    Membership:   "#22c55e",
    Consultation: "#94a3b8",
    Admin:        "#f59e0b",
    Other:        "#cbd5e1",
  };

  const byGroup = useMemo(() => {
    const map = new Map<string, typeof byService>();
    for (const s of byService) {
      const g = s.nav_group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return GROUP_ORDER
      .filter(g => map.has(g))
      .map(g => ({
        group:         g,
        color:         GROUP_COLORS[g] ?? "#cbd5e1",
        services:      map.get(g)!,
        total_revenue: map.get(g)!.reduce((s, v) => s + v.revenue_inc, 0),
        total_count:   map.get(g)!.reduce((s, v) => s + v.tx_count, 0),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byService]);

  // Flat treemap input — one rectangle per service, coloured by its nav group.
  // Recharts Treemap with single-level data is more reliable than the nested
  // children API; visual grouping comes from shared fill colour.
  const treemapData = useMemo(() =>
    byGroup.flatMap(g =>
      g.services
        .filter(s => s.revenue_inc > 0)
        .map(s => ({
          name: s.service,
          size: s.revenue_inc,
          fill: g.color,
          group: g.group,
        }))
    ),
    [byGroup]
  );

  // Enrich byPerson with salary overlay. Sales surface uses gross (inc-VAT);
  // K% is salary ÷ gross-revenue (display metric, not the EBITDA labour ratio).
  const byPersonEnriched = useMemo(() =>
    byPerson.map(bp => {
      const salary = getAesSalary(bp.person);
      const revStr = bp.revenue_inc >= 1000 ? `€${(bp.revenue_inc / 1000).toFixed(1)}K` : `€${bp.revenue_inc}`;
      if (!salary) return {
        ...bp,
        salary_cost: 0,
        revenue_net: bp.revenue_inc,
        k_pct: null as number | null,
        k_label: null as string | null,
        bar_label: revStr,
      };
      const salary_cost = Math.min(salary, bp.revenue_inc);
      const k_pct = bp.revenue_inc > 0 ? +(salary / bp.revenue_inc * 100).toFixed(1) : null;
      return {
        ...bp,
        salary_cost,
        revenue_net: Math.max(0, bp.revenue_inc - salary_cost),
        k_pct,
        k_label: k_pct != null ? `${k_pct.toFixed(0)}%` : null as string | null,
        bar_label: revStr,
      };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byPerson, getAesSalary]
  );

  const hasCostData = byPersonEnriched.some(b => b.salary_cost > 0);

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
            Aesthetics — Sales
          </h1>
          <p className="text-sm text-muted-foreground">
            All figures in EUR · gross (inc-VAT)
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=2033734488"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Cockpit Datasheet — Aesthetics ↗
            </a>
          </div>
        </div>
        <SyncButton
          onSync={async () => { triggerSync(); }}
          lastSynced={totals.last_synced}
          isExternalBusy={isSyncing || isFetching}
        />
      </div>
      {syncError && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{syncError}</p>
      )}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="Gross Revenue"
          value={fmtK(totals.revenue_inc)}
          subtitle={`inc-VAT · ${totals.tx_count} bookings`}
          yoyChange={yoy.net}
        />
        <SalesKPICard
          label="Bookings"
          value={String(totals.tx_count)}
          subtitle={totals.tx_count > 0 ? `${fmtK(Math.round(totals.revenue_inc / totals.tx_count))} avg per booking` : undefined}
          yoyChange={yoy.bookings}
        />
        {(() => {
          const cash    = byCashType.find(c => c.category === "Cash");
          const nonCash = byCashType.find(c => c.category === "Non-Cash");
          return (
            <SalesKPICard
              label="Cash vs Non-Cash"
              value={`${cash?.pct ?? 0}% Cash`}
              subtitle={`${fmtK(cash?.revenue_inc ?? 0)} cash · ${fmtK(nonCash?.revenue_inc ?? 0)} card/transfer · inc-VAT`}
            />
          );
        })()}
      </SalesKPIGrid>

      {/* ── Revenue by Employee ───────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-foreground">Revenue by Employee</h2>
          <span className="text-xs text-muted-foreground">(col H — Employee)</span>
          {hasCostData && (
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: BRAND.aesthetics.soft }} />
                Revenue (inc-VAT, net of salary)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#4a7fa5" }} />
                Salary cost (K%)
              </span>
            </div>
          )}
        </div>
        {byPersonEnriched.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isFetching || isSyncing ? "Loading…" : "No data for selected period"}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, byPersonEnriched.length * 48)}>
            <BarChart
              layout="vertical"
              data={byPersonEnriched}
              margin={{ top: 20, right: 100, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="person"
                width={90}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value, name, entry) => {
                  const n = Number(value ?? 0);
                  const p = entry.payload as typeof byPersonEnriched[0];
                  if (name === "revenue_net") {
                    const label = hasCostData && p.salary_cost > 0
                      ? `${formatCurrency(p.revenue_inc)} total · K%=${p.k_pct != null ? p.k_pct.toFixed(0) : "—"}% · ${p.tx_count} bookings`
                      : `${formatCurrency(n)} · ${p.tx_count} bookings`;
                    return [label, "Revenue (inc-VAT)"];
                  }
                  return [`${formatCurrency(n)} salary cost`, "Salary (K%)"];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              {hasCostData ? (
                <>
                  <Bar dataKey="revenue_net" stackId="rev" fill={BRAND.aesthetics.soft} radius={[0, 0, 0, 0]}>
                    {/* Fallback label for employees with no salary record:
                        salary_cost is 0 so the LabelList on the salary bar
                        skips rendering. Print bar_label at the end of the
                        revenue bar in that case. */}
                    <LabelList
                      dataKey="bar_label"
                      content={({ x, y, width, height, value, index }) => {
                        if (index == null) return null;
                        const row = byPersonEnriched[index];
                        if (!row || (row.salary_cost ?? 0) > 0) return null;
                        const cx = (Number(x) || 0) + (Number(width) || 0) + 6;
                        const cy = (Number(y) || 0) + (Number(height) || 0) / 2 + 4;
                        return <text x={cx} y={cy} fontSize={11} fill="#111827" fontWeight={600}>{String(value ?? "")}</text>;
                      }}
                    />
                  </Bar>
                  <Bar dataKey="salary_cost" stackId="rev" fill="#4a7fa5" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="k_label"
                      position="insideRight"
                      formatter={(v: unknown) => v ? String(v) : ""}
                      style={{ fontSize: 11, fill: "#ffffff", fontWeight: 700 }}
                    />
                    <LabelList
                      dataKey="bar_label"
                      position="right"
                      formatter={(v: unknown) => String(v ?? "")}
                      style={{ fontSize: 11, fill: "#111827", fontWeight: 600 }}
                    />
                  </Bar>
                </>
              ) : (
                <Bar dataKey="revenue_inc" fill={BRAND.aesthetics.soft} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="revenue_inc"
                    position="right"
                    formatter={(v: unknown) => fmtK(Number(v))}
                    style={{ fontSize: 11, fill: "#111827", fontWeight: 600 }}
                  />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Revenue by Service — treemap (area = revenue, colour = category) ── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground">Revenue by Service / Product</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each rectangle = one service · Area = revenue share · Colour = category
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-base font-bold tabular-nums">{fmtK(totals.revenue_inc)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{totals.tx_count.toLocaleString()} bookings</p>
          </div>
        </div>

        {byService.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isFetching || isSyncing ? "Loading…" : "No data for selected period"}
          </p>
        ) : (
          <>
            {/* Category legend strip — subtotals per nav group */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px]">
              {byGroup.map(({ group, color, total_revenue, total_count }) => {
                const pct = totals.revenue_inc > 0 ? (total_revenue / totals.revenue_inc) * 100 : 0;
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

            {/* Treemap */}
            <ResponsiveContainer width="100%" height={420}>
              <Treemap
                data={treemapData}
                dataKey="size"
                stroke="#fff"
                fill="#cbd5e1"
                content={<TreemapCell totalRev={totals.revenue_inc} />}
                animationDuration={400}
              />
            </ResponsiveContainer>
          </>
        )}
      </Card>

    </>
  );
}

export default function AestheticsSalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <AestheticsSalesContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
