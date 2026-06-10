"use client";

import { useMemo, useState, useCallback } from "react";
import { SyncButton } from "@/components/dashboard/SyncButton";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useSpaEbitda, SpaLocationData } from "@/lib/hooks/useSpaEbitda";
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

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

function pctOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

function fmtPct(val: number): string {
  return `${Math.round(val)}%`;
}

function fmtCurrencyShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000)     return `€${(value / 1_000).toFixed(1)}K`;
  return `€${Number(value).toFixed(1)}`;
}

/* ------------------------------------------------------------------ */
/*  CUSTOM TOOLTIP                                                     */
/* ------------------------------------------------------------------ */

interface TooltipPayloadItem { name: string; value: number; color: string; dataKey: string; }

function BreakdownTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
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
/*  CHART LABEL RENDERERS                                              */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderSegmentLabel = (props: any) => {
  const { x, y, width, height, value } = props;
  if (!value || Math.abs(height) < 18) return null;
  return (
    <text x={x + width / 2} y={y + height / 2} fill="#fff"
      textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight="500">
      {value}%
    </text>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderTopLabel = (props: any) => {
  const { x, y, width, value } = props;
  if (!value) return null;
  return (
    <text x={x + width / 2} y={y - 8} fill="#333"
      textAnchor="middle" fontSize={11} fontWeight="bold">
      {value}%
    </text>
  );
};

/* ------------------------------------------------------------------ */
/*  EBITDA RECONCILIATION CHECK                                        */
/* ------------------------------------------------------------------ */

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface BelowItem { label: string; amount: number; }
interface GapItem   { code: string; name: string; amount: number; category?: string; note?: string; }
interface GapAnalysis {
  excluded_expenses:    GapItem[];
  not_linked_expenses:  GapItem[];
  not_in_db_expenses:   GapItem[];
  below_ebitda:         GapItem[];
  income_mapped_missing: GapItem[];
  totals: {
    excluded_total:      number;
    not_linked_total:    number;
    not_in_db_total:     number;
    below_ebitda_total:  number;
  };
}
interface CheckResult {
  period:    { date_from: string; date_to: string };
  zoho:      { revenue: number; costs: number; ebitda: number; below_ebitda: BelowItem[]; below_total: number };
  salary_supplement: { total: number; by_slug: Record<string, number> };
  reconciliation: {
    zoho_ebitda: number;
    salary_supplement: number;
    expected_ebitda: number;
    actual_ebitda_zoho_rev: number;
    cockpit_revenue: number;
    zoho_revenue: number;
    revenue_gap: number;
    frontend_ebitda: number;
    expected_with_cockpit: number;
    difference: number;
    status: "ok" | "mismatch";
  };
  gap_analysis: GapAnalysis;
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? `€${(abs / 1_000_000).toFixed(1)}M`
          : abs >= 1_000     ? `€${(abs / 1_000).toFixed(1)}K`
          : `€${abs.toFixed(1)}`;
  return v < 0 ? `(${s})` : s;
}

function Row({ label, value, bold, indent, green, red, sub }: {
  label: string; value: string | number; bold?: boolean; indent?: boolean;
  green?: boolean; red?: boolean; sub?: string;
}) {
  const cls = bold ? "font-semibold" : "font-normal";
  const vcls = green ? "text-emerald-600 font-semibold"
             : red   ? "text-red-600 font-semibold"
             : bold  ? "font-semibold text-foreground"
             : "text-foreground";
  return (
    <div className={`flex items-start justify-between py-1 ${indent ? "pl-4" : ""} text-sm border-b border-border/40 last:border-0`}>
      <span className={`text-muted-foreground ${cls}`}>{label}
        {sub && <span className="ml-1 text-xs text-muted-foreground/60">{sub}</span>}
      </span>
      <span className={vcls}>{typeof value === "number" ? fmt(value) : value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GAP ANALYSIS SECTION                                               */
/* ------------------------------------------------------------------ */

const GAP_CATEGORIES: { key: keyof GapAnalysis; label: string; totalKey?: keyof GapAnalysis["totals"]; color: string; desc: string }[] = [
  { key: "excluded_expenses",   label: "Excluded in Settings",    totalKey: "excluded_total",      color: "text-amber-700",  desc: "Accounts mapped in Zoho CoA but marked as excluded — not pulled into any EBITDA line" },
  { key: "not_linked_expenses", label: "Unlinked (No EBITDA Line)", totalKey: "not_linked_total",  color: "text-orange-700", desc: "In CoA mapping but with no EBITDA line assigned — cost falls through to default" },
  { key: "not_in_db_expenses",  label: "Not in CoA Mapping",      totalKey: "not_in_db_total",     color: "text-red-700",    desc: "Account not found in CoA mapping at all — ETL used name-based default grouping" },
  { key: "below_ebitda",        label: "Below EBITDA Line",       totalKey: "below_ebitda_total",  color: "text-slate-600",  desc: "D&A, interest and tax items correctly excluded from EBITDA (below the line)" },
];

function GapTable({ items, totalKey, total, emptyMsg }: {
  items: GapItem[];
  totalKey?: string;
  total?: number;
  emptyMsg: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground py-2 pl-1">{emptyMsg}</p>;
  }
  return (
    <table className="w-full text-xs mt-1">
      <thead>
        <tr className="border-b border-border/60">
          <th className="text-left py-1 px-1 text-muted-foreground font-medium w-16">Code</th>
          <th className="text-left py-1 px-1 text-muted-foreground font-medium">Name</th>
          <th className="text-right py-1 px-1 text-muted-foreground font-medium w-20">Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="border-b border-border/30 last:border-0">
            <td className="py-1 px-1 text-muted-foreground font-mono">{item.code}</td>
            <td className="py-1 px-1 text-foreground">
              {item.name}
              {item.category && <span className="ml-1 text-muted-foreground/60">({item.category})</span>}
            </td>
            <td className="py-1 px-1 text-right font-medium text-foreground">{fmt(item.amount)}</td>
          </tr>
        ))}
      </tbody>
      {total !== undefined && items.length > 1 && (
        <tfoot>
          <tr className="border-t border-border">
            <td colSpan={2} className="py-1 px-1 font-semibold text-foreground">Total</td>
            <td className="py-1 px-1 text-right font-semibold text-foreground">{fmt(total)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function GapAnalysisPanel({ gap }: { gap: GapAnalysis }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const expenseCategories = GAP_CATEGORIES;
  const incomeItems = gap.income_mapped_missing;

  const hasAnyExpense = expenseCategories.some(c => (gap[c.key] as GapItem[]).length > 0);

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h3 className="text-sm font-semibold text-foreground mb-1">Account Gap Analysis</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Accounts with activity in Zoho that are excluded or unlinked, plus income accounts mapped in settings but absent from Zoho this period.
      </p>

      {/* Expenses */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Expenses</p>
      {!hasAnyExpense && (
        <p className="text-xs text-emerald-600 mb-4">No gaps — all expense accounts are mapped and linked.</p>
      )}
      <div className="space-y-1">
        {expenseCategories.map(cat => {
          const items = gap[cat.key] as GapItem[];
          const total = cat.totalKey ? gap.totals[cat.totalKey] : undefined;
          const isOpen = open.has(cat.key);
          const count = items.length;
          return (
            <div key={cat.key} className="rounded-md border border-border overflow-hidden">
              <button
                onClick={() => toggle(cat.key)}
                className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className={`font-medium ${cat.color}`}>{cat.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {count === 0 ? "— none" : `${count} account${count !== 1 ? "s" : ""}${total ? ` · ${fmt(total)}` : ""}`}
                  </span>
                </span>
                <svg className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  <p className="text-xs text-muted-foreground/70 mt-2 mb-1">{cat.desc}</p>
                  <GapTable items={items} total={total} emptyMsg="No accounts in this category for the selected period." />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Income */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-2">Income</p>
      <div className="rounded-md border border-border overflow-hidden">
        <button
          onClick={() => toggle("income_mapped_missing")}
          className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm">
            <span className="font-medium text-blue-700">Mapped as Revenue — No Zoho Figure</span>
            <span className="text-muted-foreground text-xs">
              {incomeItems.length === 0 ? "— none" : `${incomeItems.length} account${incomeItems.length !== 1 ? "s" : ""}`}
            </span>
          </span>
          <svg className={`h-4 w-4 text-muted-foreground transition-transform ${open.has("income_mapped_missing") ? "rotate-180" : ""}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open.has("income_mapped_missing") && (
          <div className="px-3 pb-3">
            <p className="text-xs text-muted-foreground/70 mt-2 mb-1">
              Accounts marked as revenue in CoA settings but returned no figure from Zoho for this period.
            </p>
            <GapTable items={incomeItems} emptyMsg="All revenue-mapped accounts have figures in Zoho this period." />
          </div>
        )}
      </div>
    </div>
  );
}

function EbitdaReconciliation({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [status, setStatus]   = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult]   = useState<CheckResult | null>(null);
  const [errMsg, setErrMsg]   = useState<string>("");

  const runCheck = useCallback(async () => {
    setStatus("loading");
    setResult(null);
    setErrMsg("");
    try {
      const res = await fetch("/api/ebitda/zoho-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_from: toDateStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1)),
          date_to:   toDateStr(new Date(dateTo.getFullYear(), dateTo.getMonth(),
                       new Date(dateTo.getFullYear(), dateTo.getMonth() + 1, 0).getDate())),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setErrMsg(json.error ?? "Check failed"); setStatus("error"); return; }
      setResult(json as CheckResult);
      setStatus("done");
    } catch (e) {
      setErrMsg(String(e));
      setStatus("error");
    }
  }, [dateFrom, dateTo]);

  const r = result?.reconciliation;
  const diffAbs = r ? Math.abs(r.difference) : 0;
  const isMatch = r && diffAbs < 500;

  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">EBITDA Reconciliation Check</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Zoho P&amp;L net operating income (D&amp;A, interest &amp; tax excluded) minus salary supplement = Dashboard EBITDA
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={status === "loading"}
          className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {status === "loading" && (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          )}
          {status === "loading" ? "Running…" : "Run Check"}
        </button>
      </div>

      {status === "idle" && (
        <p className="text-sm text-muted-foreground">
          Click <strong>Run Check</strong> to verify dashboard numbers against Zoho Books live P&amp;L.
          Takes ~15 s (one Zoho API call).
        </p>
      )}

      {status === "error" && (
        <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{errMsg}</p>
      )}

      {status === "done" && result && r && (
        <>
        <div className="grid md:grid-cols-3 gap-6 mt-2">

          {/* Column 1 — Zoho P&L */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Zoho Books P&amp;L
            </p>
            <Row label="Revenue"          value={result.zoho.revenue} bold />
            <Row label="Operating Costs"  value={-result.zoho.costs}  indent />
            <Row label="Zoho EBITDA"      value={result.zoho.ebitda}  bold green={result.zoho.ebitda >= 0} red={result.zoho.ebitda < 0} />
            {result.zoho.below_ebitda.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground/60 mt-3 mb-1">Below EBITDA line (excluded)</p>
                {result.zoho.below_ebitda.map((b) => (
                  <Row key={b.label} label={b.label} value={-b.amount} indent sub="excl." />
                ))}
                <Row label="Total excluded" value={-result.zoho.below_total} bold />
              </>
            )}
          </div>

          {/* Column 2 — Salary Supplement */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Salary Supplement (SPA)
            </p>
            {Object.entries(result.salary_supplement.by_slug)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([slug, amt]) => (
                <Row key={slug} label={slug} value={-amt} indent />
              ))}
            <Row label="Total supplement" value={-result.salary_supplement.total} bold />
            <div className="mt-3 pt-2 border-t border-border">
              <Row label="Revenue gap (Cockpit − Zoho)" value={r.revenue_gap} sub="note" />
              <p className="text-xs text-muted-foreground/70 mt-1">
                Frontend uses Cockpit revenue; Zoho cost structure unchanged.
              </p>
            </div>
          </div>

          {/* Column 3 — Reconciliation */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Reconciliation
            </p>
            <Row label="Zoho EBITDA"         value={r.zoho_ebitda} />
            <Row label="+ Revenue gap"        value={r.revenue_gap} indent />
            <Row label="− Salary supplement"  value={-r.salary_supplement} indent />
            <Row label="Expected EBITDA"      value={r.expected_with_cockpit} bold />
            <Row label="Actual (frontend)"    value={r.frontend_ebitda}    bold />
            <div className="mt-3 pt-2 border-t border-border flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Difference</span>
              <span className={`text-sm font-bold ${isMatch ? "text-emerald-600" : "text-red-600"}`}>
                {fmt(r.difference)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold
                ${isMatch ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {isMatch ? "✓ Numbers reconcile" : `✗ Gap of ${fmt(r.difference)}`}
              </span>
            </div>
            {isMatch && diffAbs > 5 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Difference of {fmt(r.difference)} is within rounding / day-proration tolerance.
              </p>
            )}
          </div>

        </div>

        {result.gap_analysis && <GapAnalysisPanel gap={result.gap_analysis} />}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  SYNC STATUS BANNER                                                 */
/* ------------------------------------------------------------------ */

function SyncBanner({
  isSyncing,
  syncError,
  missingMonths,
  onForceSync,
}: {
  isSyncing: boolean;
  syncError: string | null;
  missingMonths: string[];
  onForceSync: () => void;
}) {
  if (!isSyncing && !syncError && missingMonths.length === 0) return null;

  if (isSyncing) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
        <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Fetching from Zoho Books for{" "}
        {missingMonths.length > 0 ? `${missingMonths.length} missing month(s)` : "this date range"}
        … this may take up to a minute.
      </div>
    );
  }

  if (syncError) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
        Zoho sync error: {syncError}{" "}
        <button className="underline ml-2" onClick={onForceSync}>Retry</button>
      </div>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  INNER COMPONENT                                                    */
/* ------------------------------------------------------------------ */

function SpaEBITDAContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { locations, isFetching, isSyncing, syncError, missingMonths, triggerSync } =
    useSpaEbitda(dateFrom, dateTo);

  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  /* ---- Consolidated totals ---- */
  const totals = useMemo((): SpaLocationData => {
    const zero: SpaLocationData = {
      id: 0, slug: "", name: "Total", color: "", lastSyncedAt: null,
      revenue: 0, cogs: 0, wages: 0, advertising: 0,
      rent: 0, utilities: 0, sga: 0, ebitda: 0,
    };
    for (const loc of locations) {
      zero.revenue     += loc.revenue;
      zero.cogs        += loc.cogs;
      zero.wages       += loc.wages;
      zero.advertising += loc.advertising;
      zero.rent        += loc.rent;
      zero.utilities   += loc.utilities;
      zero.sga         += loc.sga;
      zero.ebitda      += loc.ebitda;
    }
    return zero;
  }, [locations]);

  const margin = totals.revenue > 0
    ? Math.round((totals.ebitda / totals.revenue) * 100)
    : 0;

  const [rentExpanded, setRentExpanded] = useState(false);

  /* ---- KPI Cards ---- */
  const kpis: KPIData[] = useMemo(() => [
    { label: "Spa Total Revenue", value: formatCurrency(totals.revenue) },
    { label: "Spa Total EBITDA",  value: formatCurrency(totals.ebitda) },
    {
      label: "Spa EBITDA Margin", value: `${margin}%`,
      target: "40%", targetValue: 40, currentValue: margin,
    },
  ], [totals, margin]);

  /* ---- Chart data ---- */
  const breakdownData = useMemo(() =>
    locations.map((loc) => {
      const r = loc.revenue || 1;
      return {
        name:           loc.name,
        Wages:          loc.wages,
        Advertising:    loc.advertising,
        Rent:           loc.rent,
        Utilities:      loc.utilities,
        COGS:           loc.cogs,
        "SG&A":         loc.sga,
        EBITDA:         loc.ebitda,
        WagesPct:       pctOf(loc.wages,       r),
        AdvertisingPct: pctOf(loc.advertising, r),
        RentPct:        pctOf(loc.rent,        r),
        UtilitiesPct:   pctOf(loc.utilities,   r),
        COGSPct:        pctOf(loc.cogs,        r),
        "SG&APct":      pctOf(loc.sga,         r),
        EBITDAPct:      pctOf(loc.ebitda,      r),
      };
    }),
    [locations]
  );

  const isLoading = (isFetching || isSyncing) && locations.length === 0;

  return (
    <>
      {/* Title + sync controls */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Spa — EBITDA Deep Dive</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-location P&amp;L breakdown | {rangeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/finance/ebitda/spa/breakdown"
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors"
          >
            Account Breakdown →
          </Link>
          <SyncButton
            onSync={async () => { triggerSync(true); }}
            isExternalBusy={isSyncing}
            lastSynced={locations[0]?.lastSyncedAt ?? null}
          />
        </div>
      </div>

      {/* Sync status banner */}
      <SyncBanner
        isSyncing={isSyncing}
        syncError={syncError}
        missingMonths={missingMonths}
        onForceSync={() => triggerSync(true)}
      />

      {/* Loading skeleton */}
      {isLoading && (
        <Card className="p-6 flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-muted-foreground">
            Pulling data from Zoho Books — please wait…
          </p>
        </Card>
      )}

      {/* Main content — only shown once data is available */}
      {!isLoading && locations.length > 0 && (
        <>
          <KPICardRow kpis={kpis} />

          {/* P&L Table */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">P&amp;L by Location</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {locations.length} active locations · live Zoho Books data
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground sticky left-0 bg-background z-10 min-w-[140px]">
                      Line Item
                    </th>
                    {locations.map((loc) => (
                      <th key={loc.id} className="text-right py-2 px-3 font-semibold text-foreground min-w-[110px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: loc.color }} />
                          {loc.name}
                        </span>
                      </th>
                    ))}
                    <th className="text-right py-2 px-3 font-semibold text-foreground min-w-[110px] bg-muted/40 border-l border-border">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Net Revenue */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">Net Revenue</td>
                    {locations.map((loc) => (
                      <td key={loc.id} className="py-1.5 px-3 text-right font-bold text-foreground">
                        {fmtCurrencyShort(loc.revenue)}
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right font-bold text-foreground bg-muted/20 border-l border-border">
                      {fmtCurrencyShort(totals.revenue)}
                    </td>
                  </tr>
                  {/* Wages */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">Wages &amp; Salaries</td>
                    {locations.map((loc) => (
                      <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(loc.wages)}){" "}
                        <span className="text-muted-foreground">{fmtPct(pctOf(loc.wages, loc.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      ({fmtCurrencyShort(totals.wages)}){" "}
                      <span className="text-muted-foreground">{fmtPct(pctOf(totals.wages, totals.revenue))}</span>
                    </td>
                  </tr>
                  {/* Advertising */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">Advertising</td>
                    {locations.map((loc) => (
                      <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(loc.advertising)}){" "}
                        <span className="text-muted-foreground">{fmtPct(pctOf(loc.advertising, loc.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      ({fmtCurrencyShort(totals.advertising)}){" "}
                      <span className="text-muted-foreground">{fmtPct(pctOf(totals.advertising, totals.revenue))}</span>
                    </td>
                  </tr>
                  {/* Rent Plus (collapsible: Rent + Utilities) */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">
                      <button
                        type="button"
                        onClick={() => setRentExpanded((v) => !v)}
                        className="flex items-center gap-1.5 hover:text-foreground/70 transition-colors"
                        aria-expanded={rentExpanded}
                      >
                        {rentExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        <span>Rent Plus</span>
                      </button>
                    </td>
                    {locations.map((loc) => {
                      const sum = loc.rent + loc.utilities;
                      return (
                        <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                          ({fmtCurrencyShort(sum)}){" "}
                          <span className="text-muted-foreground">{fmtPct(pctOf(sum, loc.revenue))}</span>
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      {(() => {
                        const sum = totals.rent + totals.utilities;
                        return (
                          <>
                            ({fmtCurrencyShort(sum)}){" "}
                            <span className="text-muted-foreground">{fmtPct(pctOf(sum, totals.revenue))}</span>
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                  {rentExpanded && (
                    <>
                      <tr className="border-b border-border">
                        <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">Rent</td>
                        {locations.map((loc) => (
                          <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                            {loc.rent > 0
                              ? <>({fmtCurrencyShort(loc.rent)}){" "}<span className="text-muted-foreground">{fmtPct(pctOf(loc.rent, loc.revenue))}</span></>
                              : <span className="text-muted-foreground">&mdash;</span>
                            }
                          </td>
                        ))}
                        <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                          {totals.rent > 0
                            ? <>({fmtCurrencyShort(totals.rent)}){" "}<span className="text-muted-foreground">{fmtPct(pctOf(totals.rent, totals.revenue))}</span></>
                            : <span className="text-muted-foreground">&mdash;</span>
                          }
                        </td>
                      </tr>
                      <tr className="border-b border-border">
                        <td className="py-1.5 px-3 pl-9 text-muted-foreground sticky left-0 bg-background z-10">Utilities</td>
                        {locations.map((loc) => (
                          <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                            ({fmtCurrencyShort(loc.utilities)}){" "}
                            <span className="text-muted-foreground">{fmtPct(pctOf(loc.utilities, loc.revenue))}</span>
                          </td>
                        ))}
                        <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                          ({fmtCurrencyShort(totals.utilities)}){" "}
                          <span className="text-muted-foreground">{fmtPct(pctOf(totals.utilities, totals.revenue))}</span>
                        </td>
                      </tr>
                    </>
                  )}
                  {/* COGS */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">COGS</td>
                    {locations.map((loc) => (
                      <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(loc.cogs)}){" "}
                        <span className="text-muted-foreground">{fmtPct(pctOf(loc.cogs, loc.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      ({fmtCurrencyShort(totals.cogs)}){" "}
                      <span className="text-muted-foreground">{fmtPct(pctOf(totals.cogs, totals.revenue))}</span>
                    </td>
                  </tr>
                  {/* SG&A */}
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground sticky left-0 bg-background z-10">SG&amp;A</td>
                    {locations.map((loc) => (
                      <td key={loc.id} className="py-1.5 px-3 text-right text-foreground">
                        ({fmtCurrencyShort(loc.sga)}){" "}
                        <span className="text-muted-foreground">{fmtPct(pctOf(loc.sga, loc.revenue))}</span>
                      </td>
                    ))}
                    <td className="py-1.5 px-3 text-right text-foreground bg-muted/20 border-l border-border">
                      ({fmtCurrencyShort(totals.sga)}){" "}
                      <span className="text-muted-foreground">{fmtPct(pctOf(totals.sga, totals.revenue))}</span>
                    </td>
                  </tr>
                  {/* EBITDA */}
                  <tr className="border-t-2 border-border">
                    <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">EBITDA</td>
                    {locations.map((loc) => (
                      <td key={loc.id}
                        className={`py-1.5 px-3 text-right font-bold ${loc.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {fmtCurrencyShort(loc.ebitda)}
                      </td>
                    ))}
                    <td className={`py-1.5 px-3 text-right font-bold bg-muted/20 border-l border-border ${totals.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtCurrencyShort(totals.ebitda)}
                    </td>
                  </tr>
                  {/* EBITDA % */}
                  <tr>
                    <td className="py-1.5 px-3 font-bold text-foreground sticky left-0 bg-background z-10">EBITDA %</td>
                    {locations.map((loc) => {
                      const m = pctOf(loc.ebitda, loc.revenue);
                      const badge = m >= 50 ? "bg-emerald-100 text-emerald-800"
                        : m >= 30 ? "bg-amber-100 text-amber-800"
                        : "bg-red-100 text-red-800";
                      return (
                        <td key={loc.id} className="py-1.5 px-3 text-right">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
                            {fmtPct(m)}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-3 text-right bg-muted/20 border-l border-border">
                      {(() => {
                        const m = pctOf(totals.ebitda, totals.revenue);
                        const badge = m >= 50 ? "bg-emerald-100 text-emerald-800"
                          : m >= 30 ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-800";
                        return (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge}`}>
                            {fmtPct(m)}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Stacked bar chart */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Revenue Breakdown by Location</h2>
            <p className="text-sm text-muted-foreground mb-4">Cost structure per spa. Green = EBITDA margin.</p>
            <div className="h-[300px] md:h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={breakdownData} margin={{ top: 25, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" height={60} />
                  <YAxis tickFormatter={(v: number) => fmtCurrencyShort(v)} />
                  <Tooltip content={<BreakdownTooltip />} />
                  <Legend />
                  <Bar dataKey="Wages"       stackId="s" fill="#E5C088"><LabelList dataKey="WagesPct"       content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Advertising" stackId="s" fill="#E5B5D0"><LabelList dataKey="AdvertisingPct" content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Rent"        stackId="s" fill="#C5D0E0"><LabelList dataKey="RentPct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Utilities"   stackId="s" fill="#B5DCDC"><LabelList dataKey="UtilitiesPct"   content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="COGS"        stackId="s" fill="#E5B8B0"><LabelList dataKey="COGSPct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="SG&A"        stackId="s" fill="#D5C0E5"><LabelList dataKey="SG&APct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="EBITDA"      stackId="s" fill="#A8D4A8"><LabelList dataKey="EBITDAPct"      content={renderTopLabel}     /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {/* No data state (after sync completed but Zoho returned nothing) */}
      {!isLoading && !isSyncing && locations.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No Zoho data found for this date range.{" "}
          <button className="underline" onClick={() => triggerSync(true)}>Try syncing again</button>
        </Card>
      )}

      {/* Reconciliation check — always visible once page has data */}
      {!isLoading && locations.length > 0 && (
        <EbitdaReconciliation dateFrom={dateFrom} dateTo={dateTo} />
      )}

    </>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function SpaEBITDAPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <SpaEBITDAContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
