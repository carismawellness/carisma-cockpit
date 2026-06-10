"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
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
} from "recharts";

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
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
        total_revenue: map.get(g)!.reduce((s, v) => s + v.revenue_ex, 0),
        total_count:   map.get(g)!.reduce((s, v) => s + v.tx_count, 0),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byService]);

  // Enrich byPerson with salary overlay
  const byPersonEnriched = useMemo(() =>
    byPerson.map(bp => {
      const salary = getAesSalary(bp.person);
      const revStr = bp.revenue_ex >= 1000 ? `€${(bp.revenue_ex / 1000).toFixed(1)}K` : `€${bp.revenue_ex}`;
      if (!salary) return {
        ...bp,
        salary_cost: 0,
        revenue_net: bp.revenue_ex,
        k_pct: null as number | null,
        k_label: null as string | null,
        bar_label: revStr,
      };
      const salary_cost = Math.min(salary, bp.revenue_ex);
      const k_pct = bp.revenue_ex > 0 ? +(salary / bp.revenue_ex * 100).toFixed(1) : null;
      return {
        ...bp,
        salary_cost,
        revenue_net: Math.max(0, bp.revenue_ex - salary_cost),
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
            All figures in EUR · ex-VAT and inc-VAT shown
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
          label="Net Revenue"
          value={fmtK(totals.revenue_inc)}
          subtitle={`${fmtK(totals.revenue_ex)} ex-VAT · ${totals.tx_count} bookings · VAT ${fmtK(totals.vat_amount)}`}
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
              subtitle={`${fmtK(cash?.revenue_ex ?? 0)} cash · ${fmtK(nonCash?.revenue_ex ?? 0)} card/transfer`}
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
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: BRAND.aesthetics.dark }} />
                Net revenue
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
                      ? `${formatCurrency(p.revenue_ex)} total · K%=${p.k_pct != null ? p.k_pct.toFixed(0) : "—"}% · ${p.tx_count} bookings`
                      : `${formatCurrency(n)} · ${p.tx_count} bookings · VAT ${(p.vat_rate * 100).toFixed(0)}%`;
                    return [label, "Revenue ex-VAT"];
                  }
                  return [`${formatCurrency(n)} salary cost`, "Salary (K%)"];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              {hasCostData ? (
                <>
                  <Bar dataKey="revenue_net" stackId="rev" fill={BRAND.aesthetics.dark} radius={[0, 0, 0, 0]} />
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
                <Bar dataKey="revenue_ex" fill={BRAND.aesthetics.dark} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="revenue_ex"
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

      {/* ── Revenue by Service — grouped by nav category ─────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-foreground">Revenue by Service / Product</h2>
          <span className="text-xs text-muted-foreground">grouped by website nav category</span>
        </div>
        {byService.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isFetching || isSyncing ? "Loading…" : "No data for selected period"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium w-[38%]">Service / Product</th>
                  <th className="text-left pb-2 font-medium">Category</th>
                  <th className="text-right pb-2 font-medium">Bookings</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {byGroup.map(({ group, color, services, total_revenue, total_count }) => (
                  <Fragment key={group}>
                    {/* Group header row */}
                    <tr className="border-y border-muted bg-muted/20">
                      <td colSpan={2} className="py-2 pl-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-4 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{group}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground font-medium pr-0.5 tabular-nums">{total_count}</td>
                      <td className="py-2 text-right text-xs font-semibold tabular-nums">{fmtK(total_revenue)}</td>
                      <td className="py-2 pl-4 text-xs text-muted-foreground tabular-nums">
                        {totals.revenue_ex > 0 ? `${((total_revenue / totals.revenue_ex) * 100).toFixed(1)}%` : ""}
                      </td>
                    </tr>
                    {/* Individual services */}
                    {services.map(s => (
                      <tr key={s.service} className="border-b last:border-0 hover:bg-muted/10">
                        <td className="py-2 pl-5 font-medium">{s.service}</td>
                        <td className="py-2">
                          <span className="text-xs text-muted-foreground">{s.nav_category}</span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground tabular-nums">{s.tx_count}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(s.revenue_ex)}</td>
                        <td className="py-2 pl-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${s.pct}%`, backgroundColor: color }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">{s.pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="pt-2.5" colSpan={2}>Total</td>
                  <td className="pt-2.5 text-right text-muted-foreground tabular-nums">{totals.tx_count}</td>
                  <td className="pt-2.5 text-right tabular-nums">{formatCurrency(totals.revenue_ex)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
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
