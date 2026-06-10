"use client";

import { useEffect, useMemo, useRef } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { useAestheticsSales } from "@/lib/hooks/useAestheticsSales";
import { chartColors, formatCurrency } from "@/lib/charts/config";
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
  const { byPerson, byService, totals, isFetching, isSyncing, syncError, triggerSync } =
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
      </SalesKPIGrid>

      {/* ── Revenue by Employee ───────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-foreground">Revenue by Employee</h2>
          <span className="text-xs text-muted-foreground">(col H — Employee)</span>
        </div>
        {byPerson.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isFetching || isSyncing ? "Loading…" : "No data for selected period"}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, byPerson.length * 48)}>
            <BarChart
              layout="vertical"
              data={byPerson}
              margin={{ top: 0, right: 72, left: 0, bottom: 0 }}
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
                formatter={(value, _name, entry) => [
                  `${formatCurrency(Number(value ?? 0))} · ${entry.payload.tx_count} bookings · VAT ${(entry.payload.vat_rate * 100).toFixed(0)}%`,
                  "Revenue ex-VAT",
                ]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="revenue_ex" fill={chartColors.aesthetics} radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="revenue_ex"
                  position="right"
                  formatter={(v: unknown) => { const n = Number(v); return n >= 1000 ? `€${(n / 1000).toFixed(1)}K` : `€${n}`; }}
                  style={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* ── Revenue by Service ────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Revenue by Service / Product</h2>
        {byService.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isFetching || isSyncing ? "Loading…" : "No data for selected period"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Service / Product</th>
                  <th className="text-right pb-2 font-medium">Bookings</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {byService.map((s, i) => (
                  <tr key={s.service} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    <td className="py-2.5 font-medium">{s.service}</td>
                    <td className="py-2.5 text-right text-muted-foreground">{s.tx_count}</td>
                    <td className="py-2.5 text-right font-medium">{formatCurrency(s.revenue_ex)}</td>
                    <td className="py-2.5 pl-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${s.pct}%`, backgroundColor: chartColors.aesthetics }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{s.pct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
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
