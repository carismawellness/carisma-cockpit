"use client";

import { useMemo } from "react";
import { CIChat } from "@/components/ci/CIChat";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { Card } from "@/components/ui/card";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaRevenue } from "@/lib/hooks/useSpaRevenue";
import {
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { RefreshCw, AlertCircle, Database } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════
   MOCK DATA — Aesthetics & Slimming (pending real data integration)
   ═══════════════════════════════════════════════════════════════════════ */

const VAT_RATE = 0.18;

const AES_MOCK  = { services: 40_880, retail: 783,  lastYearTotal: 35_200,  aov: 234, lastYearAov: 218, clients: 86,  clientsYoy: 14.2 };
const SLIM_MOCK = { services: 65_737, retail: 666,  lastYearTotal: 0,       aov: 156, lastYearAov: 0,   members: 480 };

const brandColorMap: Record<string, string> = {
  Spa:        chartColors.spa,
  Aesthetics: chartColors.aesthetics,
  Slimming:   chartColors.slimming,
};

/* ═══════════════════════════════════════════════════════════════════════
   TOOLTIPS
   ═══════════════════════════════════════════════════════════════════════ */

function BrandRevenueTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-lg">
      <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-6 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="font-medium">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function AovTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-lg">
      <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-6 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="font-medium">{entry.value != null ? `€${entry.value}` : "N/A"}</span>
        </div>
      ))}
    </div>
  );
}

