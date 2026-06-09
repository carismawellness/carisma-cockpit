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
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend,
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
   MOCK DATA (staff & service breakdown — pending Lapis category pipeline)
   ═══════════════════════════════════════════════════════════════════════ */

const MOCK_STAFF = [
  { name: "Maria Grech",     serviceRevenue: 38200, retailRevenue: 2800 },
  { name: "Anna Camilleri",  serviceRevenue: 35600, retailRevenue: 2400 },
  { name: "Sarah Farrugia",  serviceRevenue: 32100, retailRevenue: 3200 },
  { name: "Leanne Attard",   serviceRevenue: 29400, retailRevenue: 2900 },
  { name: "Claire Vella",    serviceRevenue: 27200, retailRevenue: 2200 },
  { name: "Jessica Borg",    serviceRevenue: 24800, retailRevenue: 3600 },
  { name: "Michelle Zammit", serviceRevenue: 22600, retailRevenue: 2600 },
  { name: "Rachel Gauci",    serviceRevenue: 20300, retailRevenue: 1900 },
];

const MOCK_SERVICES = [
  { service: "Massage Therapy",  revenue: 58200, pct: 38.2 },
  { service: "Facials",          revenue: 29400, pct: 19.3 },
  { service: "Body Treatments",  revenue: 21600, pct: 14.2 },
  { service: "Hydrotherapy",     revenue: 15400, pct: 10.1 },
  { service: "Couples Packages", revenue: 12200, pct: 8.0  },
  { service: "Nail Services",    revenue: 9600,  pct: 6.3  },
  { service: "Other",            revenue: 6400,  pct: 4.2  },
];

/* ═══════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════ */

function DemoTag() {
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 ml-2">
      Demo data
    </span>
  );
}

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

      {/* ── KPI Row ─────────────────────────────────────────────────── */}
      <SalesKPIGrid columns={4}>
        <SalesKPICard
          label="Net Revenue"
          value={fmtShort(incVat.net_revenue)}
          subtitle={`${fmtShort(totals.net_revenue)} ex-VAT · ${locations.length} locations`}
        />
        <SalesKPICard
          label="Services"
          value={fmtShort(incVat.services)}
          subtitle={`${pct(totals.services, totals.net_revenue)} of net`}
        />
        <SalesKPICard
          label="Products"
          value={fmtShort(incVat.product_total)}
          subtitle={`${pct(totals.product_total, totals.net_revenue)} of net`}
        />
        <SalesKPICard
          label="Wholesale"
          value={fmtShort(incVat.wholesale)}
          subtitle={`${pct(totals.wholesale, totals.net_revenue)} of net`}
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

      {/* ── Staff Performance ──────────────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-foreground">Staff Performance</h2>
          <DemoTag />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Service + retail revenue per therapist · EUR inc-VAT
        </p>
        <StaffPerformanceChart
          title=""
          data={MOCK_STAFF}
          serviceColor={chartColors.spa}
          retailColor="#B79E61"
        />
      </Card>

      {/* ── Service Revenue Breakdown ──────────────────────────────── */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-foreground">Service Revenue Breakdown</h2>
          <DemoTag />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Revenue by treatment category · EUR inc-VAT
        </p>
        <ServiceBreakdownChart
          title=""
          data={MOCK_SERVICES}
          color={chartColors.spa}
        />
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
