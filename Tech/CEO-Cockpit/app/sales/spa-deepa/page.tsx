"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CIChat } from "@/components/ci/CIChat";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue, SpaRevenueLocation } from "@/lib/hooks/useSpaRevenue";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  LabelList,
  Cell,
} from "recharts";
import { RefreshCw, AlertCircle, TrendingDown, Database, FileSpreadsheet } from "lucide-react";

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${Math.round(v / 1_000)}K`;
  return `€${v}`;
}

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function KPICard({
  label, value, sub, accent, negative,
}: {
  label: string; value: number; sub?: string; accent?: string; negative?: boolean;
}) {
  const color = negative ? "#dc2626" : (accent ?? "#1B3A4B");
  return (
    <div className="rounded-xl border bg-card p-4 md:p-5 border-l-4" style={{ borderLeftColor: color }}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{fmtShort(value)}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

const COL_HEADERS = [
  { key: "services",         label: "Services",         color: "#1B3A4B" },
  { key: "product_phytomer", label: "Phytomer",         color: "#4A90D9" },
  { key: "product_purest",   label: "Purest",           color: "#7C3AED" },
  { key: "product_other",    label: "Other Products",   color: "#96B2B2" },
  { key: "wholesale",        label: "Wholesale",        color: "#B79E61" },
  { key: "sales_discount",   label: "Discount",         color: "#dc2626", negative: true },
  { key: "sales_refund",     label: "Refund",           color: "#dc2626", negative: true },
  { key: "net_revenue",      label: "Net Revenue",      color: "#059669", bold: true },
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

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
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
      <div className="border-t mt-2 pt-2 flex justify-between font-semibold">
        <span>Total</span><span>{fmtShort(total)}</span>
      </div>
    </div>
  );
}

function SpaDeepaContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { locations, totals, isFetching, isSyncing, syncError, missingMonths, triggerSync } =
    useSpaRevenue(dateFrom, dateTo);

  const VAT_RATE = 0.18;

  const subtitle = useMemo(() => {
    const range = formatDateRangeLabel(dateFrom, dateTo);
    return `${range} · Source: Lapis + Zoho Books`;
  }, [dateFrom, dateTo]);

  const chartData = useMemo(() =>
    locations.map((loc) => ({
      name:     loc.name.replace("InterContinental", "IC").replace("Sunny Coast", "SC"),
      color:    loc.color,
      Services: loc.services,
      Phytomer: loc.product_phytomer,
      Purest:   loc.product_purest,
      "Other Products": loc.product_other,
      Wholesale: loc.wholesale,
      net:      loc.net_revenue,
    })),
    [locations]
  );

  const productBrandData = [
    { name: "Phytomer", value: totals.product_phytomer, color: "#4A90D9" },
    { name: "Purest",   value: totals.product_purest,   color: "#7C3AED" },
    { name: "Other",    value: totals.product_other,    color: "#96B2B2" },
  ].filter((d) => d.value > 0);

  const isLoading = isFetching || isSyncing;

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Spa — Deepa</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          <div className="flex flex-wrap gap-2 mt-2">
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

      {/* ── KPI Row (ex-VAT) ───────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">ex-VAT · used for EBITDA</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPICard label="Net Revenue"  value={totals.net_revenue}    accent="#059669" sub={`${locations.length} locations`} />
          <KPICard label="Services"     value={totals.services}       accent="#1B3A4B" sub={pct(totals.services, totals.net_revenue) + " of net"} />
          <KPICard label="Products"     value={totals.product_total}  accent="#4A90D9" sub={pct(totals.product_total, totals.net_revenue) + " of net"} />
          <KPICard label="Wholesale"    value={totals.wholesale}      accent="#B79E61" sub={pct(totals.wholesale, totals.net_revenue) + " of net"} />
          <div className="rounded-xl border bg-card p-4 md:p-5 border-l-4 border-l-red-400">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Deductions</p>
            <p className="text-2xl font-bold text-red-600">({fmtShort(totals.sales_discount + totals.sales_refund)})</p>
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">Discount: ({fmtShort(totals.sales_discount)})</p>
              <p className="text-xs text-muted-foreground">Refund: ({fmtShort(totals.sales_refund)})</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Row (inc-VAT) ──────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">inc-VAT (18%) · what customers paid</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPICard label="Net Revenue"  value={Math.round(totals.net_revenue   * (1 + VAT_RATE))} accent="#059669" sub="inc 18% VAT" />
          <KPICard label="Services"     value={Math.round(totals.services      * (1 + VAT_RATE))} accent="#1B3A4B" sub="inc 18% VAT" />
          <KPICard label="Products"     value={Math.round(totals.product_total * (1 + VAT_RATE))} accent="#4A90D9" sub="inc 18% VAT" />
          <KPICard label="Wholesale"    value={Math.round(totals.wholesale     * (1 + VAT_RATE))} accent="#B79E61" sub="inc 18% VAT" />
          <div className="rounded-xl border bg-card p-4 md:p-5 border-l-4 border-l-red-400">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Deductions</p>
            <p className="text-2xl font-bold text-red-600">({fmtShort(Math.round((totals.sales_discount + totals.sales_refund) * (1 + VAT_RATE)))})</p>
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">Discount: ({fmtShort(Math.round(totals.sales_discount * (1 + VAT_RATE)))})</p>
              <p className="text-xs text-muted-foreground">Refund: ({fmtShort(Math.round(totals.sales_refund * (1 + VAT_RATE)))})</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── VAT Summary Table ──────────────────────────────────────────────── */}
      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Summary: ex-VAT vs inc-VAT</h2>
          <p className="text-xs text-muted-foreground mb-4">All spa revenue lines at 18% VAT · EBITDA always uses ex-VAT column</p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold text-foreground min-w-[140px]">Line</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-foreground">ex-VAT</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-amber-600">VAT (18%)</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-foreground">inc-VAT</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Services",    value: totals.services,                                     neg: false },
                  { label: "Products",    value: totals.product_total,                                neg: false },
                  { label: "Wholesale",   value: totals.wholesale,                                    neg: false },
                  { label: "Discounts",   value: totals.sales_discount,                               neg: true  },
                  { label: "Refunds",     value: totals.sales_refund,                                 neg: true  },
                ].map(({ label, value, neg }, i) => {
                  const vat    = Math.round(value * VAT_RATE);
                  const inc    = Math.round(value * (1 + VAT_RATE));
                  const ex     = Math.round(value);
                  const color  = neg ? "#dc2626" : undefined;
                  const fmt    = (n: number) => neg && n > 0 ? `(${fmtShort(n)})` : fmtShort(n);
                  return (
                    <tr key={label} className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="px-4 py-2.5 font-medium">{label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color }}>{fmt(ex)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-600">{neg ? `(${fmtShort(vat)})` : fmtShort(vat)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color }}>{fmt(inc)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50">
                  <td className="px-4 py-2.5 font-bold text-foreground">Net Revenue</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-emerald-600">{fmtShort(Math.round(totals.net_revenue))}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-amber-600">{fmtShort(Math.round(totals.net_revenue * VAT_RATE))}</td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-emerald-600">{fmtShort(Math.round(totals.net_revenue * (1 + VAT_RATE)))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {locations.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Location</h2>
          <p className="text-xs text-muted-foreground mb-5">Services + products stacked per location · sorted by net revenue</p>
          <div className="h-[300px] md:h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 24, right: 12, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <Tooltip content={<RevenueTooltip />} />
                <Legend />
                <Bar dataKey="Services"       stackId="a" fill="#1B3A4B" />
                <Bar dataKey="Phytomer"       stackId="a" fill="#4A90D9" />
                <Bar dataKey="Purest"         stackId="a" fill="#7C3AED" />
                <Bar dataKey="Other Products" stackId="a" fill="#96B2B2" />
                <Bar dataKey="Wholesale"      stackId="a" fill="#B79E61" radius={[3,3,0,0]}>
                  <LabelList dataKey="net" content={(props) => {
                    const { x, width, y, value } = props as Record<string, unknown>;
                    const w = Number(width);
                    if (w < 20) return null;
                    return <text x={Number(x)+w/2} y={Number(y)-7} textAnchor="middle" fontSize={10} fontWeight={700} fill="#374151">{fmtShort(Number(value))}</text>;
                  }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {productBrandData.length > 0 && (
        <Card className="p-4 md:p-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">Product Revenue by Brand</h2>
          <p className="text-xs text-muted-foreground mb-5">Total product sales across all locations · ex VAT</p>
          <div className="h-[200px] md:h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productBrandData} layout="vertical" margin={{ top: 8, right: 80, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={72} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), "Revenue"]} />
                <Bar dataKey="value" radius={[0,4,4,0]} barSize={36}>
                  {productBrandData.map((e) => <Cell key={e.name} fill={e.color} />)}
                  <LabelList dataKey="value" position="right" content={(props) => {
                    const { x, width, y, height, value } = props as Record<string, unknown>;
                    return <text x={Number(x)+Number(width)+6} y={Number(y)+Number(height)/2} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="#374151">{fmtShort(Number(value))}</text>;
                  }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex gap-6 flex-wrap">
            {productBrandData.map((b) => (
              <div key={b.name} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: b.color }} />
                <span className="text-muted-foreground">{b.name}</span>
                <span className="font-semibold">{pct(b.value, totals.product_total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {locations.length > 0 && (() => {
        const vatLocations = locations.map((loc) => ({
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
        }));
        return (
          <>
            <Card className="p-4 md:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">Full Revenue Breakdown <span className="text-sm font-normal text-muted-foreground">(ex-VAT · EBITDA basis)</span></h2>
              <p className="text-xs text-muted-foreground mb-5">All revenue lines per location · deductions shown in (parentheses)</p>
              <RevenueTable locations={locations} />
              {(totals.sales_discount > 0 || totals.sales_refund > 0) && (
                <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5 mt-0.5 text-red-400 flex-shrink-0" />
                  <span>Discount and Refund from Zoho Books distributed proportionally to each location&apos;s revenue.</span>
                </div>
              )}
            </Card>

            <Card className="p-4 md:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">Full Revenue Breakdown <span className="text-sm font-normal text-muted-foreground">(inc-VAT 18% · what customers paid)</span></h2>
              <p className="text-xs text-muted-foreground mb-5">All revenue lines per location · ex-VAT × 1.18 · deductions shown in (parentheses)</p>
              <RevenueTable locations={vatLocations} />
            </Card>
          </>
        );
      })()}

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

export default function SpaDeepaPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <SpaDeepaContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
