"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { StaffPerformanceChart } from "@/components/sales/StaffPerformanceChart";
import { Card } from "@/components/ui/card";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import { useSalaryRoster } from "@/lib/hooks/useSalaryRoster";
import { BRAND } from "@/lib/constants/design-tokens";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend, Cell,
} from "recharts";
import { AlertCircle, FileSpreadsheet } from "lucide-react";
import { SyncButton } from "@/components/dashboard/SyncButton";

const VAT_RATE = 0.18;

const PAYMENT_COLORS: Record<string, string> = {
  "Credit Card":        BRAND.spa.soft,  // spa-soft (primary fill)
  "Cash":               "#E5C088",  // soft amber
  "Hotel Room Account": "#B8C9E0",  // soft Meta blue (hotel-channel)
  "Payment Center":     "#A8D4A8",  // soft green (settled)
  "Open Account":       "#E5B8B0",  // soft coral (outstanding)
  "Unknown":            "#C7C4BD",  // neutral
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
      gross:   calc(totals.gross_revenue, priorTotals.gross_revenue),
      service: calc(totals.services,      priorTotals.services),
      retail:  calc(totals.product_total, priorTotals.product_total),
    };
  }, [totals, priorTotals]);

  const isLoading = isFetching || isSyncing;

  const subtitle = useMemo(() => {
    const range = formatDateRangeLabel(dateFrom, dateTo);
    return `${range} · Source: Cockpit Datasheet (gross sales)`;
  }, [dateFrom, dateTo]);

  /* ── totals comes from useSpaRevenue → spa_revenue_monthly/daily.
       After migration 073 those columns hold inc-VAT (gross). Use directly. */

  /* ── Revenue mix per hotel (absolute €, services + products stacked) ─ */
  const hotelChartData = useMemo(() => {
    const priorLocMap = new Map(priorLocations.map(l => [l.location_id, l]));
    return [...locations]
      .sort((a, b) => b.gross_revenue - a.gross_revenue)
      .map((loc) => {
        const gross    = loc.services + loc.product_total;
        const prodPct  = gross > 0 ? Math.round((loc.product_total / gross) * 100) : 0;
        const currNet  = loc.gross_revenue;
        const prior    = priorLocMap.get(loc.location_id);
        const priorNet = prior ? prior.gross_revenue : 0;
        const yoyPct   = priorNet > 0 ? Math.round(((currNet - priorNet) / priorNet) * 100) : null;
        return {
          name:       loc.name,
          color:      loc.color,
          Services:   loc.services,
          Products:   loc.product_total,
          prodPct,
          currNet,
          priorNet,
          yoyPct,
        };
      });
  }, [locations, priorLocations]);

  const { getSpaSalary } = useSalaryRoster(dateFrom, dateTo);

  /* ── Staff chart data (real data from analytics hook, inc-VAT) ── */
  const staffChartData = useMemo(() =>
    analytics.staff.map((s) => ({
      name: s.name,
      serviceRevenue: Math.round(s.service_revenue * 1.18),
      retailRevenue:  Math.round(s.retail_revenue  * 1.18),
    })),
    [analytics.staff]
  );

  /* ── Therapist K% data (salary cost vs revenue) ─────────────── */
  const therapistKData = useMemo(() => {
    return analytics.staff
      .map((s) => {
        const revenue_ex = s.service_revenue + s.retail_revenue;
        const revenue_inc = Math.round(revenue_ex * (1 + VAT_RATE));
        const salary = getSpaSalary(s.name) ?? 0;
        const salary_cost = salary > 0 ? Math.min(salary, revenue_inc) : 0;
        const k_pct = salary > 0 && revenue_ex > 0 ? +(salary / revenue_ex * 100).toFixed(0) : null;
        const revStr = revenue_inc >= 1000 ? `€${(revenue_inc / 1000).toFixed(1)}K` : `€${revenue_inc}`;
        return {
          name:           s.name,
          revenue_net:    Math.max(0, revenue_inc - salary_cost),
          salary_cost,
          k_label:        k_pct != null ? `${k_pct}%` : null as string | null,
          bar_label:      revStr,
        };
      })
      .filter(d => d.revenue_net + d.salary_cost > 0)
      .sort((a, b) => (b.revenue_net + b.salary_cost) - (a.revenue_net + a.salary_cost));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.staff, getSpaSalary]);

  /* ── Guest group chart data (% of bookings by count) ───────── */
  const guestChartData = useMemo(() =>
    analytics.guestGroups
      .filter(g => (g.hotel_count + g.non_hotel_count) > 0)
      .map((g) => {
        const total    = g.hotel_count + g.non_hotel_count;
        const hotelPct = Math.round((g.hotel_count / total) * 100);
        return {
          name:           g.name,
          "Hotel Guests": hotelPct,
          "Non-Hotel":    100 - hotelPct,
          hotelCount:     g.hotel_count,
          nonHotelCount:  g.non_hotel_count,
          total,
        };
      })
      .sort((a, b) => b.total - a.total),
    [analytics.guestGroups]
  );

  const overallGuestMix = useMemo(() => {
    const hotelCount    = analytics.guestGroups.reduce((s, g) => s + g.hotel_count, 0);
    const nonHotelCount = analytics.guestGroups.reduce((s, g) => s + g.non_hotel_count, 0);
    const total         = hotelCount + nonHotelCount;
    return {
      hotelPct:    total > 0 ? Math.round((hotelCount / total) * 100) : 0,
      hotelCount,
      total,
    };
  }, [analytics.guestGroups]);

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
        <SyncButton
          onSync={async () => { await triggerSync(true); }}
          isExternalBusy={isLoading}
        />
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
      <SalesKPIGrid columns={4}>
        <SalesKPICard
          label="Gross Revenue"
          value={fmtShort(totals.gross_revenue)}
          subtitle={`${fmtShort(Math.round(totals.gross_revenue / (1 + VAT_RATE)))} ex-VAT · ${locations.length} locations`}
          yoyChange={yoy.gross}
        />
        <SalesKPICard
          label="Service Revenue"
          value={fmtShort(totals.services)}
          subtitle={`${pct(totals.services, totals.gross_revenue)} of gross`}
          yoyChange={yoy.service}
        />
        <SalesKPICard
          label="Retail Revenue"
          value={fmtShort(totals.product_total)}
          subtitle={`${pct(totals.product_total, totals.gross_revenue)} of gross`}
          yoyChange={yoy.retail}
        />
        <SalesKPICard
          label="Hotel Guests"
          value={analytics.isFetching ? "…" : `${overallGuestMix.hotelPct}%`}
          subtitle={`of bookings · ${overallGuestMix.total.toLocaleString()} total visits`}
        />
      </SalesKPIGrid>

      {/* ── Revenue Mix by Hotel ──────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Mix by Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Gross revenue per location · inc-VAT · retail share colored
          </p>
          <div className="h-[280px] md:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hotelChartData} margin={{ top: 20, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown, name: unknown) => [fmtShort(Number(v)), String(name)]} />
                <Legend />
                <Bar dataKey="Services" stackId="a" fill={BRAND.spa.soft} barSize={40} />
                <Bar dataKey="Products" stackId="a" fill={BRAND.spa.soft} barSize={40} radius={[4, 4, 0, 0]}>
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
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${row.yoyPct >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"}`}>
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
                    <td className="py-2 text-right tabular-nums">{fmtShort(totals.gross_revenue)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {priorTotals.gross_revenue > 0 ? fmtShort(priorTotals.gross_revenue) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {yoy.gross !== undefined ? (
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ${yoy.gross >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"}`}>
                          {yoy.gross >= 0 ? "+" : ""}{Math.round(yoy.gross)}%
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
          {/* Guest Mix by Venue */}
          <Card className="p-4 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Guest Mix by Venue</h2>
            <p className="text-xs text-muted-foreground mb-5">
              Hotel vs non-hotel guest share · % of bookings per venue
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
                    margin={{ top: 8, right: 12, left: 8, bottom: 32 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      formatter={(v: unknown, name: unknown, props: { payload?: { hotelCount?: number; nonHotelCount?: number; total?: number } }) => {
                        const d = props.payload;
                        const count = name === "Hotel Guests" ? d?.hotelCount : d?.nonHotelCount;
                        return [`${v}% (${count ?? 0} visits)`, String(name)];
                      }}
                    />
                    <Legend />
                    <Bar dataKey="Hotel Guests" stackId="a" fill={BRAND.spa.dark}>
                      <LabelList
                        dataKey="Hotel Guests"
                        position="inside"
                        formatter={(v: unknown) => Number(v) >= 12 ? `${v}%` : ""}
                        style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}
                      />
                    </Bar>
                    <Bar dataKey="Non-Hotel" stackId="a" fill={BRAND.spa.soft} radius={[4, 4, 0, 0]}>
                      <LabelList
                        dataKey="Non-Hotel"
                        position="inside"
                        formatter={(v: unknown) => Number(v) >= 12 ? `${v}%` : ""}
                        style={{ fontSize: 10, fontWeight: 700, fill: "#6B5E4E" }}
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
            serviceColor={BRAND.spa.soft}
            retailColor="#E5C088"
            mode="service"
          />
          <StaffPerformanceChart
            title="Retail Revenue by Therapist"
            subtitle="EUR inc-VAT · sorted by retail"
            data={staffChartData}
            serviceColor={BRAND.spa.soft}
            retailColor="#E5C088"
            mode="retail"
          />
        </div>
      )}

      {/* ── Therapist Revenue + Salary Cost (K%) ─────────────────── */}
      {therapistKData.length > 0 && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold text-foreground">Revenue &amp; Salary Cost by Therapist</h2>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BRAND.spa.soft }} />
                Net revenue
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#4a7fa5]" />
                Salary cost (K%)
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(180, therapistKData.length * 44)}>
            <BarChart
              layout="vertical"
              data={therapistKData}
              margin={{ top: 20, right: 100, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => `€${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) => {
                  const n = Number(value ?? 0);
                  return [
                    `€${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                    name === "salary_cost" ? "Salary cost" : "Net revenue",
                  ];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="revenue_net" stackId="rev" fill={BRAND.spa.soft} radius={[0, 0, 0, 0]} />
              <Bar dataKey="salary_cost" stackId="rev" fill="#4a7fa5" radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="k_label"
                  position="insideRight"
                  formatter={(v: unknown) => v ? String(v) : ""}
                  style={{ fontSize: 10, fill: "#fff", fontWeight: 700 }}
                />
                <LabelList
                  dataKey="bar_label"
                  position="right"
                  formatter={(v: unknown) => String(v ?? "")}
                  style={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {!isLoading && locations.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">No revenue data for the selected period.</p>
          <button onClick={() => triggerSync(true)} className="mt-3 text-xs underline">Sync now</button>
        </Card>
      )}

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
