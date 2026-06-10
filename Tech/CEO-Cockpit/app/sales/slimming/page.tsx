"use client";

import { Fragment, useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { SalesKPIGrid } from "@/components/sales/SalesKPIGrid";
import { useSlimmingSales } from "@/lib/hooks/useSlimmingSales";
import { useSlimmingTreatments } from "@/lib/hooks/useSlimmingTreatments";
import { useSalaryRoster } from "@/lib/hooks/useSalaryRoster";
import { FileSpreadsheet } from "lucide-react";
import { SyncButton } from "@/components/dashboard/SyncButton";
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
const SALARY_BLUE = "#4a7fa5";

const SLM_GROUP_ORDER = ["Weight Loss", "GLP-1s", "Body Treatments", "Packages", "Medical", "Products", "Admin", "Other"] as const;
const SLM_GROUP_COLORS: Record<string, string> = {
  "Weight Loss":     "#3D6B3D",
  "GLP-1s":          "#7C3AED",
  "Body Treatments": "#3B7676",
  "Packages":        "#B87000",
  "Medical":         "#2563EB",
  "Products":        "#8C7A5A",
  "Admin":           "#9CA3AF",
  "Other":           "#D1D5DB",
};

function enrichWithSalary(
  staff: string,
  revenue_inc: number,
  revenue_ex: number,
  getSalary: (name: string) => number | null,
) {
  const salary = getSalary(staff) ?? 0;
  const salary_cost = salary > 0 ? Math.min(salary, revenue_inc) : 0;
  const k_pct = salary > 0 && revenue_ex > 0 ? +(salary / revenue_ex * 100).toFixed(0) : null;
  const revStr = revenue_inc >= 1000 ? `€${(revenue_inc / 1000).toFixed(1)}K` : `€${revenue_inc}`;
  return {
    salary_cost,
    revenue_net_inc: Math.max(0, revenue_inc - salary_cost),
    k_label: k_pct != null ? `${k_pct}%` : null as string | null,
    bar_label: revStr,
  };
}

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

  const { getSlmSalary } = useSalaryRoster(dateFrom, dateTo);

  const isLoading   = isFetching || isSyncing;
  const txLoading   = txFetching || txSyncing;

  // Split staff: retail (name contains "retail") vs regular
  const regularStaff = byStaff.filter(s => !/retail/i.test(s.staff));
  const retailStaff  = byStaff
    .filter(s => /retail/i.test(s.staff))
    .map(s => ({ ...s, staff: s.staff.replace(/\s*retail\s*/i, "").trim() }));

  const regularChartData = useMemo(() =>
    regularStaff.map(s => ({
      name: s.staff,
      "Bookings": s.tx_count,
      ...enrichWithSalary(s.staff, s.revenue_inc, s.revenue_ex, getSlmSalary),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regularStaff, getSlmSalary]
  );

  const retailChartData = useMemo(() =>
    retailStaff.map(s => ({
      name: s.staff,
      "Bookings": s.tx_count,
      ...enrichWithSalary(s.staff, s.revenue_inc, s.revenue_ex, getSlmSalary),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [retailStaff, getSlmSalary]
  );

  const txStaffData = useMemo(() =>
    txByStaff.map(s => ({
      name: s.staff,
      "Bookings": s.tx_count,
      ...enrichWithSalary(s.staff, s.revenue_ex, s.revenue_ex, getSlmSalary),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txByStaff, getSlmSalary]
  );

  const serviceTypeData = byServiceType.map(t => ({
    name:      t.label,
    "Revenue": t.revenue_ex,
    type:      t.type,
    pct:       t.pct,
  }));

  const byGroup = useMemo(() => {
    const map = new Map<string, typeof byService>();
    for (const s of byService) {
      const g = s.nav_group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return SLM_GROUP_ORDER
      .filter(g => map.has(g))
      .map(g => ({
        group:         g,
        color:         SLM_GROUP_COLORS[g] ?? "#D1D5DB",
        services:      map.get(g)!,
        total_revenue: map.get(g)!.reduce((s, v) => s + v.revenue_ex, 0),
        total_count:   map.get(g)!.reduce((s, v) => s + v.tx_count, 0),
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byService]);

  const txTypeData = byTreatment.map(t => ({
    name:      t.treatment,
    "Revenue": t.revenue_ex,
    count:     t.tx_count,
    pct:       t.pct,
  }));

  return (
    <>
      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
        <SyncButton
          onSync={async () => { triggerSync(); }}
          lastSynced={totals.last_synced}
          isExternalBusy={isSyncing || isFetching}
        />
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
                margin={{ top: 4, right: 100, left: 72, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<StaffTooltip />} />
                <Bar dataKey="revenue_net_inc" stackId="rev" fill={SLIMMING_GREEN} radius={[0, 0, 0, 0]} maxBarSize={28} name="Revenue inc-VAT" />
                <Bar dataKey="salary_cost" stackId="rev" fill={SALARY_BLUE} radius={[0, 4, 4, 0]} maxBarSize={28} name="Salary cost">
                  <LabelList dataKey="k_label" position="insideRight" formatter={(v: unknown) => v ? String(v) : ""} style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }} />
                  <LabelList dataKey="bar_label" position="right" formatter={(v: unknown) => String(v ?? "")} style={{ fontSize: 10, fill: "#374151" }} />
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
                margin={{ top: 4, right: 100, left: 72, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={68} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<StaffTooltip />} />
                <Bar dataKey="revenue_net_inc" stackId="rev" fill={GOLD} radius={[0, 0, 0, 0]} maxBarSize={28} name="Revenue inc-VAT" />
                <Bar dataKey="salary_cost" stackId="rev" fill={SALARY_BLUE} radius={[0, 4, 4, 0]} maxBarSize={28} name="Salary cost">
                  <LabelList dataKey="k_label" position="insideRight" formatter={(v: unknown) => v ? String(v) : ""} style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }} />
                  <LabelList dataKey="bar_label" position="right" formatter={(v: unknown) => String(v ?? "")} style={{ fontSize: 10, fill: "#374151" }} />
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

      {/* ── Revenue by Service / Product — grouped by nav category ─── */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold text-foreground">Revenue by Service / Product</h2>
          <span className="text-xs text-muted-foreground">grouped by website nav category</span>
        </div>
        {byService.length === 0 ? (
          <EmptyState isLoading={isLoading} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium w-[38%]">Service / Product</th>
                  <th className="text-left pb-2 font-medium">Category</th>
                  <th className="text-right pb-2 font-medium">Bookings</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {byGroup.map(({ group, color, services, total_revenue, total_count }) => (
                  <Fragment key={group}>
                    <tr className="border-y border-muted bg-muted/20">
                      <td colSpan={2} className="py-2 pl-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-4 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{group}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground font-medium pr-0.5">{total_count}</td>
                      <td className="py-2 text-right text-xs font-semibold">{fmtK(total_revenue)}</td>
                      <td className="py-2 pl-4 text-xs text-muted-foreground">
                        {totals.revenue_ex > 0 ? `${((total_revenue / totals.revenue_ex) * 100).toFixed(1)}%` : ""}
                      </td>
                    </tr>
                    {services.map(s => (
                      <tr key={s.service} className="border-b last:border-0 hover:bg-muted/10">
                        <td className="py-2 pl-5 font-medium">{s.service}</td>
                        <td className="py-2">
                          <span className="text-xs text-muted-foreground">{s.nav_category}</span>
                        </td>
                        <td className="py-2 text-right text-muted-foreground">{s.tx_count}</td>
                        <td className="py-2 text-right font-medium">{fmtK(s.revenue_ex)}</td>
                        <td className="py-2 pl-4">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: color }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{s.pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="pt-2.5" colSpan={2}>Total</td>
                  <td className="pt-2.5 text-right text-muted-foreground">{totals.tx_count}</td>
                  <td className="pt-2.5 text-right">{fmtK(totals.revenue_ex)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
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
              margin={{ top: 4, right: 100, left: 100, bottom: 4 }}
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
              <Bar dataKey="revenue_net_inc" stackId="rev" fill={TEAL} radius={[0, 0, 0, 0]} maxBarSize={28} name="Revenue ex-VAT" />
              <Bar dataKey="salary_cost" stackId="rev" fill={SALARY_BLUE} radius={[0, 4, 4, 0]} maxBarSize={28} name="Salary cost">
                <LabelList dataKey="k_label" position="insideRight" formatter={(v: unknown) => v ? String(v) : ""} style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }} />
                <LabelList dataKey="bar_label" position="right" formatter={(v: unknown) => String(v ?? "")} style={{ fontSize: 11, fill: "#374151" }} />
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
