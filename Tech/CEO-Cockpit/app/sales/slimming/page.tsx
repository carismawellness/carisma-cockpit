"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { useSlimmingSales } from "@/lib/hooks/useSlimmingSales";
import { useSlimmingTreatments } from "@/lib/hooks/useSlimmingTreatments";
import { RefreshCw, FileSpreadsheet } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Cell,
} from "recharts";

// ── Colour palette (unified pastel set, see .agents/skills/carisma-brand-colors) ─
const SLIMMING_GREEN = "#3D6B3D";   // slimming text-dark — primary brand
const NAVY           = "#B8C9E0";   // soft Meta blue
const BLUE           = "#B8C9E0";   // (alias)
const PURPLE         = "#D5C0E5";   // soft SG&A purple
const GOLD           = "#E5C088";   // soft amber
const TEAL           = "#B5DCDC";   // soft utilities cyan

const SERVICE_TYPE_COLORS: Record<string, string> = {
  weight_loss: SLIMMING_GREEN,  // primary slimming service
  treatment:   BLUE,
  medical:     PURPLE,
  product:     GOLD,
  unknown:     "#C7C4BD",
};

// Distinct colours for treatment types (cycles if more than palette length)
const TREATMENT_PALETTE = [SLIMMING_GREEN, NAVY, GOLD, PURPLE, "#3B7676", "#E5B5D0", "#8C7A5A", "#A8D4A8", "#E5B8B0", TEAL];

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

// Recharts v3 formatters — accept unknown then narrow
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labelFmtK   = (v: any): string => (typeof v === "number" ? fmtK(v)     : "");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const labelFmtPct = (v: any): string => (typeof v === "number" ? `${v}%`     : "");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tooltipFmt  = (value: any, name: any): [string, string] =>
  [typeof value === "number" ? fmtK(value) : String(value ?? ""), String(name)];

// ── Custom tooltips ───────────────────────────────────────────────────────────
function StaffTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; fill: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const inc  = payload.find(p => p.name === "Revenue inc-VAT")?.value ?? 0;
  const bk   = payload.find(p => p.name === "Bookings")?.value ?? 0;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-sm">{label}</p>
      <p style={{ color: SLIMMING_GREEN }}>Revenue inc-VAT: {fmtK(inc)}</p>
      <p style={{ color: NAVY }}>Bookings: {bk}</p>
    </div>
  );
}

function GenericTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; fill: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-sm">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.fill }}>{p.name}: {fmtK(p.value)}</p>
      ))}
    </div>
  );
}

// ── Shared legend for staff charts ────────────────────────────────────────────
function StaffLegend({ retailColor }: { retailColor?: string }) {
  const barColor = retailColor ?? SLIMMING_GREEN;
  return (
    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: barColor }} />
        Revenue inc-VAT
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: NAVY, opacity: 0.55 }} />
        Bookings (count scale)
      </span>
    </div>
  );
}

// ── Shared empty / loading state ──────────────────────────────────────────────
function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <p className="text-sm text-muted-foreground py-6 text-center">
      {isLoading ? "Loading…" : "No data for selected period"}
    </p>
  );
}

// ── Bar chart height: 48 px per row, min 180 ─────────────────────────────────
function chartH(n: number) { return Math.max(180, n * 48 + 40); }

