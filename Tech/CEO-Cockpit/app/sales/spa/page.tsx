"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { StaffPerformanceChart } from "@/components/sales/StaffPerformanceChart";
import { CIChat } from "@/components/ci/CIChat";
import { Card } from "@/components/ui/card";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend, Cell,
} from "recharts";
import { RefreshCw, AlertCircle, FileSpreadsheet } from "lucide-react";

const VAT_RATE = 0.18;

const PAYMENT_COLORS: Record<string, string> = {
  "Credit Card":        "#1B3A4B",
  "Cash":               "#B79E61",
  "Hotel Room Account": "#4A90D9",
  "Payment Center":     "#8EB093",
  "Open Account":       "#E07A5F",
  "Unknown":            "#96B2B2",
};

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
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function SpaDeepaContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { locations, totals, isFetching, isSyncing, syncError, missingMonths, triggerSync } =
    useSpaRevenue(dateFrom, dateTo);

  const analytics = useSpaDeepaAnalytics(dateFrom, dateTo);

  // Prior-year window for YoY badges
  const priorDateFrom = useMemo(
    () => new Date(dateFrom.getFullYear() - 1, dateFrom.getMonth(), dateFrom.getDate()),
    [dateFrom]
  );
  const priorDateTo = useMemo(
    () => new Date(dateTo.getFullYear() - 1, dateTo.getMonth(), dateTo.getDate()),
    [dateTo]
  );
  const { totals: priorTotals, locations: priorLocations } = useSpaRevenue(priorDateFrom, priorDateTo);

  const yoy = useMemo(() => {
    const calc = (curr: number, prior: number) =>
      prior > 0 ? ((curr - prior) / prior) * 100 : undefined;
    return {
      net:     calc(totals.net_revenue,   priorTotals.net_revenue),
      service: calc(totals.services,      priorTotals.services),
      retail:  calc(totals.product_total, priorTotals.product_total),
    };
  }, [totals, priorTotals]);

  const isLoading = isFetching || isSyncing;

  const subtitle = useMemo(() => {
    const range = formatDateRangeLabel(dateFrom, dateTo);
    return `${range} · Source: Cockpit Datasheet + Zoho Books`;
  }, [dateFrom, dateTo]);

  /* ── Inc-VAT totals ──────────────────────────────────────────── */
  const incVat = useMemo(() => ({
    net_revenue:   Math.round(totals.net_revenue   * (1 + VAT_RATE)),
    services:      Math.round(totals.services      * (1 + VAT_RATE)),
    product_total: Math.round(totals.product_total * (1 + VAT_RATE)),
  }), [totals]);

  /* ── Revenue mix per hotel (absolute €, services + products stacked) ─ */
  const hotelChartData = useMemo(() => {
    const priorLocMap = new Map(priorLocations.map(l => [l.location_id, l]));
    return [...locations]
      .sort((a, b) => b.net_revenue - a.net_revenue)
      .map((loc) => {
        const gross    = loc.services + loc.product_total;
        const prodPct  = gross > 0 ? Math.round((loc.product_total / gross) * 100) : 0;
        const currNet  = Math.round(loc.net_revenue * (1 + VAT_RATE));
        const prior    = priorLocMap.get(loc.location_id);
        const priorNet = prior ? Math.round(prior.net_revenue * (1 + VAT_RATE)) : 0;
        const yoyPct   = priorNet > 0 ? Math.round(((currNet - priorNet) / priorNet) * 100) : null;
        return {
          name:       loc.name,
          color:      loc.color,
          Services:   Math.round(loc.services     * (1 + VAT_RATE)),
          Products:   Math.round(loc.product_total * (1 + VAT_RATE)),
          prodPct,
          currNet,
          priorNet,
          yoyPct,
        };
      });
  }, [locations, priorLocations]);

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
      name: g.name,
      "Hotel Guests": g.hotel_revenue,
      "Non-Hotel":    g.non_hotel_revenue,
      hotelPct: (g.hotel_revenue + g.non_hotel_revenue) > 0
        ? Math.round(g.hotel_revenue / (g.hotel_revenue + g.non_hotel_revenue) * 100)
        : 0,
    })),
    [analytics.guestGroups]
  );

  /* ── Payment type by location (100% stacked) ────────────────── */
  const paymentByLocationData = useMemo(() =>
    analytics.paymentByLocation.map((loc) => {
      const total = Object.values(loc.payment_types).reduce((s, v) => s + v, 0);
      const result: Record<string, unknown> = {
        name: loc.name,
      };
      for (const [type, rev] of Object.entries(loc.payment_types)) {
        result[type] = total > 0 ? Math.round((rev / total) * 100) : 0;
      }
      return result;
    }),
    [analytics.paymentByLocation]
  );

  /* ── AOV chart data ─────────────────────────────────────────── */
  const aovChartData = useMemo(() =>
    analytics.discounts
      .filter(d => d.total_txn_count > 0)
      .map(d => ({
        name:  d.name,
        color: d.color,
        AOV:   Math.round(d.avg_order_value * (1 + VAT_RATE)),
        txns:  d.total_txn_count,
      }))
      .sort((a, b) => b.AOV - a.AOV),
    [analytics.discounts]
  );

  const allPaymentTypes = useMemo(() => {
    const totals: Record<string, number> = {};
    analytics.paymentByLocation.forEach((loc) => {
      Object.entries(loc.payment_types).forEach(([type, rev]) => {
        totals[type] = (totals[type] ?? 0) + rev;
      });
    });
    return Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .map(([type]) => type);
  }, [analytics.paymentByLocation]);

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Spa</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <a
              href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=1979027354"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FileSpreadsheet className="h-3 w-3" />
              Cockpit Datasheet — Spa Services ↗
            </a>
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
          yoyChange={yoy.net}
        />
        <SalesKPICard
          label="Service Revenue"
          value={fmtShort(incVat.services)}
          subtitle={`${pct(totals.services, totals.net_revenue)} of net`}
          yoyChange={yoy.service}
        />
        <SalesKPICard
          label="Retail Revenue"
          value={fmtShort(incVat.product_total)}
          subtitle={`${pct(totals.product_total, totals.net_revenue)} of net`}
          yoyChange={yoy.retail}
        />
      </SalesKPIGrid>

      {/* ── Revenue Mix by Hotel ──────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Mix by Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Net revenue per location · inc-VAT · retail share colored
          </p>
          <div className="h-[280px] md:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hotelChartData} margin={{ top: 20, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown, name: unknown) => [fmtShort(Number(v)), String(name)]} />
                <Legend />
                <Bar dataKey="Services" stackId="a" fill="#1B3A4B" barSize={40} />
                <Bar dataKey="Products" stackId="a" fill="#4A90D9" barSize={40} radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="prodPct"
                    position="inside"
                    formatter={(v: unknown) => Number(v) > 0 ? `${v}%` : ""}
                    style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}
                  />
                  <LabelList
                    dataKey="currNet"
                    position="top"
                    formatter={(v: unknown) => fmtShort(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* YoY comparison table */}
          {hotelChartData.some(d => d.priorNet > 0) && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 font-medium">Location</th>
                    <th className="text-right py-2 font-medium">This period</th>
                    <th className="text-right py-2 font-medium">LY same period</th>
                    <th className="text-right py-2 font-medium">vs LY</th>
                  </tr>
                </thead>
                <tbody>
                  {hotelChartData.map((row) => (
                    <tr key={row.name} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: row.color }} />
                          {row.name}
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">{fmtShort(row.currNet)}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {row.priorNet > 0 ? fmtShort(row.priorNet) : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {row.yoyPct !== null ? (
                          <span className={`font-semibold ${row.yoyPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {row.yoyPct >= 0 ? "+" : ""}{row.yoyPct}%
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold text-sm">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right tabular-nums">{fmtShort(Math.round(totals.net_revenue * (1 + VAT_RATE)))}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {priorTotals.net_revenue > 0 ? fmtShort(Math.round(priorTotals.net_revenue * (1 + VAT_RATE))) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {yoy.net !== undefined ? (
                        <span className={`font-bold ${yoy.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {yoy.net >= 0 ? "+" : ""}{Math.round(yoy.net)}%
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Guest Revenue Mix + Payment Type (side by side) ──────────── */}
      {(analytics.isFetching || guestChartData.length > 0 || paymentByLocationData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Guest Revenue Mix */}
          <Card className="p-4 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Guest Revenue Mix</h2>
            <p className="text-xs text-muted-foreground mb-5">
              Hotel vs non-hotel by venue · ex-VAT
            </p>
            {analytics.isFetching ? (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                Loading analytics…
              </div>
            ) : guestChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guest group data for this period.</p>
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={guestChartData}
                    margin={{ top: 20, right: 12, left: 8, bottom: 32 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown, name: unknown) => [fmtShort(Number(v)), String(name)]} />
                    <Legend />
                    <Bar dataKey="Hotel Guests" stackId="a" fill="#1B3A4B">
                      <LabelList
                        dataKey="hotelPct"
                        position="inside"
                        formatter={(v: unknown) => Number(v) > 15 ? `${v}%` : ""}
                        style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}
                      />
                    </Bar>
                    <Bar dataKey="Non-Hotel" stackId="a" fill="#96B2B2" radius={[4, 4, 0, 0]}>
                      <LabelList
                        dataKey="Non-Hotel"
                        position="top"
                        formatter={(v: unknown) => fmtShort(Number(v))}
                        style={{ fontSize: 9, fontWeight: 600, fill: "#374151" }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Payment Type by Location */}
          <Card className="p-4 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Payment Type by Location</h2>
            <p className="text-xs text-muted-foreground mb-5">
              Payment method breakdown per venue · % of revenue
            </p>
            {analytics.isFetching ? (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                Loading analytics…
              </div>
            ) : paymentByLocationData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment type data for this period.</p>
            ) : (
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={paymentByLocationData}
                    margin={{ top: 8, right: 12, left: 8, bottom: 32 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip formatter={(v: unknown, name: unknown) => [`${v}%`, String(name)]} />
                    <Legend />
                    {allPaymentTypes.map((type, idx) => (
                      <Bar
                        key={type}
                        dataKey={type}
                        stackId="a"
                        fill={PAYMENT_COLORS[type] ?? "#aaa"}
                        radius={idx === allPaymentTypes.length - 1 ? [4, 4, 0, 0] : undefined}
                      >
                        <LabelList
                          dataKey={type}
                          position="inside"
                          formatter={(v: unknown) => Number(v) >= 10 ? `${v}%` : ""}
                          style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}
                        />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Average Order Value by Location ──────────────────────── */}
      {(analytics.isFetching || aovChartData.length > 0) && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Average Order Value by Location</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Average service transaction value per venue · inc-VAT
          </p>
          {analytics.isFetching ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              Loading analytics…
            </div>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={aovChartData} margin={{ top: 20, right: 12, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: unknown, _name: unknown, props: { payload?: { txns?: number } }) =>
                      [fmtShort(Number(v)), `Avg Order Value · ${props.payload?.txns ?? 0} txns`]
                    }
                  />
                  <Bar dataKey="AOV" radius={[4, 4, 0, 0]}>
                    {aovChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                    <LabelList
                      dataKey="AOV"
                      position="top"
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

      {/* ── Staff Performance ──────────────────────────────────────── */}
      {analytics.isFetching ? (
        <Card className="p-4 md:p-6">
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            Loading staff data…
          </div>
        </Card>
      ) : staffChartData.length === 0 ? (
        <Card className="p-4 md:p-6">
          <p className="text-sm text-muted-foreground">No staff data for this period.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <StaffPerformanceChart
            title="Service Revenue by Therapist"
            subtitle="EUR inc-VAT · sorted by service"
            data={staffChartData}
            serviceColor="#1B3A4B"
            retailColor="#B79E61"
            mode="service"
          />
          <StaffPerformanceChart
            title="Retail Revenue by Therapist"
            subtitle="EUR inc-VAT · sorted by retail"
            data={staffChartData}
            serviceColor="#1B3A4B"
            retailColor="#B79E61"
            mode="retail"
          />
        </div>
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
