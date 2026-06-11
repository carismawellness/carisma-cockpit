"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { useSpaRetail } from "@/lib/hooks/useSpaRetail";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import { BRAND } from "@/lib/constants/design-tokens";
import { ShoppingBag, Users, Building2, Percent } from "lucide-react";
import {
  BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Cell,
} from "recharts";

// Industry-standard wholesale assumption for spa retail products. Used to
// project gross profit per employee until a real cost feed is wired up.
const COGS_RATE = 0.20;

const VAT_RATE = 0.18;

/* ── Formatters ───────────────────────────────────────────────────────────── */

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function pct(num: number, denom: number, dp = 1): string {
  if (!denom) return "—";
  return `${((num / denom) * 100).toFixed(dp)}%`;
}

/* ── Content ──────────────────────────────────────────────────────────────── */

function SpaRetailContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const retail = useSpaRetail(dateFrom, dateTo);
  const { locations, totals: spaTotals } = useSpaRevenue(dateFrom, dateTo);

  // Service revenue per location for the "retail share of total" overlay.
  const serviceByLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const loc of locations) map.set(loc.name, loc.services);
    return map;
  }, [locations]);

  const totalSpaGross = spaTotals.gross_revenue;        // inc-VAT
  const retailGross   = retail.totals.revenue_gross;    // inc-VAT
  const retailShare   = totalSpaGross > 0 ? (retailGross / totalSpaGross) * 100 : 0;

  /* ── Per-location chart data with retail-share overlay ────────────────── */
  const locationChartData = useMemo(() => {
    return retail.byLocation.map((l) => {
      const serviceGross = serviceByLoc.get(l.name) ?? 0;
      const totalForLoc  = serviceGross + l.revenue_gross;
      const share        = totalForLoc > 0 ? (l.revenue_gross / totalForLoc) * 100 : 0;
      return {
        name:          l.name,
        color:         l.color,
        revenue:       l.revenue_gross,
        sharePct:      +share.toFixed(1),
        tx_count:      l.tx_count,
      };
    });
  }, [retail.byLocation, serviceByLoc]);

  /* ── Per-employee chart data with COGS + profit layers ────────────────── */
  const employeeChartData = useMemo(() => {
    return retail.byEmployee
      .filter((e) => e.revenue_gross > 0)
      .slice(0, 20)            // top 20 for readability
      .map((e) => {
        const cogs    = Math.round(e.revenue_gross * COGS_RATE);
        const profit  = e.revenue_gross - cogs;
        return {
          name:     e.employee_name,
          profit,                                   // stack bottom
          cogs,                                     // stack top
          revenue:  e.revenue_gross,                // total — used for label
          tx_count: e.tx_count,
          aov:      e.tx_count > 0 ? Math.round(e.revenue_gross / e.tx_count) : 0,
        };
      });
  }, [retail.byEmployee]);

  const isLoading = retail.isFetching;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Spa Retail</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Gross (inc-VAT) · Source: Cockpit Datasheet — Retail-Spa tab
        </p>
      </div>

      {/* ── KPI Row ───────────────────────────────────────────────────── */}
      <SalesKPIGrid columns={4}>
        <div className="h-full">
          <SalesKPICard
            label="Retail Revenue"
            value={isLoading ? "—" : fmtK(retailGross)}
            subtitle={`${fmtK(Math.round(retailGross / (1 + VAT_RATE)))} ex-VAT · ${retail.totals.tx_count.toLocaleString()} sales`}
            icon={ShoppingBag}
          />
        </div>
        <div className="h-full">
          <SalesKPICard
            label="Retail % of Spa"
            value={isLoading ? "—" : `${retailShare.toFixed(1)}%`}
            subtitle={`Total Spa: ${fmtK(totalSpaGross)}`}
            icon={Percent}
          />
        </div>
        <div className="h-full">
          <SalesKPICard
            label="Average Sale"
            value={isLoading ? "—" : fmtK(retail.totals.aov)}
            subtitle="Per retail transaction (inc-VAT)"
            icon={Users}
          />
        </div>
        <div className="h-full">
          <SalesKPICard
            label="Est. Gross Profit"
            value={isLoading ? "—" : fmtK(Math.round(retailGross * (1 - COGS_RATE)))}
            subtitle={`Assumes ${Math.round(COGS_RATE * 100)}% COGS`}
            icon={Building2}
          />
        </div>
      </SalesKPIGrid>

      {/* ── Retail by Branch ─────────────────────────────────────────── */}
      <Card className="p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Retail by Branch</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bars: gross retail revenue · Line: retail share of branch total (retail + services)
          </p>
        </div>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
            Loading retail by branch…
          </div>
        ) : locationChartData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            No retail transactions in the selected period.
          </div>
        ) : (
          <div className="h-[320px] md:h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={locationChartData}
                margin={{ top: 36, right: 56, left: 12, bottom: 8 }}
                barCategoryGap="22%"
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#374151", fontWeight: 500 }}
                  interval={0}
                />
                <YAxis
                  yAxisId="left"
                  tickFormatter={(v) => fmtK(Number(v))}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  width={60}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  width={44}
                  domain={[0, "auto"]}
                />
                <Tooltip
                  formatter={(v: unknown, name) => {
                    const n = String(name ?? "");
                    if (n === "Retail share") return [`${Number(v).toFixed(1)}%`, n];
                    return [fmtK(Number(v)), n];
                  }}
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} iconType="square" iconSize={12} />
                <Bar
                  yAxisId="left"
                  dataKey="revenue"
                  name="Retail revenue"
                  barSize={56}
                  radius={[4, 4, 0, 0]}
                >
                  {locationChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="revenue"
                    position="top"
                    formatter={(v: unknown) => fmtK(Number(v))}
                    style={{ fontSize: 11, fontWeight: 700, fill: "#111827" }}
                  />
                </Bar>
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="sharePct"
                  name="Retail share"
                  stroke={BRAND.spa.dark}
                  strokeWidth={2.5}
                  strokeDasharray="4 3"
                  dot={{ r: 4, fill: BRAND.spa.dark, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                >
                  <LabelList
                    dataKey="sharePct"
                    position="top"
                    formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                    style={{ fontSize: 10, fontWeight: 600, fill: BRAND.spa.dark }}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ── Retail by Employee ────────────────────────────────────────── */}
      <Card className="p-4 md:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Retail by Employee</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stack: estimated gross profit (80%) + COGS layer ({Math.round(COGS_RATE * 100)}% assumed) · top {employeeChartData.length}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BRAND.spa.dark }} />
              <span>Est. profit (80%)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BRAND.spa.soft }} />
              <span>COGS ({Math.round(COGS_RATE * 100)}%)</span>
            </span>
          </div>
        </div>
        {isLoading ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
            Loading retail by employee…
          </div>
        ) : employeeChartData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            No retail transactions in the selected period.
          </div>
        ) : (
          <div style={{ height: Math.max(280, employeeChartData.length * 36 + 80) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={employeeChartData}
                margin={{ top: 8, right: 100, left: 12, bottom: 8 }}
                barCategoryGap="18%"
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => fmtK(Number(v))}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "#374151" }}
                  width={140}
                  interval={0}
                />
                <Tooltip
                  formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                />
                <Bar dataKey="profit" name="Est. profit (80%)" stackId="r" fill={BRAND.spa.dark} />
                <Bar dataKey="cogs"   name="COGS (20%)"        stackId="r" fill={BRAND.spa.soft} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="revenue"
                    position="right"
                    formatter={(v: unknown) => fmtK(Number(v))}
                    style={{ fontSize: 11, fontWeight: 700, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ── Brand mix table ──────────────────────────────────────────── */}
      <Card className="p-4 md:p-6 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Brand Mix</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Retail revenue per product brand
          </p>
        </div>
        {isLoading ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
            Loading brand mix…
          </div>
        ) : retail.byBrand.length === 0 ? (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            No retail brand data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left py-2 font-medium">Brand</th>
                  <th className="text-right py-2 font-medium">Revenue (inc-VAT)</th>
                  <th className="text-right py-2 font-medium">Transactions</th>
                  <th className="text-right py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {retail.byBrand.map((b) => (
                  <tr key={b.brand} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2">{b.brand}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{fmtK(b.revenue_gross)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{b.tx_count.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{b.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">{fmtK(retailGross)}</td>
                  <td className="py-2 text-right tabular-nums">{retail.totals.tx_count.toLocaleString()}</td>
                  <td className="py-2 text-right tabular-nums">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Discount section (data-gap disclosure) ───────────────────── */}
      <Card className="p-4 md:p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Discount Analysis</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              % of retail sales discounted · by location
            </p>
          </div>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Live discount tracking is not yet wired up</p>
          <p className="mt-1 text-xs leading-relaxed">
            The Cockpit Retail-Spa tab doesn&apos;t expose a list price or discount column today, so we
            can&apos;t compute % discounted live. Historic discount data exists in <code className="bg-amber-100 px-1 py-0.5 rounded">spa_transactions_raw</code>
            (2014–2023). To enable this chart for the current period, add <em>List Price</em> and
            <em> Discount %</em> columns to the Retail-Spa sheet and we&apos;ll wire it up in the ETL.
          </p>
        </div>
      </Card>
    </div>
  );
}

/* ── Page export ──────────────────────────────────────────────────────────── */

export default function SpaRetailPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <SpaRetailContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