// ── Main content ──────────────────────────────────────────────────────────────
function SlimmingSalesContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const {
    byStaff, byServiceType, byService, totals,
    isFetching, isSyncing, syncError, triggerSync,
  } = useSlimmingSales(dateFrom, dateTo);

  const spanDays     = Math.round((dateTo.getTime() - dateFrom.getTime()) / 86400000);
  const prevDateTo   = useMemo(() => new Date(dateFrom.getTime() - 86400000), [dateFrom]);
  const prevDateFrom = useMemo(() => new Date(prevDateTo.getTime() - spanDays * 86400000), [prevDateTo, spanDays]);
  const { totals: prevTotals } = useSlimmingSales(prevDateFrom, prevDateTo, { skipSync: true });

  const delta = useMemo(() => {
    const calc = (curr: number, prior: number) => prior > 0 ? ((curr - prior) / prior) * 100 : undefined;
    return {
      net:     calc(totals.revenue_inc,         prevTotals.revenue_inc),
      service: calc(totals.service_revenue_inc, prevTotals.service_revenue_inc),
      retail:  calc(totals.retail_revenue_inc,  prevTotals.retail_revenue_inc),
    };
  }, [totals, prevTotals]);

  const {
    byStaff: txByStaff,
    byTreatment,
    totals: txTotals,
    isFetching: txFetching,
    isSyncing: txSyncing,
  } = useSlimmingTreatments(dateFrom, dateTo);

  const isLoading   = isFetching || isSyncing;
  const txLoading   = txFetching || txSyncing;

  // Split staff: retail (name contains "retail") vs regular
  const regularStaff = byStaff.filter(s => !/retail/i.test(s.staff));
  const retailStaff  = byStaff
    .filter(s => /retail/i.test(s.staff))
    .map(s => ({ ...s, staff: s.staff.replace(/\s*retail\s*/i, "").trim() }));

  const regularChartData = regularStaff.map(s => ({
    name:              s.staff,
    "Revenue inc-VAT": s.revenue_inc,
    "Bookings":        s.tx_count,
  }));

  const retailChartData = retailStaff.map(s => ({
    name:              s.staff,
    "Revenue inc-VAT": s.revenue_inc,
    "Bookings":        s.tx_count,
  }));

  const serviceTypeData = byServiceType.map(t => ({
    name:      t.label,
    "Revenue": t.revenue_ex,
    type:      t.type,
    pct:       t.pct,
  }));

  const serviceData = byService.slice(0, 15).map(s => ({
    name:      s.service,
    "Revenue": s.revenue_ex,
    type:      s.type,
    pct:       s.pct,
  }));

  const txStaffData = txByStaff.map(s => ({
    name:      s.staff,
    "Revenue": s.revenue_ex,
    "Bookings": s.tx_count,
  }));

  const txTypeData = byTreatment.map(t => ({
    name:      t.treatment,
    "Revenue": t.revenue_ex,
    count:     t.tx_count,
    pct:       t.pct,
  }));

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
          Slimming — Sales
        </h1>
        <p className="text-sm text-muted-foreground">
          All figures in EUR · inc-VAT and ex-VAT shown · Revenue = services delivered (Full Price)
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=1945063877"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <FileSpreadsheet className="h-3 w-3" />
            Cockpit Datasheet — Slimming Sales ↗
          </a>
          <a
            href="https://docs.google.com/spreadsheets/d/195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a/edit#gid=1735295211"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <FileSpreadsheet className="h-3 w-3" />
            Cockpit Datasheet — Slimming Treatments (Tx) ↗
          </a>
        </div>
      </div>

      {/* ── Revenue Summary ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {totals.last_synced
            ? `Last synced: ${new Date(totals.last_synced).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`
            : "Not yet synced"}
        </p>
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
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{syncError}</p>
      )}
      <SalesKPIGrid columns={3}>
        <SalesKPICard
          label="Net Revenue"
          value={fmtK(totals.revenue_inc)}
          subtitle={`${fmtK(totals.revenue_ex)} ex-VAT · ${totals.tx_count} bookings · VAT ${fmtK(totals.vat_amount)}`}
          yoyChange={delta.net}
          yoyLabel="vs prev period"
        />
        <SalesKPICard
          label="Service Revenue"
          value={fmtK(totals.service_revenue_inc)}
          subtitle={`${pct(totals.service_revenue_ex, totals.revenue_ex)} of net`}
          yoyChange={delta.service}
          yoyLabel="vs prev period"
        />
        <SalesKPICard
          label="Retail Revenue"
          value={fmtK(totals.retail_revenue_inc)}
          subtitle={`${pct(totals.retail_revenue_ex, totals.revenue_ex)} of net`}
          yoyChange={delta.retail}
          yoyLabel="vs prev period"
        />
      </SalesKPIGrid>

      {/* ── Revenue by Staff — Regular & Retail (side-by-side) ──────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Regular staff */}
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-foreground">Revenue by Staff</h2>
            <span className="text-xs text-muted-foreground">(Sale of column)</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Services / programmes</p>
          {regularStaff.length === 0 ? (
            <EmptyState isLoading={isLoading} />
          ) : (
            <ResponsiveContainer width="100%" height={chartH(regularStaff.length)}>
              <BarChart
                layout="vertical"
                data={regularChartData}
                margin={{ top: 4, right: 72, left: 72, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<StaffTooltip />} />
                <Bar dataKey="Revenue inc-VAT" fill={SLIMMING_GREEN} radius={[0, 4, 4, 0]} maxBarSize={28}>
                  <LabelList dataKey="Revenue inc-VAT" position="right" formatter={labelFmtK} style={{ fontSize: 10, fill: "#374151" }} />
                </Bar>
                <Bar dataKey="Bookings" fill={NAVY} radius={[0, 4, 4, 0]} maxBarSize={12} opacity={0.55} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <StaffLegend />
        </Card>

        {/* Retail staff */}
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-foreground">Revenue by Staff — Retail</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Product retail sales</p>
          {retailStaff.length === 0 ? (
            <EmptyState isLoading={isLoading} />
          ) : (
            <ResponsiveContainer width="100%" height={chartH(retailStaff.length)}>
              <BarChart
                layout="vertical"
                data={retailChartData}
                margin={{ top: 4, right: 72, left: 72, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<StaffTooltip />} />
                <Bar dataKey="Revenue inc-VAT" fill={GOLD} radius={[0, 4, 4, 0]} maxBarSize={28}>
                  <LabelList dataKey="Revenue inc-VAT" position="right" formatter={labelFmtK} style={{ fontSize: 10, fill: "#374151" }} />
                </Bar>
                <Bar dataKey="Bookings" fill={NAVY} radius={[0, 4, 4, 0]} maxBarSize={12} opacity={0.55} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <StaffLegend retailColor={GOLD} />
        </Card>

      </div>

      {/* ── Revenue by Service Type ───────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-1">Revenue by Service Type</h2>
        <p className="text-xs text-muted-foreground mb-4">Weight Loss (col C) vs Treatments (col D) vs Medical</p>
        {byServiceType.length === 0 ? (
          <EmptyState isLoading={isLoading} />
        ) : (
          <ResponsiveContainer width="100%" height={chartH(byServiceType.length)}>
            <BarChart
              layout="vertical"
              data={serviceTypeData}
              margin={{ top: 4, right: 80, left: 120, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtK}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={116}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={tooltipFmt}
              />
              <Bar dataKey="Revenue" radius={[0, 4, 4, 0]} maxBarSize={32}>
                {serviceTypeData.map((entry, i) => (
                  <Cell key={i} fill={SERVICE_TYPE_COLORS[entry.type] ?? "#9CA3AF"} />
                ))}
                <LabelList
                  dataKey="pct"
                  position="right"
                  formatter={labelFmtPct}
                  style={{ fontSize: 11, fill: "#374151" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {/* Colour legend */}
        {byServiceType.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
            {byServiceType.map(t => (
              <span key={t.type} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: SERVICE_TYPE_COLORS[t.type] ?? "#9CA3AF" }} />
                {t.label}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ── Revenue by Service / Product ──────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-1">Revenue by Service / Product</h2>
        <p className="text-xs text-muted-foreground mb-4">Top 15 services/products by revenue ex-VAT · colour = service type</p>
        {byService.length === 0 ? (
          <EmptyState isLoading={isLoading} />
        ) : (
          <ResponsiveContainer width="100%" height={chartH(Math.min(byService.length, 15))}>
            <BarChart
              layout="vertical"
              data={serviceData}
              margin={{ top: 4, right: 80, left: 130, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtK}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={126}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={tooltipFmt}
              />
              <Bar dataKey="Revenue" radius={[0, 4, 4, 0]} maxBarSize={28}>
                {serviceData.map((entry, i) => (
                  <Cell key={i} fill={SERVICE_TYPE_COLORS[entry.type] ?? SLIMMING_GREEN} />
                ))}
                <LabelList
                  dataKey="pct"
                  position="right"
                  formatter={labelFmtPct}
                  style={{ fontSize: 11, fill: "#374151" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {byService.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
            {Object.entries(SERVICE_TYPE_COLORS).map(([type, color]) =>
              byService.some(s => s.type === type) ? (
                <span key={type} className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  {type === "weight_loss" ? "Weight Loss" : type === "treatment" ? "Treatment" : type === "medical" ? "Medical" : "Product"}
                </span>
              ) : null
            )}
          </div>
        )}
      </Card>

      {/* ═══════════════════════════════════════════════════════════
          Tx Slimming section — from the Treatments (Tx) tab
         ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-1 pt-2">
        <h2 className="text-lg font-bold text-foreground tracking-tight">Tx Slimming — Treatment Breakdown</h2>
        <p className="text-xs text-muted-foreground">
          Source: Cockpit Datasheet → Tx Slimming tab ·{" "}
          {txTotals.last_synced
            ? `Last synced: ${new Date(txTotals.last_synced).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`
            : "Not yet synced"}
        </p>
      </div>

      {/* ── Treatments by Therapist ───────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-1">Treatments by Therapist</h2>
        <p className="text-xs text-muted-foreground mb-4">Revenue ex-VAT per therapist from the Tx tab</p>
        {txByStaff.length === 0 ? (
          <EmptyState isLoading={txLoading} />
        ) : (
          <ResponsiveContainer width="100%" height={chartH(txByStaff.length)}>
            <BarChart
              layout="vertical"
              data={txStaffData}
              margin={{ top: 4, right: 80, left: 100, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtK}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                tick={{ fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<GenericTooltip />} />
              <Bar dataKey="Revenue" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={28}>
                <LabelList
                  dataKey="Revenue"
                  position="right"
                  formatter={labelFmtK}
                  style={{ fontSize: 11, fill: "#374151" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {txByStaff.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            Total: {fmtK(txTotals.revenue_ex)} ex-VAT · {txTotals.tx_count} sessions
          </div>
        )}
      </Card>

      {/* ── Treatments by Type ────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-1">Treatments by Type</h2>
        <p className="text-xs text-muted-foreground mb-4">Revenue ex-VAT per treatment type from the Tx tab</p>
        {byTreatment.length === 0 ? (
          <EmptyState isLoading={txLoading} />
        ) : (
          <ResponsiveContainer width="100%" height={chartH(byTreatment.length)}>
            <BarChart
              layout="vertical"
              data={txTypeData}
              margin={{ top: 4, right: 80, left: 140, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={fmtK}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={136}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={tooltipFmt}
              />
              <Bar dataKey="Revenue" radius={[0, 4, 4, 0]} maxBarSize={28}>
                {txTypeData.map((_, i) => (
                  <Cell key={i} fill={TREATMENT_PALETTE[i % TREATMENT_PALETTE.length]} />
                ))}
                <LabelList
                  dataKey="pct"
                  position="right"
                  formatter={labelFmtPct}
                  style={{ fontSize: 11, fill: "#374151" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {byTreatment.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            Total: {fmtK(txTotals.revenue_ex)} ex-VAT · {txTotals.tx_count} sessions
          </div>
        )}
      </Card>
    </>
  );
}

export default function SlimmingSalesPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <SlimmingSalesContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
