"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaEbitda } from "@/lib/hooks/useSpaEbitda";
import { useAestheticsEbitda } from "@/lib/hooks/useAestheticsEbitda";
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
} from "recharts";
import { BRAND } from "@/lib/constants/design-tokens";

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function pctOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function fmtPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

function fmtCurrencyShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000)     return `€${(value / 1_000).toFixed(1)}K`;
  return `€${value.toFixed(1)}`;
}

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

interface BUData {
  slug:        string;
  name:        string;
  color:       string;
  revenue:     number;
  cogs:        number;
  wages:       number;
  advertising: number;
  rent:        number;
  utilities:   number;
  sga:         number;
  ebitda:      number;
}

type NumericBUKey = "revenue" | "wages" | "cogs" | "advertising" | "rent" | "utilities" | "sga" | "ebitda";

const PL_ROWS: { key: NumericBUKey; label: string; isCost?: boolean }[] = [
  { key: "revenue",     label: "Net Revenue" },
  { key: "wages",       label: "Wages & Salaries", isCost: true },
  { key: "cogs",        label: "COGS",             isCost: true },
  { key: "rent",        label: "Rent",             isCost: true },
  { key: "advertising", label: "Advertising",      isCost: true },
  { key: "utilities",   label: "Utilities",        isCost: true },
  { key: "sga",         label: "SG&A",             isCost: true },
  { key: "ebitda",      label: "EBITDA" },
];

/* ------------------------------------------------------------------ */
/*  TOOLTIP                                                            */
/* ------------------------------------------------------------------ */

interface TooltipItem { name: string; value: number; color: string; dataKey: string; }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipItem[]; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-md text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground">{entry.name}:</span>
          <span className="font-semibold text-foreground">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SYNC BANNER                                                        */
/* ------------------------------------------------------------------ */

