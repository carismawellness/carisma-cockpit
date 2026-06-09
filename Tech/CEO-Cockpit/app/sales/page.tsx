"use client";

import { useMemo } from "react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import { useAestheticsSales } from "@/lib/hooks/useAestheticsSales";
import { useSlimmingSales } from "@/lib/hooks/useSlimmingSales";
import {
  Bar,
  BarChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { RefreshCw, AlertCircle, FileSpreadsheet } from "lucide-react";

const VAT_RATE = 0.18;

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function SalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const spa  = useSpaRevenue(dateFrom, dateTo);
  const aes  = useAestheticsSales(dateFrom, dateTo);
  const slim = useSlimmingSales(dateFrom, dateTo);

  const isLoading = spa.isFetching || spa.isSyncing || aes.isFetching || aes.isSyncing || slim.isFetching || slim.isSyncing;

  const spaNet = useMemo(() => Math.round(spa.totals.net_revenue * (1 + VAT_RATE)), [spa.totals]);

  const aesTotal  = aes.totals.revenue_inc;
  const slimTotal = slim.totals.revenue_inc;

  const totalNet = spaNet + aesTotal + slimTotal;

  const brandChartData = useMemo(() => [
    { brand: "Spa",        revenue: spaNet,    fill: chartColors.spa        },
    { brand: "Aesthetics", revenue: aesTotal,  fill: chartColors.aesthetics },
    { brand: "Slimming",   revenue: slimTotal, fill: chartColors.slimming   },
  ], [spaNet, aesTotal, slimTotal]);

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Sales Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDateRangeLabel(dateFrom, dateTo)} · Company-wide performance across all brands
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <a
              href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=1979027354"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Cockpit Datasheet — Spa ↗
            </a>
            <a
              href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=1770739089"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Cockpit Datasheet — Aesthetics ↗
            </a>
            <a
              href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=506676479"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Cockpit Datasheet — Slimming ↗
            </a>
          </div>
        </div>
        <button
          onClick={() => { spa.triggerSync(true); aes.triggerSync(); slim.triggerSync(); }}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          {isLoading ? "Syncing…" : "Re-Sync All"}
        </button>
      </div>

      {spa.syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Spa: {spa.syncError}</span>
        </div>
      )}
      {aes.syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Aesthetics: {aes.syncError}</span>
        </div>
      )}
      {slim.syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Slimming: {slim.syncError}</span>
        </div>
      )}

      {/* ── Brand Snapshot ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.spa }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Spa
            {(spa.isFetching || spa.isSyncing) && <RefreshCw className="inline h-3 w-3 ml-1.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(spaNet)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {spa.totals.net_revenue > 0
              ? `${formatCurrency(spa.totals.net_revenue)} ex-VAT`
              : (spa.isFetching || spa.isSyncing) ? "Loading…" : "No data"}
          </p>
        </Card>
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.aesthetics }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Aesthetics
            {(aes.isFetching || aes.isSyncing) && <RefreshCw className="inline h-3 w-3 ml-1.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(aesTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {aes.totals.tx_count > 0
              ? `${aes.totals.tx_count} transactions`
              : (aes.isFetching || aes.isSyncing) ? "Loading…" : "No data"}
          </p>
        </Card>
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.slimming }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Slimming
            {(slim.isFetching || slim.isSyncing) && <RefreshCw className="inline h-3 w-3 ml-1.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(slimTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {slim.totals.tx_count > 0
              ? `${slim.totals.tx_count} transactions`
              : (slim.isFetching || slim.isSyncing) ? "Loading…" : "No data"}
          </p>
        </Card>
        <Card className="p-3 md:p-5 border-l-4 border-l-foreground/30">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Group</p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(totalNet)}</p>
          <p className="text-xs text-muted-foreground mt-1">All brands · inc-VAT</p>
        </Card>
      </div>

      {/* ── Revenue by Brand ────────────────────────────────────── */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Brand</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Total revenue per brand · inc-VAT · Cockpit Datasheet
        </p>
        <div className="h-[260px] md:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={brandChartData} margin={{ top: 32, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="brand" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: unknown) => [formatCurrency(Number(v)), "Revenue"]} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="revenue" name="Revenue" radius={[3, 3, 0, 0]}>
                {brandChartData.map((entry) => (
                  <Cell key={entry.brand} fill={entry.fill} />
                ))}
                <LabelList
                  dataKey="revenue"
                  position="top"
                  formatter={(v: unknown) => formatCurrency(Number(v))}
                  style={{ fontSize: 11, fontWeight: 700, fill: "#374151" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <CIChat />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

export default function SalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <SalesContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