function DemoTag() {
  return (
    <span className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 ml-1.5 align-middle">
      Demo
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function SalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { totals, isFetching, isSyncing, syncError, triggerSync } = useSpaRevenue(dateFrom, dateTo);
  const isLoading = isFetching || isSyncing;

  /* ── Spa real data (inc-VAT to match Deepa dashboard) ─────────── */
  const spa = useMemo(() => ({
    net:      Math.round(totals.net_revenue   * (1 + VAT_RATE)),
    services: Math.round(totals.services      * (1 + VAT_RATE)),
    products: Math.round(totals.product_total * (1 + VAT_RATE)),
  }), [totals]);

  /* ── Combined totals ──────────────────────────────────────────── */
  const aesTotal  = AES_MOCK.services  + AES_MOCK.retail;
  const slimTotal = SLIM_MOCK.services + SLIM_MOCK.retail;

  const totalNet      = spa.net      + aesTotal  + slimTotal;
  const totalServices = spa.services + AES_MOCK.services + SLIM_MOCK.services;
  const totalRetail   = spa.products + AES_MOCK.retail   + SLIM_MOCK.retail;
  const retailPctOfTotal = totalNet > 0 ? ((totalRetail / totalNet) * 100).toFixed(1) : "—";

  /* ── Brand chart data ─────────────────────────────────────────── */
  const brandChartData = useMemo(() => [
    {
      brand:               "Spa",
      "Service Revenue":   spa.services,
      "Retail Revenue":    spa.products,
      "Last Year Total":   null,
      yoyPct:              null,
      total:               spa.net,
      fill:                brandColorMap["Spa"],
    },
    {
      brand:               "Aesthetics",
      "Service Revenue":   AES_MOCK.services,
      "Retail Revenue":    AES_MOCK.retail,
      "Last Year Total":   AES_MOCK.lastYearTotal > 0 ? AES_MOCK.lastYearTotal : null,
      yoyPct:              AES_MOCK.lastYearTotal > 0
                             ? ((aesTotal - AES_MOCK.lastYearTotal) / AES_MOCK.lastYearTotal) * 100
                             : null,
      total:               aesTotal,
      fill:                brandColorMap["Aesthetics"],
    },
    {
      brand:               "Slimming",
      "Service Revenue":   SLIM_MOCK.services,
      "Retail Revenue":    SLIM_MOCK.retail,
      "Last Year Total":   null,
      yoyPct:              null,
      total:               slimTotal,
      fill:                brandColorMap["Slimming"],
    },
  ], [spa, aesTotal, slimTotal]);

  /* ── AOV chart data ───────────────────────────────────────────── */
  const aovChartData = [
    { brand: "Aesthetics", AOV: AES_MOCK.aov,  "Last Year AOV": AES_MOCK.lastYearAov,  yoyPct: ((AES_MOCK.aov - AES_MOCK.lastYearAov) / AES_MOCK.lastYearAov) * 100, fill: brandColorMap["Aesthetics"] },
    { brand: "Slimming",   AOV: SLIM_MOCK.aov, "Last Year AOV": null,                  yoyPct: null, fill: brandColorMap["Slimming"] },
  ];

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Sales Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDateRangeLabel(dateFrom, dateTo)} · Company-wide performance across all brands
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600">
              <Database className="h-3 w-3" />
              Spa: Lapis POS + Zoho Books (inc-VAT)
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-amber-50 text-amber-600">
              Aesthetics &amp; Slimming: demo data
            </span>
          </div>
        </div>
        <button
          onClick={() => triggerSync(true)}
          disabled={isLoading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing…" : "Re-Sync Spa"}
        </button>
      </div>

      {syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Spa sync error: {syncError}</span>
        </div>
      )}

      {/* ── Company-wide KPIs ──────────────────────────────────── */}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="Total Net Revenue"
          value={formatCurrency(totalNet)}
          subtitle="Spa (real) + Aesthetics & Slimming (demo)"
        />
        <SalesKPICard
          label="Services Revenue"
          value={formatCurrency(totalServices)}
          subtitle="Treatments across all brands"
        />
        <SalesKPICard
          label="Retail Revenue"
          value={formatCurrency(totalRetail)}
          subtitle={`${retailPctOfTotal}% of total`}
        />
      </SalesKPIGrid>

      {/* ── Brand Snapshot ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.spa }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Spa
            {isLoading && <RefreshCw className="inline h-3 w-3 ml-1.5 animate-spin text-muted-foreground" />}
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(spa.net)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {totals.net_revenue > 0
              ? `${formatCurrency(totals.net_revenue)} ex-VAT · real data`
              : isLoading ? "Loading…" : "No data"}
          </p>
        </Card>
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.aesthetics }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Aesthetics <DemoTag />
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(aesTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {AES_MOCK.clients.toLocaleString()} clients
            <span className="text-green-600 font-medium ml-1">+{AES_MOCK.clientsYoy}%</span>
          </p>
        </Card>
        <Card className="p-3 md:p-5 border-l-4" style={{ borderLeftColor: chartColors.slimming }}>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Slimming <DemoTag />
          </p>
          <p className="text-xl md:text-2xl font-bold text-foreground">{formatCurrency(slimTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {SLIM_MOCK.members.toLocaleString()} members
            <span className="text-muted-foreground ml-1">Since Feb 2026</span>
          </p>
        </Card>
      </div>

      {/* ── Revenue by Brand ────────────────────────────────────── */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">Revenue by Brand</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Service + retail revenue per brand · Spa: real data (inc-VAT) · Others: demo · YoY where available
        </p>
        <div className="h-[260px] md:h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={brandChartData} margin={{ top: 32, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="brand" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip content={<BrandRevenueTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" />
              <Bar dataKey="Service Revenue" stackId="revenue" fill={chartColors.spa} radius={[0, 0, 0, 0]}>
                <LabelList
                  dataKey="Service Revenue"
                  content={(props) => {
                    const { x, width, y, height, value } = props as Record<string, unknown>;
                    const w = Number(width);
                    if (w < 40) return <></>;
                    return (
                      <text x={Number(x) + w / 2} y={Number(y) + Number(height) / 2}
                        textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={600} fill="white">
                        {formatCurrency(Number(value))}
                      </text>
                    );
                  }}
                />
              </Bar>
              <Bar dataKey="Retail Revenue" stackId="revenue" fill={chartColors.aesthetics} radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="total"
                  content={(props) => {
                    const { x, width, y, index } = props as Record<string, unknown>;
                    const entry = brandChartData[Number(index)];
                    if (!entry) return <></>;
                    return (
                      <>
                        <text x={Number(x) + Number(width) / 2} y={Number(y) - 18}
                          textAnchor="middle" fontSize={12} fontWeight={700} fill="#374151">
                          {formatCurrency(entry.total)}
                        </text>
                        {entry.yoyPct !== null && (
                          <text x={Number(x) + Number(width) / 2} y={Number(y) - 5}
                            textAnchor="middle" fontSize={10} fontWeight={600}
                            fill={entry.yoyPct >= 0 ? "#059669" : "#dc2626"}>
                            {entry.yoyPct >= 0 ? "+" : ""}{entry.yoyPct.toFixed(1)}% YoY
                          </text>
                        )}
                      </>
                    );
                  }}
                />
              </Bar>
              <Line
                type="monotone"
                dataKey="Last Year Total"
                stroke={chartColors.target}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 4, fill: chartColors.target }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── AOV by Brand (Aesthetics & Slimming only — Spa lacks appt data) */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Average Order Value by Brand <DemoTag />
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          Aesthetics &amp; Slimming only · Spa AOV pending appointment data integration
        </p>
        <div className="h-[220px] md:h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={aovChartData} margin={{ top: 16, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="brand" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `€${v}`} tick={{ fontSize: 11 }} domain={[0, 280]} />
              <Tooltip content={<AovTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="AOV" name="Current AOV" fill={chartColors.spa} radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="AOV"
                  content={(props) => {
                    const { x, width, y, value, index } = props as Record<string, unknown>;
                    const entry = aovChartData[Number(index)];
                    if (!entry) return <></>;
                    const isPositive = entry.yoyPct !== null && entry.yoyPct >= 0;
                    return (
                      <>
                        <text x={Number(x) + Number(width) / 2} y={Number(y) - (entry.yoyPct !== null ? 18 : 8)}
                          textAnchor="middle" fontSize={12} fontWeight={700} fill="#374151">
                          €{Number(value)}
                        </text>
                        {entry.yoyPct !== null && (
                          <text x={Number(x) + Number(width) / 2} y={Number(y) - 5}
                            textAnchor="middle" fontSize={10} fontWeight={600}
                            fill={isPositive ? "#059669" : "#dc2626"}>
                            {isPositive ? "+" : ""}{entry.yoyPct.toFixed(1)}% YoY
                          </text>
                        )}
                      </>
                    );
                  }}
                />
              </Bar>
              <Line
                type="monotone"
                dataKey="Last Year AOV"
                name="Last Year AOV"
                stroke={chartColors.target}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={{ r: 4, fill: chartColors.target }}
                connectNulls={false}
              />
            </ComposedChart>
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
