"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import {
  SpaDayOfWeekChart,
  SpaHourOfDayChart,
  SpaTherapistChart,
  SpaDiscountByClubSection,
  SpaComplimentaryByClubSection,
} from "@/components/sales/SpaDeepaInsights";
import { Card } from "@/components/ui/card";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import { useSalaryRoster } from "@/lib/hooks/useSalaryRoster";
import { BRAND, YOY_BADGE } from "@/lib/constants/design-tokens";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend, Cell,
} from "recharts";
import { AlertCircle, FileSpreadsheet } from "lucide-react";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { SpaIntegrityBadge } from "@/components/sales/SpaIntegrityBadge";

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

  /* ── Therapist chart data (service + retail split, salary K%) ── */
  const therapistKData = useMemo(() => {
    return analytics.staff
      .map((s) => {
        const service_inc = Math.round(s.service_revenue * (1 + VAT_RATE));
        const retail_inc  = Math.round(s.retail_revenue  * (1 + VAT_RATE));
        const total_inc   = service_inc + retail_inc;
        const salary      = getSpaSalary(s.name) ?? 0;
        const k_pct       = salary > 0 && total_inc > 0 ? Math.round(salary / total_inc * 100) : null;
        const retail_pct  = total_inc > 0 ? Math.round(retail_inc / total_inc * 100) : 0;
        const revStr      = total_inc >= 1000 ? `€${(total_inc / 1000).toFixed(1)}K` : `€${total_inc}`;
        return {
          name:        s.name,
          service_inc,
          retail_inc,
          retail_pct,
          k_label:     k_pct != null ? `${k_pct}%K` : null as string | null,
          bar_label:   revStr,
          total_inc,
        };
      })
      .filter(d => d.total_inc > 0)
      .sort((a, b) => b.total_inc - a.total_inc);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics.staff, getSpaSalary]);

  /* ── Guest group chart data (% of bookings by count, no closed) */
  const guestChartData = useMemo(() =>
    analytics.guestGroups
      .filter(g => (g.hotel_count + g.non_hotel_count) > 0 && !g.name.toLowerCase().includes("(closed)"))
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
        <div className="flex flex-col items-end gap-2">
          <SyncButton
            onSync={async () => { await triggerSync(true); }}
            isExternalBusy={isLoading}
          />
          <SpaIntegrityBadge dateFrom={dateFrom} dateTo={dateTo} />
        </div>
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
          label="Non-Hotel Guests"
          value={analytics.isFetching ? "…" : `${100 - overallGuestMix.hotelPct}%`}
          subtitle={`of bookings · ${overallGuestMix.total.toLocaleString()} total visits`}
        />
      </SalesKPIGrid>

      {/* ── Revenue Mix by Hotel ──────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Mix by Hotel</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Gross revenue per location · inc-VAT · retail share in amber · vs LY badge
          </p>
          <div className="h-[300px] md:h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hotelChartData} margin={{ top: 52, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: unknown, name: unknown) => [fmtShort(Number(v)), String(name)]} />
                <Legend />
                <Bar dataKey="Services" stackId="a" fill={BRAND.spa.dark} barSize={40} />
                <Bar dataKey="Products" stackId="a" fill="#E5C088" barSize={40} radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="prodPct"
                    position="inside"
                    formatter={(v: unknown) => Number(v) > 4 ? `${v}%` : ""}
                    style={{ fontSize: 9, fontWeight: 700, fill: "#7A5C2E" }}
                  />
                  <LabelList
                    dataKey="currNet"
                    content={(lp: unknown) => {
                      const p = lp as { x?: number; y?: number; width?: number; height?: number; value?: number; index?: number };
                      const entry = hotelChartData[p.index ?? 0];
                      if (!entry) return null;
                      const cx = (p.x ?? 0) + (p.width ?? 0) / 2;
                      const top = (p.y ?? 0) - 6;
                      const yp = entry.yoyPct;
                      const badge = yp != null ? (yp >= 0 ? YOY_BADGE.positive : YOY_BADGE.negative) : null;
                      return (
                        <g key={`hotel-top-${p.index}`}>
                          <text x={cx} y={top - 18} textAnchor="middle" fontSize={10} fontWeight={600} fill="#374151">
                            {fmtShort(entry.currNet)}
                          </text>
                          {badge && (
                            <>
                              <rect x={cx - 17} y={top - 14} width={34} height={13} rx={3} fill={badge.bg} />
                              <text x={cx} y={top - 4} textAnchor="middle" fontSize={9} fontWeight={700} fill={badge.fg}>
                                {yp! >= 0 ? "+" : ""}{yp}%
                              </text>
                            </>
                          )}
                        </g>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
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
                    <Bar dataKey="Non-Hotel" stackId="a" fill={BRAND.spa.soft}>
                      <LabelList
                        dataKey="Non-Hotel"
                        position="inside"
                        formatter={(v: unknown) => Number(v) >= 10 ? `${v}%` : ""}
                        style={{ fontSize: 11, fontWeight: 700, fill: "#6B5E4E" }}
                      />
                    </Bar>
                    <Bar dataKey="Hotel Guests" stackId="a" fill={BRAND.spa.dark} radius={[4, 4, 0, 0]} />
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

      {/* ── New Deepa insights, rearranged: paired side-by-side, with the
              older Revenue-by-Therapist block parked at the very bottom. ── */}

      {/* Sales by day of week + Sales by time of day — side by side */}
      {!analytics.isFetching && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <SpaDayOfWeekChart data={analytics.byDayOfWeek} />
          <SpaHourOfDayChart data={analytics.byHourOfDay} />
        </div>
      )}

      {/* Therapist utilization — full width so the full Column-G employee list
          fits without truncation. (Was previously paired with AOV; AOV now
          owns its own row above.) */}
      {!analytics.isFetching && aovChartData.length > 0 && (
        <Card className="p-4 md:p-6 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Average Order Value by Location</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Average service transaction value per venue · inc-VAT
            </p>
          </div>
          <div className="h-[300px] md:h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={aovChartData} margin={{ top: 24, right: 12, left: 8, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} angle={-25} textAnchor="end" interval={0} height={48} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
                <Tooltip
                  formatter={(v: unknown, _name: unknown, props: { payload?: { txns?: number } }) =>
                    [fmtShort(Number(v)), `Avg Order Value · ${props.payload?.txns ?? 0} txns`]
                  }
                />
                <Bar dataKey="AOV" radius={[4, 4, 0, 0]} maxBarSize={64}>
                  {aovChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="AOV"
                    position="top"
                    formatter={(v: unknown) => fmtShort(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      {!analytics.isFetching && (
        <SpaTherapistChart data={analytics.byTherapist} />
      )}

      {/* Discount + Complimentary by club — full width each */}
      {!analytics.isFetching && (
        <>
          <SpaDiscountByClubSection data={analytics.discounts} />
          <SpaComplimentaryByClubSection data={analytics.complimentary} />
        </>
      )}

      {!isLoading && locations.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground">
          <p className="text-sm">No revenue data for the selected period.</p>
          <button onClick={() => triggerSync(true)} className="mt-3 text-xs underline">Sync now</button>
        </Card>
      )}

      {/* ── Revenue by Therapist (parked at the bottom of the page) ───── */}
      {(analytics.isFetching || therapistKData.length > 0) && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold text-foreground">Revenue by Therapist</h2>
            <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BRAND.spa.dark }} />
                Service revenue
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#E5C088]" />
                Retail revenue
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#DBEAFE]" />
                Salary K%
              </span>
            </div>
          </div>
          {analytics.isFetching ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              Loading staff data…
            </div>
          ) : therapistKData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff data for this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, therapistKData.length * 44)}>
              <BarChart
                layout="vertical"
                data={therapistKData}
                margin={{ top: 4, right: 120, left: 10, bottom: 0 }}
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
                    const label = name === "retail_inc" ? "Retail" : "Service";
                    return [
                      `€${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                      label,
                    ];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="service_inc" stackId="rev" fill={BRAND.spa.dark} radius={[0, 0, 0, 0]} />
                <Bar dataKey="retail_inc" stackId="rev" fill="#E5C088" radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="retail_pct"
                    position="insideRight"
                    formatter={(v: unknown) => Number(v) >= 6 ? `${v}%` : ""}
                    style={{ fontSize: 9, fill: "#7A5C2E", fontWeight: 700 }}
                  />
                  <LabelList
                    dataKey="bar_label"
                    content={(lp: unknown) => {
                      const p = lp as { x?: number; y?: number; width?: number; height?: number; index?: number };
                      const entry = therapistKData[p.index ?? 0];
                      if (!entry) return null;
                      const rx = (p.x ?? 0) + (p.width ?? 0) + 8;
                      const cy = (p.y ?? 0) + (p.height ?? 0) / 2;
                      const hasK = !!entry.k_label;
                      return (
                        <g key={`therapist-label-${p.index}`}>
                          <text x={rx} y={hasK ? cy - 2 : cy + 4} fontSize={11} fill="#64748b" fontWeight={600}>
                            {entry.bar_label}
                          </text>
                          {hasK && (
                            <>
                              <rect x={rx} y={cy + 6} width={30} height={13} rx={3} fill="#DBEAFE" />
                              <text x={rx + 15} y={cy + 15} fontSize={9} fill="#1D4ED8" fontWeight={700} textAnchor="middle">
                                {entry.k_label}
                              </text>
                            </>
                          )}
                        </g>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
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
