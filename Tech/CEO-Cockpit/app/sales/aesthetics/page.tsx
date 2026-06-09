"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useAestheticsSales } from "@/lib/hooks/useAestheticsSales";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import { RefreshCw, FileSpreadsheet } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

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

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────────── */}
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

      {/* ── Revenue Summary ──────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Revenue from Google Sheets</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totals.last_synced
                ? `Last synced: ${new Date(totals.last_synced).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`
                : "Not yet synced"}
            </p>
          </div>
          <button
            onClick={triggerSync}
            disabled={isSyncing || isFetching}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing…" : "Sync from Google Sheets"}
          </button>
        </div>
        {syncError && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2 mb-3">{syncError}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Revenue ex-VAT</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(totals.revenue_ex)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Revenue inc-VAT</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(totals.revenue_inc)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">VAT Amount</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(totals.vat_amount)}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Bookings</p>
            <p className="text-xl font-bold text-foreground">{totals.tx_count}</p>
          </div>
        </div>
      </Card>

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
              margin={{ top: 0, right: 64, left: 0, bottom: 0 }}
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
              <Bar dataKey="revenue_ex" fill={chartColors.aesthetics} radius={[0, 4, 4, 0]} />
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
