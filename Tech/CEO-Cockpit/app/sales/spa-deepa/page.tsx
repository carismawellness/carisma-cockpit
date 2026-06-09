"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { ServiceBreakdownChart } from "@/components/sales/ServiceBreakdownChart";
import { StaffPerformanceChart } from "@/components/sales/StaffPerformanceChart";
import { CIChat } from "@/components/ci/CIChat";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue, SpaRevenueLocation } from "@/lib/hooks/useSpaRevenue";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend, Cell,
} from "recharts";
import { RefreshCw, AlertCircle, TrendingDown, Database, FileSpreadsheet } from "lucide-react";

const VAT_RATE = 0.18;

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/* ═══════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

const COL_HEADERS = [
  { key: "services",         label: "Services",       color: "#1B3A4B" },
  { key: "product_phytomer", label: "Phytomer",       color: "#4A90D9" },
  { key: "product_purest",   label: "Purest",         color: "#7C3AED" },
  { key: "product_other",    label: "Other Products", color: "#96B2B2" },
  { key: "wholesale",        label: "Wholesale",      color: "#B79E61" },
  { key: "sales_discount",   label: "Discount",       color: "#dc2626", negative: true },
  { key: "sales_refund",     label: "Refund",         color: "#dc2626", negative: true },
  { key: "net_revenue",      label: "Net Revenue",    color: "#059669", bold: true },
];

function RevenueTable({ locations }: { locations: SpaRevenueLocation[] }) {
  if (!locations.length) return null;
  const totals = locations.reduce((acc, loc) => {
    COL_HEADERS.forEach(({ key }) => {
      acc[key] = (acc[key] ?? 0) + (loc[key as keyof SpaRevenueLocation] as number);
    });
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b">
            <th className="text-left px-3 py-2.5 font-semibold text-foreground sticky left-0 bg-muted/50 min-w-[130px]">Location</th>
            {COL_HEADERS.map(({ key, label, color, bold }) => (
              <th key={key} className="text-right px-3 py-2.5 font-semibold whitespace-nowrap"
                  style={{ color: bold ? color : undefined }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {locations.map((loc, i) => (
            <tr key={loc.location_id}
                className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/30 transition-colors`}>
              <td className="px-3 py-2 sticky left-0 font-medium text-foreground" style={{ background: "inherit" }}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: loc.color }} />
                  {loc.name}
                </div>
              </td>
              {COL_HEADERS.map(({ key, negative, bold }) => {
                const val = loc[key as keyof SpaRevenueLocation] as number;
                return (
                  <td key={key} className={`px-3 py-2 text-right tabular-nums ${bold ? "font-bold" : ""}`}
                      style={{ color: negative && val > 0 ? "#dc2626" : bold ? "#059669" : undefined }}>
                    {val > 0 ? (negative ? `(${fmtShort(val)})` : fmtShort(val)) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/50 font-semibold">
            <td className="px-3 py-2.5 sticky left-0 bg-muted/50">Total</td>
            {COL_HEADERS.map(({ key, negative, bold }) => {
              const val = totals[key] ?? 0;
              return (
                <td key={key} className="px-3 py-2.5 text-right tabular-nums font-bold"
                    style={{ color: negative && val > 0 ? "#dc2626" : bold ? "#059669" : undefined }}>
                  {val > 0 ? (negative ? `(${fmtShort(val)})` : fmtShort(val)) : "—"}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function SpaDeepaContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { locations, totals, isFetching, isSyncing, syncError, missingMonths, triggerSync } =
    useSpaRevenue(dateFrom, dateTo);

  const analytics = useSpaDeepaAnalytics(dateFrom, dateTo);

  const isLoading = isFetching || isSyncing;

  const subtitle = useMemo(() => {
    const range = formatDateRangeLabel(dateFrom, dateTo);
    return `${range} · Source: Lapis + Zoho Books`;
  }, [dateFrom, dateTo]);

  /* ── Inc-VAT totals ──────────────────────────────────────────── */
  const incVat = useMemo(() => ({
    net_revenue:   Math.round(totals.net_revenue   * (1 + VAT_RATE)),
    services:      Math.round(totals.services      * (1 + VAT_RATE)),
    product_total: Math.round(totals.product_total * (1 + VAT_RATE)),
    wholesale:     Math.round(totals.wholesale     * (1 + VAT_RATE)),
  }), [totals]);

  /* ── Revenue by hotel (stacked, inc-VAT, sorted desc) ────────── */
  const hotelChartData = useMemo(() =>
    [...locations].sort((a, b) => b.net_revenue - a.net_revenue).map((loc) => {
      const services  = Math.round(loc.services      * (1 + VAT_RATE));
      const products  = Math.round(loc.product_total * (1 + VAT_RATE));
      const wholesale = Math.round(loc.wholesale     * (1 + VAT_RATE));
      const gross     = services + products + wholesale;
      const net       = Math.round(loc.net_revenue   * (1 + VAT_RATE));
      return {
        name: loc.name.replace("InterContinental", "IC").replace("Sunny Coast", "SC"),
        color: loc.color,
        id:   loc.location_id,
        Services:  services,
        Products:  products,
        Wholesale: wholesale,
        gross,
        net,
      };
    }),
    [locations]
  );

  /* ── Revenue mix per hotel (% composition) ───────────────────── */
  const mixData = useMemo(() =>
    [...locations].sort((a, b) => b.net_revenue - a.net_revenue).map((loc) => {
      const gross = loc.services + loc.product_total + loc.wholesale;
      return {
        name:          loc.name.replace("InterContinental", "IC").replace("Sunny Coast", "SC"),
        "Services %":  gross > 0 ? Math.round((loc.services      / gross) * 100) : 0,
        "Products %":  gross > 0 ? Math.round((loc.product_total / gross) * 100) : 0,
        "Wholesale %": gross > 0 ? Math.round((loc.wholesale     / gross) * 100) : 0,
      };
    }),
    [locations]
  );

  /* ── Inc-VAT locations for breakdown table ───────────────────── */
  const incVatLocations = useMemo(() =>
    locations.map((loc) => ({
      ...loc,
      services:         Math.round(loc.services         * (1 + VAT_RATE)),
      product_phytomer: Math.round(loc.product_phytomer * (1 + VAT_RATE)),
      product_purest:   Math.round(loc.product_purest   * (1 + VAT_RATE)),
      product_other:    Math.round(loc.product_other    * (1 + VAT_RATE)),
      product_total:    Math.round(loc.product_total    * (1 + VAT_RATE)),
      wholesale:        Math.round(loc.wholesale        * (1 + VAT_RATE)),
      sales_discount:   Math.round(loc.sales_discount   * (1 + VAT_RATE)),
      sales_refund:     Math.round(loc.sales_refund     * (1 + VAT_RATE)),
      net_revenue:      Math.round(loc.net_revenue      * (1 + VAT_RATE)),
    })),
    [locations]
  );

  /* ── Staff chart data (real data from analytics hook, inc-VAT) ── */
  const staffChartData = useMemo(() =>
    analytics.staff.map((s) => ({
      name: s.name,
      serviceRevenue: Math.round(s.service_revenue * 1.18),
      retailRevenue:  Math.round(s.retail_revenue  * 1.18),
    })),
    [analytics.staff]
  );

  /* ── Guest group chart data ──────────────────────────────────── */
  const guestChartData = useMemo(() =>
    analytics.guestGroups.map((g) => ({
      name: g.name.replace("InterContinental", "IC").replace("Sunny Coast", "SC"),
      "Hotel Guests": g.hotel_revenue,
      "Non-Hotel":    g.non_hotel_revenue,
      hotelPct: (g.hotel_revenue + g.non_hotel_revenue) > 0
        ? Math.round(g.hotel_revenue / (g.hotel_revenue + g.non_hotel_revenue) * 100)
        : 0,
    })),
    [analytics.guestGroups]
  );

  /* ── Payment type chart data (inc-VAT) ───────────────────────── */
  const paymentData = useMemo(() =>
    analytics.paymentTypes.map((p) => ({
      service: p.type,
      revenue: Math.round(p.revenue * 1.18),
      pct:     p.pct,
    })),
    [analytics.paymentTypes]
  );

  /* ── Discount chart data (inc-VAT) ───────────────────────────── */
  const discountChartData = useMemo(() =>
    analytics.discounts
      .filter((d) => d.total_txn_count > 0)
      .map((d) => ({
        name:           d.name.replace("InterContinental", "IC").replace("Sunny Coast", "SC"),
        color:          d.color,
        "Discount %":   d.discount_pct,
        discount_amt:   Math.round(d.total_discount * 1.18),
      })),
    [analytics.discounts]
  );

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Spa — Deepa</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600">
              <Database className="h-3 w-3" />
              Lapis POS — Services &amp; Products
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600">
              <FileSpreadsheet className="h-3 w-3" />
              Zoho Books — Wholesale, Discounts &amp; Refunds
            </span>
          </div>
        </div>
        <button
          onClick={() => triggerSync(true)}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing…" : "Re-Sync"}
        </button>
      </div>

      {syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Sync error: {syncError}</span>
        </div>
      )}
      {missingMonths.length > 0 && !isSyncing && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Fetching data for {missingMonths.length} missing month{missingMonths.length > 1 ? "s" : ""}…</span>
        </div>
      )}
      {analytics.error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Analytics error: {analytics.error}</span>
        </div>
      )}

      {/* ── KPI Row ─────────────────────────────────────────────────── */}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="Net Revenue"
          value={fmtShort(incVat.net_revenue)}
          subtitle={`${fmtShort(totals.net_revenue)} ex-VAT · ${locations.length} locations`}
        />
        <SalesKPICard
          label="Service Revenue"
          value={fmtShort(incVat.services)}
          subtitle={`${pct(totals.services, totals.net_revenue)} of net`}
        />
        <SalesKPICard
          label="Retail Revenue"
          value={fmtShort(incVat.product_total)}
          subtitle={`${pct(totals.product_total, totals.net_revenue)} of net`}
        />
      </SalesKPIGrid>

      {/* ── Revenue by Hotel ───────────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Gross revenue (services + products + wholesale) · label = gross total · hover for net after deductions · inc 18% VAT
          </p>
          <div className="h-[280px] md:h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hotelChartData} margin={{ top: 24, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={(props) => {
                    const { active, payload, label } = props as unknown as { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string };
                    if (!active || !payload?.length) return null;
                    const entry = hotelChartData.find((d) => d.name === label);
                    return (
                      <div className="rounded-lg border border-border bg-background p-3 shadow-lg text-sm min-w-[180px]">
                        <p className="font-semibold text-foreground mb-2">{label}</p>
                        {payload.map((p) => (
                          <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="text-muted-foreground">{p.name}</span>
                            </div>
                            <span className="font-medium tabular-nums">{fmtShort(p.value)}</span>
                          </div>
                        ))}
                        {entry && (
                          <div className="border-t mt-2 pt-2 space-y-1">
                            <div className="flex justify-between text-xs font-semibold">
                              <span>Gross total</span><span>{fmtShort(entry.gross)}</span>
                            </div>
                            <div className="flex justify-between text-xs font-semibold text-emerald-600">
                              <span>Net (after deductions)</span><span>{fmtShort(entry.net)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend />
                <Bar dataKey="Services"  stackId="a" fill="#1B3A4B" />
                <Bar dataKey="Products"  stackId="a" fill="#4A90D9" />
                <Bar dataKey="Wholesale" stackId="a" fill="#B79E61" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="gross" content={(props) => {
                    const { x, width, y, value } = props as Record<string, unknown>;
                    const w = Number(width);
                    if (w < 20) return null;
                    return (
                      <text x={Number(x) + w / 2} y={Number(y) - 7} textAnchor="middle" fontSize={10} fontWeight={700} fill="#374151">
                        {fmtShort(Number(value))}
                      </text>
                    );
                  }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Revenue Mix by Hotel ───────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Mix by Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Service vs product vs wholesale share per location · % of gross
          </p>
          <div className="h-[240px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mixData} margin={{ top: 12, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip formatter={(v: unknown, name: unknown) => [`${v}%`, String(name)]} />
                <Legend />
                <Bar dataKey="Services %"  stackId="a" fill="#1B3A4B" barSize={40} />
                <Bar dataKey="Products %"  stackId="a" fill="#4A90D9" barSize={40} />
                <Bar dataKey="Wholesale %" stackId="a" fill="#B79E61" barSize={40} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Guest Revenue Mix — Hotel vs Non-Hotel ─────────────────── */}
      {(analytics.isFetching || guestChartData.length > 0) && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Guest Revenue Mix — Hotel vs Non-Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Revenue by guest origin per venue · ex-VAT · EUR
          </p>
          {analytics.isFetching ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              Loading analytics…
            </div>
          ) : guestChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guest group data for this period.</p>
          ) : (
            <div style={{ height: guestChartData.length * 52 + 60 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={guestChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 60, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [fmtShort(Number(v)), String(name)]}
                  />
                  <Legend />
                  <Bar dataKey="Hotel Guests" stackId="a" fill="#1B3A4B">
                    <LabelList
                      dataKey="hotelPct"
                      position="insideLeft"
                      formatter={(v: unknown) => Number(v) > 15 ? `${v}%` : ""}
                      style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}
                    />
                  </Bar>
                  <Bar dataKey="Non-Hotel" stackId="a" fill="#96B2B2" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="Non-Hotel"
                      position="right"
                      formatter={(v: unknown) => fmtShort(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}

      {/* ── Payment Type Split ─────────────────────────────────────── */}
      {(analytics.isFetching || paymentData.length > 0) && (
        analytics.isFetching ? (
          <Card className="p-4 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Payment Type Split</h2>
            <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
              Loading analytics…
            </div>
          </Card>
        ) : (
          <ServiceBreakdownChart
            title="Payment Type Split"
            data={paymentData}
            color={chartColors.spa}
          />
        )
      )}

      {/* ── Discount by Location ───────────────────────────────────── */}
      {(analytics.isFetching || discountChartData.length > 0) && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Discount by Location</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Average discount applied vs list price per venue · inc-VAT
          </p>
          {analytics.isFetching ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              Loading analytics…
            </div>
          ) : discountChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discount data for this period.</p>
          ) : (
            <div style={{ height: discountChartData.length * 48 + 60 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={discountChartData}
                  layout="vertical"
                  margin={{ top: 8, right: 60, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 30]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip
                    formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "Discount %"]}
                  />
                  <Bar dataKey="Discount %" radius={[0, 4, 4, 0]}>
                    {discountChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                    <LabelList
                      dataKey="Discount %"
                      position="right"
                      formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}

      {/* ── Staff Performance ──────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Staff Performance</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Service + retail revenue per therapist · EUR inc-VAT
        </p>
        {analytics.isFetching ? (
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            Loading staff data…
          </div>
        ) : staffChartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff data for this period.</p>
        ) : (
          <StaffPerformanceChart
            title=""
            data={staffChartData}
            serviceColor={chartColors.spa}
            retailColor="#B79E61"
          />
        )}
      </Card>

      {/* ── Full Revenue Breakdown (inc-VAT) ───────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Full Revenue Breakdown
            <span className="text-sm font-normal text-muted-foreground ml-2">(inc-VAT 18%)</span>
          </h2>
          <p className="text-xs text-muted-foreground mb-5">
            All revenue lines per location · deductions shown in (parentheses)
          </p>
          <RevenueTable locations={incVatLocations} />
          {(totals.sales_discount > 0 || totals.sales_refund > 0) && (
            <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5 mt-0.5 text-red-400 flex-shrink-0" />
              <span>Discount and Refund from Zoho Books distributed proportionally to each location&apos;s revenue.</span>
            </div>
          )}
        </Card>
      )}

      {!isLoading && locations.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">No revenue data for the selected period.</p>
          <button onClick={() => triggerSync(true)} className="mt-3 text-xs underline">Sync now</button>
        </Card>
      )}

      <CIChat />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

export default function SpaDeepaPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <SpaDeepaContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