function SyncBanner({ isSyncing, syncError, label, onRetry }: {
  isSyncing: boolean;
  syncError: string | null;
  label: string;
  onRetry: () => void;
}) {
  if (!isSyncing && !syncError) return null;

  if (isSyncing) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
        <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Syncing {label} from Zoho Books…
      </div>
    );
  }

  return (
    <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
      {label} sync error: {syncError}{" "}
      <button className="underline ml-2" onClick={onRetry}>Retry</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MARGIN BADGE                                                       */
/* ------------------------------------------------------------------ */

function MarginBadge({ margin }: { margin: number }) {
  const cls = margin >= 50 ? "bg-emerald-100 text-emerald-800"
            : margin >= 30 ? "bg-amber-100 text-amber-800"
            : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {fmtPct(margin)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  INNER COMPONENT                                                    */
/* ------------------------------------------------------------------ */

function GroupEBITDAContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const spa   = useSpaEbitda(dateFrom, dateTo);
  const aesth = useAestheticsEbitda(dateFrom, dateTo);

  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  /* ---- Aggregate SPA locations → single BU ---- */
  const spaBU = useMemo((): BUData => {
    const z: BUData = {
      slug: "spa", name: "Spa", color: BRAND.spa.soft,
      revenue: 0, cogs: 0, wages: 0, advertising: 0,
      rent: 0, utilities: 0, sga: 0, ebitda: 0,
    };
    for (const loc of spa.locations) {
      z.revenue     += loc.revenue;
      z.cogs        += loc.cogs;
      z.wages       += loc.wages;
      z.advertising += loc.advertising;
      z.rent        += loc.rent;
      z.utilities   += loc.utilities;
      z.sga         += loc.sga;
      z.ebitda      += loc.ebitda;
    }
    return z;
  }, [spa.locations]);

  /* ---- Map Aesthetics & Slimming depts → BU format ---- */
  const aestheticsBU = useMemo((): BUData => {
    const d = aesth.depts.find((x) => x.dept === "aesthetics");
    return {
      slug: "aesthetics", name: "Aesthetics", color: BRAND.aesthetics.soft,
      revenue:     d?.revenue     ?? 0,
      cogs:        d?.cogs        ?? 0,
      wages:       d?.wages       ?? 0,
      advertising: d?.advertising ?? 0,
      rent:        d?.rent        ?? 0,
      utilities:   d?.utilities   ?? 0,
      sga:         d?.sga         ?? 0,
      ebitda:      d?.ebitda      ?? 0,
    };
  }, [aesth.depts]);

  const slimmingBU = useMemo((): BUData => {
    const d = aesth.depts.find((x) => x.dept === "slimming");
    return {
      slug: "slimming", name: "Slimming", color: BRAND.slimming.soft,
      revenue:     d?.revenue     ?? 0,
      cogs:        d?.cogs        ?? 0,
      wages:       d?.wages       ?? 0,
      advertising: d?.advertising ?? 0,
      rent:        d?.rent        ?? 0,
      utilities:   d?.utilities   ?? 0,
      sga:         d?.sga         ?? 0,
      ebitda:      d?.ebitda      ?? 0,
    };
  }, [aesth.depts]);

  const businessUnits: BUData[] = [spaBU, aestheticsBU, slimmingBU];

  /* ---- Group totals ---- */
  const group = useMemo((): BUData => {
    const z: BUData = {
      slug: "total", name: "Group Total", color: "",
      revenue: 0, cogs: 0, wages: 0, advertising: 0,
      rent: 0, utilities: 0, sga: 0, ebitda: 0,
    };
    for (const bu of [spaBU, aestheticsBU, slimmingBU]) {
      z.revenue     += bu.revenue;
      z.cogs        += bu.cogs;
      z.wages       += bu.wages;
      z.advertising += bu.advertising;
      z.rent        += bu.rent;
      z.utilities   += bu.utilities;
      z.sga         += bu.sga;
      z.ebitda      += bu.ebitda;
    }
    return z;
  }, [spaBU, aestheticsBU, slimmingBU]);

  const groupMargin = pctOf(group.ebitda, group.revenue);

  /* ---- KPI cards ---- */
  const kpis: KPIData[] = useMemo(() => [
    { label: "Group Revenue", value: formatCurrency(group.revenue) },
    { label: "Group EBITDA",  value: formatCurrency(group.ebitda) },
    {
      label: "Group EBITDA Margin", value: `${groupMargin.toFixed(1)}%`,
      target: "30%", targetValue: 30, currentValue: groupMargin,
    },
  ], [group, groupMargin]);

  /* ---- Chart data ---- */
  const chartData = businessUnits.map((bu) => ({
    name:        bu.name,
    Wages:       bu.wages,
    Advertising: bu.advertising,
    Rent:        bu.rent,
    Utilities:   bu.utilities,
    COGS:        bu.cogs,
    "SG&A":      bu.sga,
    EBITDA:      bu.ebitda,
  }));

  const isSpaLoading   = (spa.isFetching   || spa.isSyncing)   && spa.locations.length === 0;
  const isAesthLoading = (aesth.isFetching || aesth.isSyncing) && aesth.depts.length === 0;
  const isLoading = isSpaLoading || isAesthLoading;
  const hasData   = spa.locations.length > 0 || aesth.depts.some((d) => d.revenue > 0 || d.ebitda !== 0);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Group EBITDA</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Consolidated P&amp;L — Spa + Aesthetics + Slimming | {rangeLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <SyncButton
            label="Re-Sync Spa"
            onSync={async () => { spa.triggerSync(true); }}
            isExternalBusy={spa.isSyncing}
            lastSynced={spa.locations[0]?.lastSyncedAt ?? null}
          />
          <SyncButton
            label="Re-Sync Aesthetics"
            onSync={async () => { aesth.triggerSync(true); }}
            isExternalBusy={aesth.isSyncing}
            lastSynced={aesth.depts.find(d => d.dept === "aesthetics")?.lastSyncedAt ?? null}
          />
        </div>
      </div>

      {/* Sync banners */}
      <SyncBanner isSyncing={spa.isSyncing}   syncError={spa.syncError}   label="Spa"        onRetry={() => spa.triggerSync(true)} />
      <SyncBanner isSyncing={aesth.isSyncing} syncError={aesth.syncError} label="Aesthetics" onRetry={() => aesth.triggerSync(true)} />

      {/* Loading state */}
      {isLoading && !hasData && (
        <Card className="p-6 flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-muted-foreground">Pulling data from Zoho Books — please wait…</p>
        </Card>
      )}

      {hasData && (
        <>
          <KPICardRow kpis={kpis} />

          {/* ---- Business Unit P&L table ---- */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">P&amp;L by Business Unit</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Additive of Spa ({spa.locations.length} locations), Aesthetics, and Slimming
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground min-w-[160px]">Line Item</th>
                    {businessUnits.map((bu) => (
                      <th key={bu.slug} className="text-right py-2 px-3 font-semibold text-foreground min-w-[130px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: bu.color }} />
                          {bu.name}
                        </span>
                      </th>
                    ))}
                    <th className="text-right py-2 px-3 font-semibold text-foreground min-w-[130px] border-l border-border">
                      Group Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PL_ROWS.map((row) => {
                    const isEbitda  = row.key === "ebitda";
                    const isRevenue = row.key === "revenue";
                    const rowClass  = isEbitda  ? "border-t-2 border-border"
                                    : isRevenue ? "border-b border-border"
                                    : "border-b border-border/60";
                    const labelClass = isEbitda || isRevenue ? "font-bold text-foreground" : "text-foreground";

                    return (
                      <tr key={row.key} className={rowClass}>
                        <td className={`py-1.5 px-3 ${labelClass}`}>{row.label}</td>

                        {businessUnits.map((bu) => {
                          const val     = bu[row.key];
                          const display = row.isCost && val > 0
                            ? `(${fmtCurrencyShort(val)})`
                            : fmtCurrencyShort(val);
                          const valClass = isEbitda
                            ? val >= 0 ? "text-emerald-600 font-bold" : "text-red-600 font-bold"
                            : isRevenue ? "font-bold text-foreground"
                            : "text-foreground";
                          return (
                            <td key={bu.slug} className={`py-1.5 px-3 text-right tabular-nums ${valClass}`}>
                              {display}
                              {isEbitda && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  ({fmtPct(pctOf(val, bu.revenue))})
                                </span>
                              )}
                            </td>
                          );
                        })}

                        {/* Group Total column */}
                        {(() => {
                          const val     = group[row.key];
                          const display = row.isCost && val > 0
                            ? `(${fmtCurrencyShort(val)})`
                            : fmtCurrencyShort(val);
                          const valClass = isEbitda
                            ? val >= 0 ? "text-emerald-600 font-bold" : "text-red-600 font-bold"
                            : isRevenue ? "font-bold text-foreground"
                            : "text-foreground";
                          return (
                            <td className={`py-1.5 px-3 text-right tabular-nums border-l border-border ${valClass}`}>
                              {display}
                              {isEbitda && (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  ({fmtPct(pctOf(val, group.revenue))})
                                </span>
                              )}
                            </td>
                          );
                        })()}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ---- Cost structure bar chart ---- */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Cost Structure by Business Unit</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Stacked cost components as % of revenue. Green = EBITDA contribution.
            </p>
            <div className="h-[300px] md:h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                  <YAxis tickFormatter={(v: number) => fmtCurrencyShort(v)} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar dataKey="Wages"       stackId="s" fill="#E5C088" />
                  <Bar dataKey="Advertising" stackId="s" fill="#E5B5D0" />
                  <Bar dataKey="Rent"        stackId="s" fill="#C5D0E0" />
                  <Bar dataKey="Utilities"   stackId="s" fill="#B5DCDC" />
                  <Bar dataKey="COGS"        stackId="s" fill="#E5B8B0" />
                  <Bar dataKey="SG&A"        stackId="s" fill="#D5C0E5" />
                  <Bar dataKey="EBITDA"      stackId="s" fill="#A8D4A8">
                    <LabelList
                      dataKey="EBITDA"
                      position="top"
                      formatter={(v) => fmtCurrencyShort(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ---- Spa, Aesthetics & Slimming breakdown ---- */}
          {spa.locations.length > 0 && (
            <Card className="p-3 md:p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">Spa, Aesthetics and Slimming — Breakdown</h2>
              <p className="text-sm text-muted-foreground mb-4">
                All {spa.locations.length} spa locations plus Aesthetics and Slimming departments
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground sticky left-0 bg-background z-10 min-w-[170px]">Location / Dept</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">Revenue</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">Wages</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">COGS</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">Rent</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[120px]">Adv & Mktg</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">Utilities</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">SG&A</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[100px]">EBITDA</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground min-w-[80px]">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* ── Spa section header ── */}
                    <tr className="bg-[#EFE7D7]/40">
                      <td colSpan={10} className="py-1 px-3 text-xs font-semibold uppercase tracking-wide text-[#8C7A5A] sticky left-0">
                        Spa
                      </td>
                    </tr>

                    {/* Spa location rows */}
                    {spa.locations.map((loc) => (
                        <tr key={loc.id} className="border-b border-border/60">
                          <td className="py-1.5 px-3 sticky left-0 bg-background z-10">
                            <span className="inline-flex items-center gap-1.5 pl-2">
                              <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: loc.color }} />
                              {loc.name}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right font-medium text-foreground">{fmtCurrencyShort(loc.revenue)}</td>
                          <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(loc.wages)})</td>
                          <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(loc.cogs)})</td>
                          <td className="py-1.5 px-3 text-right text-foreground">
                            {loc.rent > 0 ? `(${fmtCurrencyShort(loc.rent)})` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 px-3 text-right text-foreground">
                            {loc.advertising > 0 ? `(${fmtCurrencyShort(loc.advertising)})` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 px-3 text-right text-foreground">
                            {loc.utilities > 0 ? `(${fmtCurrencyShort(loc.utilities)})` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 px-3 text-right text-foreground">
                            {loc.sga > 0 ? `(${fmtCurrencyShort(loc.sga)})` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className={`py-1.5 px-3 text-right font-bold ${loc.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {fmtCurrencyShort(loc.ebitda)}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <MarginBadge margin={pctOf(loc.ebitda, loc.revenue)} />
                          </td>
                        </tr>
                    ))}

                    {/* Spa sub-total */}
                    <tr className="border-t border-border bg-muted/20">
                      <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-muted/20 z-10">Spa Total</td>
                      <td className="py-1.5 px-3 text-right font-bold text-foreground">{fmtCurrencyShort(spaBU.revenue)}</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.wages)})</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.cogs)})</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.rent)})</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.advertising)})</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.utilities)})</td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">({fmtCurrencyShort(spaBU.sga)})</td>
                      <td className={`py-1.5 px-3 text-right font-bold ${spaBU.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtCurrencyShort(spaBU.ebitda)}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <MarginBadge margin={pctOf(spaBU.ebitda, spaBU.revenue)} />
                      </td>
                    </tr>

                    {/* ── Aesthetics section header ── */}
                    <tr className="bg-[#DEEBEB]/40 border-t-2 border-border">
                      <td colSpan={10} className="py-1 px-3 text-xs font-semibold uppercase tracking-wide text-[#3B7676] sticky left-0">
                        Aesthetics
                      </td>
                    </tr>

                    {/* Aesthetics row */}
                    <tr className="border-b border-border">
                      <td className="py-1.5 px-3 sticky left-0 bg-background z-10">
                        <span className="inline-flex items-center gap-1.5 pl-2">
                          <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#DEEBEB", border: "1px solid #3B7676" }} />
                          Aesthetics
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">{fmtCurrencyShort(aestheticsBU.revenue)}</td>
                      <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(aestheticsBU.wages)})</td>
                      <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(aestheticsBU.cogs)})</td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {aestheticsBU.rent > 0 ? `(${fmtCurrencyShort(aestheticsBU.rent)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {aestheticsBU.advertising > 0 ? `(${fmtCurrencyShort(aestheticsBU.advertising)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {aestheticsBU.utilities > 0 ? `(${fmtCurrencyShort(aestheticsBU.utilities)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {aestheticsBU.sga > 0 ? `(${fmtCurrencyShort(aestheticsBU.sga)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-bold ${aestheticsBU.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtCurrencyShort(aestheticsBU.ebitda)}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <MarginBadge margin={pctOf(aestheticsBU.ebitda, aestheticsBU.revenue)} />
                      </td>
                    </tr>

                    {/* ── Slimming section header ── */}
                    <tr className="bg-[#C9D8C1]/40 border-t-2 border-border">
                      <td colSpan={10} className="py-1 px-3 text-xs font-semibold uppercase tracking-wide text-[#3D6B3D] sticky left-0">
                        Slimming
                      </td>
                    </tr>

                    {/* Slimming row */}
                    <tr className="border-b border-border">
                      <td className="py-1.5 px-3 sticky left-0 bg-background z-10">
                        <span className="inline-flex items-center gap-1.5 pl-2">
                          <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#C9D8C1", border: "1px solid #3D6B3D" }} />
                          Slimming
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right font-medium text-foreground">{fmtCurrencyShort(slimmingBU.revenue)}</td>
                      <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(slimmingBU.wages)})</td>
                      <td className="py-1.5 px-3 text-right text-foreground">({fmtCurrencyShort(slimmingBU.cogs)})</td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {slimmingBU.rent > 0 ? `(${fmtCurrencyShort(slimmingBU.rent)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {slimmingBU.advertising > 0 ? `(${fmtCurrencyShort(slimmingBU.advertising)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {slimmingBU.utilities > 0 ? `(${fmtCurrencyShort(slimmingBU.utilities)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-1.5 px-3 text-right text-foreground">
                        {slimmingBU.sga > 0 ? `(${fmtCurrencyShort(slimmingBU.sga)})` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-bold ${slimmingBU.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtCurrencyShort(slimmingBU.ebitda)}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <MarginBadge margin={pctOf(slimmingBU.ebitda, slimmingBU.revenue)} />
                      </td>
                    </tr>

                    {/* ── Group Total ── */}
                    <tr className="border-t-2 border-border bg-[#EFE7D7]/30">
                      <td className="py-2 px-3 font-bold text-foreground sticky left-0 bg-[#EFE7D7]/30 z-10">Group Total</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">{fmtCurrencyShort(group.revenue)}</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.wages)})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.cogs)})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.rent)})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.advertising)})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.utilities)})</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">({fmtCurrencyShort(group.sga)})</td>
                      <td className={`py-2 px-3 text-right font-bold text-lg ${group.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtCurrencyShort(group.ebitda)}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <MarginBadge margin={pctOf(group.ebitda, group.revenue)} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {!isLoading && !hasData && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No data found for this date range. Try re-syncing from Zoho Books.
        </Card>
      )}

    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function GroupEBITDAPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <GroupEBITDAContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
