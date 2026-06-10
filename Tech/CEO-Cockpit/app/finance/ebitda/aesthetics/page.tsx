"use client";

import { useMemo, useState, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Card } from "@/components/ui/card";
import { CIChat } from "@/components/ci/CIChat";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import {
  useAestheticsEbitda,
  AestheticsDeptData,
} from "@/lib/hooks/useAestheticsEbitda";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LabelList,
} from "recharts";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function pctOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }

function fmtShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `€${(value / 1_000).toFixed(1)}K`;
  return `€${value.toFixed(1)}`;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Custom Tooltip                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

interface TPayload { name: string; value: number; color: string; dataKey: string; }

function BreakdownTooltip({ active, payload, label }: { active?: boolean; payload?: TPayload[]; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-md text-sm">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((e) => (
        <div key={e.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: e.color }} />
          <span className="text-foreground">{e.name}:</span>
          <span className="font-semibold">{formatCurrency(e.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Chart label renderers                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sync Banner                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function SyncBanner({
  isSyncing, syncError, missingMonths, onForceSync,
}: {
  isSyncing: boolean; syncError: string | null;
  missingMonths: string[]; onForceSync: () => void;
}) {
  if (!isSyncing && !syncError && missingMonths.length === 0) return null;
  if (isSyncing) return (
    <div className="flex items-center gap-2 rounded-md bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-700">
      <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      Fetching from Zoho Books for{" "}
      {missingMonths.length > 0 ? `${missingMonths.length} missing month(s)` : "this date range"}
      … this may take up to a minute.
    </div>
  );
  if (syncError) return (
    <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
      Zoho sync error: {syncError}{" "}
      <button className="underline ml-2" onClick={onForceSync}>Retry</button>
    </div>
  );
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  EBITDA Reconciliation Check                                               */
/* ────────────────────────────────────────────────────────────────────────── */

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
interface IncomeAccount {
  code: string; name: string; amount: number; dept?: string;
  ebitda_line: string | null; split_rule: string; in_coa_map: boolean; included: boolean;
}
interface CheckResult {
  period: { date_from: string; date_to: string };
  zoho: { total_income: number; zoho_ebitda: number; coa_income: number; costs: number; coa_ebitda: number; below_ebitda: BelowItem[]; below_total: number; income_accounts?: IncomeAccount[] };
  sales_daily: { aesthetics: number; slimming: number; total: number };
  db_totals: {
    aesthetics: { coa_revenue: number; sales_revenue: number; revenue: number; costs: number; ebitda: number };
    slimming:   { coa_revenue: number; sales_revenue: number; revenue: number; costs: number; ebitda: number };
  };
  reconciliation: {
    zoho_coa_income:   number;
    zoho_costs:        number;
    zoho_coa_ebitda:   number;
    sales_daily_total: number;
    expected_ebitda:   number;
    frontend_ebitda:   number;
    difference:        number;
    status:            "ok" | "mismatch";
  };
  gap_analysis: GapAnalysis;
}

function fmtRec(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? `€${(abs / 1_000_000).toFixed(1)}M`
          : abs >= 1_000     ? `€${(abs / 1_000).toFixed(1)}K`
          : `€${abs.toFixed(1)}`;
  return v < 0 ? `(${s})` : s;
}

function RecRow({ label, value, bold, indent, green, red, sub }: {
  label: string; value: string | number; bold?: boolean; indent?: boolean;
  green?: boolean; red?: boolean; sub?: string;
}) {
  const vcls = green ? "text-emerald-600 font-semibold"
             : red   ? "text-red-600 font-semibold"
             : bold  ? "font-semibold text-foreground"
             : "text-foreground";
  return (
    <div className={`flex items-start justify-between py-1 ${indent ? "pl-4" : ""} text-sm border-b border-border/40 last:border-0`}>
      <span className={`text-muted-foreground ${bold ? "font-semibold" : "font-normal"}`}>
        {label}{sub && <span className="ml-1 text-xs text-muted-foreground/60">{sub}</span>}
      </span>
      <span className={vcls}>{typeof value === "number" ? fmtRec(value) : value}</span>
    </div>
  );
}

const GAP_CATEGORIES = [
  { key: "excluded_expenses"   as const, label: "Excluded in Settings",      totalKey: "excluded_total"      as const, color: "text-amber-700",  desc: "Accounts mapped in Zoho CoA but marked as excluded — not pulled into any EBITDA line" },
  { key: "not_linked_expenses" as const, label: "Unlinked (No EBITDA Line)", totalKey: "not_linked_total"    as const, color: "text-orange-700", desc: "In CoA mapping but with no EBITDA line assigned — cost falls through to default" },
  { key: "not_in_db_expenses"  as const, label: "Not in CoA Mapping",        totalKey: "not_in_db_total"     as const, color: "text-red-700",    desc: "Account not found in CoA mapping at all — ETL used name-based default grouping" },
  { key: "below_ebitda"        as const, label: "Below EBITDA Line",         totalKey: "below_ebitda_total"  as const, color: "text-slate-600",  desc: "D&A, interest and tax items correctly excluded from EBITDA (below the line)" },
];

function GapTable({ items, total }: { items: GapItem[]; total?: number }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground py-2 pl-1">None for this period.</p>;
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
            <td className="py-1 px-1 text-right font-medium">{fmtRec(item.amount)}</td>
          </tr>
        ))}
      </tbody>
      {total !== undefined && items.length > 1 && (
        <tfoot>
          <tr className="border-t border-border">
            <td colSpan={2} className="py-1 px-1 font-semibold">Total</td>
            <td className="py-1 px-1 text-right font-semibold">{fmtRec(total)}</td>
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
  const hasAnyExpense = GAP_CATEGORIES.some(c => gap[c.key].length > 0);

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h3 className="text-sm font-semibold text-foreground mb-1">Account Gap Analysis</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Accounts with activity in Zoho that are excluded or unlinked, plus income accounts mapped in settings but absent from Zoho this period.
      </p>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Expenses</p>
      {!hasAnyExpense && <p className="text-xs text-emerald-600 mb-4">No gaps — all expense accounts are mapped and linked.</p>}
      <div className="space-y-1">
        {GAP_CATEGORIES.map(cat => {
          const items = gap[cat.key];
          const total = gap.totals[cat.totalKey];
          const isOpen = open.has(cat.key);
          return (
            <div key={cat.key} className="rounded-md border border-border overflow-hidden">
              <button onClick={() => toggle(cat.key)}
                className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors">
                <span className="flex items-center gap-2 text-sm">
                  <span className={`font-medium ${cat.color}`}>{cat.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {items.length === 0 ? "— none"
                      : `${items.length} account${items.length !== 1 ? "s" : ""}${total ? ` · ${fmtRec(total)}` : ""}`}
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
                  <GapTable items={items} total={total} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-4 mb-2">Income</p>
      <div className="rounded-md border border-border overflow-hidden">
        <button onClick={() => toggle("income_mapped_missing")}
          className="w-full flex items-center justify-between px-3 py-2 text-left bg-muted/30 hover:bg-muted/50 transition-colors">
          <span className="flex items-center gap-2 text-sm">
            <span className="font-medium text-blue-700">Mapped as Revenue — No Zoho Figure</span>
            <span className="text-muted-foreground text-xs">
              {gap.income_mapped_missing.length === 0 ? "— none"
                : `${gap.income_mapped_missing.length} account${gap.income_mapped_missing.length !== 1 ? "s" : ""}`}
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
            <GapTable items={gap.income_mapped_missing} />
          </div>
        )}
      </div>
    </div>
  );
}

function EbitdaReconciliation({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

  const runCheck = useCallback(async () => {
    setStatus("loading");
    setResult(null);
    setErrMsg("");
    try {
      const res = await fetch("/api/ebitda/zoho-check-aesthetics", {
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
            Zoho P&amp;L net operating income (D&amp;A, interest &amp; tax excluded) vs dashboard EBITDA.
            Revenue overridden by booking system (ex-VAT).
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

            {/* Column 1 — Zoho P&L (raw, all income) */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Zoho Books P&amp;L (All Income)
              </p>
              <RecRow label="Total Revenue"    value={result.zoho.total_income} bold />
              <RecRow label="Operating Costs"  value={-result.zoho.costs}       indent />
              <RecRow label="Zoho EBITDA"      value={result.zoho.zoho_ebitda}  bold
                green={result.zoho.zoho_ebitda >= 0} red={result.zoho.zoho_ebitda < 0} />
              {result.zoho.below_ebitda.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground/60 mt-3 mb-1">Below EBITDA line (excluded)</p>
                  {result.zoho.below_ebitda.map(b => (
                    <RecRow key={b.label} label={b.label} value={-b.amount} indent sub="excl." />
                  ))}
                  <RecRow label="Total excluded" value={-result.zoho.below_total} bold />
                </>
              )}
            </div>

            {/* Column 2 — Sales Daily */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Booking System (Sales Module)
              </p>
              <RecRow label="Aesthetics sales" value={result.sales_daily.aesthetics} indent />
              <RecRow label="Slimming sales"   value={result.sales_daily.slimming}   indent />
              <RecRow label="Total sales"      value={result.sales_daily.total}      bold />
              <div className="mt-3 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground/60 mb-1">DB breakdown</p>
                <RecRow label="Aesthetics" value={result.db_totals.aesthetics?.ebitda ?? 0} indent
                  green={(result.db_totals.aesthetics?.ebitda ?? 0) >= 0} />
                <RecRow label="Slimming"   value={result.db_totals.slimming?.ebitda   ?? 0} indent
                  green={(result.db_totals.slimming?.ebitda ?? 0) >= 0} />
              </div>
            </div>

            {/* Column 3 — Reconciliation */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Reconciliation
              </p>
              <RecRow label="CoA income (Zoho)"  value={r.zoho_coa_income} />
              <RecRow label="Sales daily"         value={r.sales_daily_total} indent />
              <RecRow label="− Costs (Zoho)"      value={-r.zoho_costs}       indent />
              <RecRow label="Expected EBITDA"     value={r.expected_ebitda}   bold
                green={r.expected_ebitda >= 0} red={r.expected_ebitda < 0} />
              <div className="mt-2 pt-1 border-t border-border/60">
                <RecRow label="Actual (frontend)" value={r.frontend_ebitda} bold
                  green={r.frontend_ebitda >= 0} red={r.frontend_ebitda < 0} />
              </div>
              <div className="mt-3 pt-2 border-t border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Difference</span>
                <span className={`text-sm font-bold ${isMatch ? "text-emerald-600" : "text-red-600"}`}>
                  {fmtRec(r.difference)}
                </span>
              </div>
              <div className="mt-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold
                  ${isMatch ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {isMatch ? "✓ Numbers reconcile" : `✗ Gap of ${fmtRec(r.difference)}`}
                </span>
              </div>
            </div>

          </div>

          {result.zoho.income_accounts && result.zoho.income_accounts.length > 0 && (
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground mb-1">Zoho Income Accounts (this period)</h3>
              <p className="text-xs text-muted-foreground mb-3">
                All income accounts from Zoho Books P&amp;L for this org. Department is inferred from the account name — accounts containing &ldquo;Slimming&rdquo; map to Slimming; all others map to Aesthetics. &ldquo;In CoA&rdquo; means the account is explicitly mapped in Settings → CoA; only those marked as revenue there flow into the dashboard EBITDA.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="text-left py-1 px-1 text-muted-foreground font-medium w-20">Code</th>
                      <th className="text-left py-1 px-1 text-muted-foreground font-medium">Account Name</th>
                      <th className="text-left py-1 px-1 text-muted-foreground font-medium w-24">Dept</th>
                      <th className="text-right py-1 px-1 text-muted-foreground font-medium w-24">Amount</th>
                      <th className="text-left py-1 px-2 text-muted-foreground font-medium w-36">CoA Rule</th>
                      <th className="text-center py-1 px-1 text-muted-foreground font-medium w-16">In CoA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.zoho.income_accounts.map((acc, i) => (
                      <tr key={i} className={`border-b border-border/30 last:border-0 ${acc.dept === "slimming" ? "bg-blue-50/50" : ""}`}>
                        <td className="py-1 px-1 text-muted-foreground font-mono">{acc.code}</td>
                        <td className="py-1 px-1 font-medium text-foreground">{acc.name}</td>
                        <td className="py-1 px-1">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium
                            ${acc.dept === "slimming" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                            {acc.dept === "slimming" ? "Slimming" : "Aesthetics"}
                          </span>
                        </td>
                        <td className="py-1 px-1 text-right font-medium">{fmtRec(acc.amount)}</td>
                        <td className="py-1 px-2 text-muted-foreground">{acc.split_rule}</td>
                        <td className="py-1 px-1 text-center">
                          {acc.in_coa_map
                            ? <span className="text-emerald-600 font-semibold">✓</span>
                            : <span className="text-amber-600 font-semibold">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td colSpan={3} className="py-1 px-1">Total</td>
                      <td className="py-1 px-1 text-right">{fmtRec(result.zoho.income_accounts.reduce((s, a) => s + a.amount, 0))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {result.gap_analysis && <GapAnalysisPanel gap={result.gap_analysis} />}
        </>
      )}
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Empty zero dept (used while data loads)                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const ZERO_DEPT: AestheticsDeptData = {
  dept: "aesthetics", name: "Aesthetics", color: "#DEEBEB",
  revenue: 0, salesRevenue: 0, zohoRevenue: 0, otherIncome: 0,
  cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0,
  ebitda: 0, lastSyncedAt: null,
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main content                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

function AestheticsEBITDAContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const {
    depts, revenueBreakdown,
    isFetching, isSyncing, syncError, missingMonths, triggerSync,
  } = useAestheticsEbitda(dateFrom, dateTo);

  const rangeLabel = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  /* ── Sync from Sales Sheet ── */
  const [sheetSyncing, setSheetSyncing] = useState<boolean>(false);
  const [sheetResult,  setSheetResult]  = useState<{ rows: number; tabs: string[] } | null>(null);
  const [sheetError,   setSheetError]   = useState<string | null>(null);

  const syncFromSheet = useCallback(async () => {
    setSheetSyncing(true);
    setSheetResult(null);
    setSheetError(null);
    try {
      const fromStr = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(dateTo.getFullYear(), dateTo.getMonth() + 1, 0).getDate();
      const toStr   = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch("/api/etl/aesthetics-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: fromStr, date_to: toStr }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setSheetResult({ rows: json.rows_inserted ?? 0, tabs: json.tabs ?? [] });
      triggerSync(true);
    } catch (e) {
      setSheetError(String(e));
    } finally {
      setSheetSyncing(false);
    }
  }, [dateFrom, dateTo, triggerSync]);

  /* ── Aesthetics dept only ── */
  const dept = useMemo(
    () => depts.find(d => d.dept === "aesthetics") ?? ZERO_DEPT,
    [depts],
  );

  const margin = dept.revenue > 0
    ? Math.round((dept.ebitda / dept.revenue) * 1000) / 10
    : 0;

  /* ── KPIs ── */
  const kpis: KPIData[] = useMemo(() => [
    { label: "Net Revenue (ex-VAT)", value: formatCurrency(dept.revenue) },
    { label: "Total EBITDA",         value: formatCurrency(dept.ebitda) },
    {
      label: "EBITDA Margin", value: `${margin.toFixed(1)}%`,
      target: "30%", targetValue: 30, currentValue: margin,
    },
  ], [dept, margin]);

  /* ── Chart data ── */
  const chartData = useMemo(() => {
    const r = dept.revenue || 1;
    return [{
      name:           "Aesthetics",
      Wages:          dept.wages,
      Advertising:    dept.advertising,
      Rent:           dept.rent,
      Utilities:      dept.utilities,
      COGS:           dept.cogs,
      "SG&A":         dept.sga,
      EBITDA:         dept.ebitda,
      WagesPct:       pctOf(dept.wages,       r),
      AdvertisingPct: pctOf(dept.advertising, r),
      RentPct:        pctOf(dept.rent,        r),
      UtilitiesPct:   pctOf(dept.utilities,   r),
      COGSPct:        pctOf(dept.cogs,        r),
      "SG&APct":      pctOf(dept.sga,         r),
      EBITDAPct:      pctOf(dept.ebitda,      r),
    }];
  }, [dept]);

  /* ── Revenue breakdown filtered to aesthetics only ── */
  const aesthBreakdown = useMemo(
    () => revenueBreakdown
      .map(r => ({ name: r.name, amount: r.aesthetics, total: dept.revenue, isOther: r.isOther }))
      .filter(r => r.amount > 0),
    [revenueBreakdown, dept.revenue],
  );

  const isLoading = (isFetching || isSyncing) && dept.revenue === 0 && dept.ebitda === 0;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Aesthetics — EBITDA Deep Dive</h1>
          <p className="text-sm text-muted-foreground mt-1">
            P&amp;L summary · {rangeLabel} · all figures ex-VAT
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={syncFromSheet}
            disabled={sheetSyncing || isSyncing}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {sheetSyncing && (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            )}
            {sheetSyncing ? "Syncing Sheet…" : "Sync from Sales Sheet"}
          </button>
          <button
            onClick={() => triggerSync(true)}
            disabled={isSyncing || sheetSyncing}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {isSyncing ? "Syncing…" : "Re-Sync from Zoho"}
          </button>
        </div>
      </div>

      {sheetResult && (
        <div className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800">
          <span>Sales sheet synced — <strong>{sheetResult.rows} rows</strong> loaded for this period.</span>
          <button onClick={() => setSheetResult(null)} className="text-emerald-600 hover:text-emerald-800 ml-4 text-xs">✕</button>
        </div>
      )}
      {sheetError && (
        <div className="flex items-center justify-between rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          <span>Sheet sync error: {sheetError}</span>
          <button onClick={() => setSheetError(null)} className="text-red-500 hover:text-red-700 ml-4 text-xs">✕</button>
        </div>
      )}

      <SyncBanner
        isSyncing={isSyncing} syncError={syncError}
        missingMonths={missingMonths} onForceSync={() => triggerSync(true)}
      />

      {/* Loading */}
      {isLoading && (
        <Card className="p-6 flex items-center justify-center min-h-[200px]">
          <p className="text-sm text-muted-foreground">Pulling data from Zoho Books — please wait…</p>
        </Card>
      )}

      {!isLoading && (
        <>
          <KPICardRow kpis={kpis} />

          {/* ── Revenue Breakdown ── */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Net Revenue Breakdown</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Revenue by service / product (ex-VAT) · source: booking system + Zoho
            </p>

            {aesthBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sales data found for this period.{" "}
                {dept.zohoRevenue > 0 && (
                  <span>Zoho revenue is present — sync the Google Sheets sales data to see breakdown.</span>
                )}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Service / Product</th>
                      <th className="text-right py-2 px-3 font-semibold text-foreground">Amount (ex-VAT)</th>
                      <th className="text-right py-2 px-3 font-semibold text-muted-foreground">% of Rev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aesthBreakdown.map((row) => (
                      <tr key={row.name}
                        className={`border-b border-border/50 ${row.isOther ? "text-muted-foreground" : ""}`}>
                        <td className="py-1.5 px-3">{row.name}</td>
                        <td className="py-1.5 px-3 text-right font-medium">{fmtShort(row.amount)}</td>
                        <td className="py-1.5 px-3 text-right text-muted-foreground">
                          {fmtPct(pctOf(row.amount, dept.revenue))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td className="py-2 px-3 font-bold text-foreground">Net Revenue</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">{fmtShort(dept.revenue)}</td>
                      <td className="py-2 px-3 text-right font-bold text-foreground">100%</td>
                    </tr>
                    {dept.otherIncome > 0 && (
                      <tr>
                        <td colSpan={3} className="py-1.5 px-3 text-xs text-muted-foreground italic">
                          ℹ Includes other Zoho income ({fmtShort(dept.otherIncome)}) not in booking system — e.g. grants, interest, corporate sales.
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* ── P&L Summary ── */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">P&amp;L Summary</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Costs from Zoho Books · revenue from booking system (ex-VAT)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold text-muted-foreground">Line Item</th>
                    <th className="text-right py-2 px-3 font-semibold text-foreground">Amount</th>
                    <th className="text-right py-2 px-3 font-semibold text-muted-foreground">% of Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 font-bold text-foreground">Net Revenue</td>
                    <td className="py-1.5 px-3 text-right font-bold text-foreground">{fmtShort(dept.revenue)}</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">100%</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">Wages &amp; Salaries</td>
                    <td className="py-1.5 px-3 text-right">({fmtShort(dept.wages)})</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">{fmtPct(pctOf(dept.wages, dept.revenue))}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">COGS</td>
                    <td className="py-1.5 px-3 text-right">({fmtShort(dept.cogs)})</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">{fmtPct(pctOf(dept.cogs, dept.revenue))}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">Rent</td>
                    <td className="py-1.5 px-3 text-right">
                      {dept.rent > 0 ? `(${fmtShort(dept.rent)})` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">
                      {dept.rent > 0 ? fmtPct(pctOf(dept.rent, dept.revenue)) : ""}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">Advertising &amp; Marketing</td>
                    <td className="py-1.5 px-3 text-right">
                      {dept.advertising > 0 ? `(${fmtShort(dept.advertising)})` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">
                      {dept.advertising > 0 ? fmtPct(pctOf(dept.advertising, dept.revenue)) : ""}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">Utilities</td>
                    <td className="py-1.5 px-3 text-right">
                      {dept.utilities > 0 ? `(${fmtShort(dept.utilities)})` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">
                      {dept.utilities > 0 ? fmtPct(pctOf(dept.utilities, dept.revenue)) : ""}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-3 text-foreground">SG&amp;A</td>
                    <td className="py-1.5 px-3 text-right">({fmtShort(dept.sga)})</td>
                    <td className="py-1.5 px-3 text-right text-muted-foreground">{fmtPct(pctOf(dept.sga, dept.revenue))}</td>
                  </tr>
                  <tr className="border-t-2 border-border">
                    <td className="py-2 px-3 font-bold text-foreground">EBITDA</td>
                    <td className={`py-2 px-3 text-right font-bold ${dept.ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtShort(dept.ebitda)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {(() => {
                        const m = pctOf(dept.ebitda, dept.revenue);
                        const badge = m >= 40 ? "bg-emerald-100 text-emerald-800"
                          : m >= 25 ? "bg-amber-100 text-amber-800"
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

          {/* ── Cost structure chart ── */}
          <Card className="p-3 md:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-1">Cost Structure</h2>
            <p className="text-sm text-muted-foreground mb-4">Cost breakdown as % of revenue. Green = EBITDA margin.</p>
            <div className="h-[280px] md:h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 25, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v: number) => fmtShort(v)} />
                  <Tooltip content={<BreakdownTooltip />} />
                  <Bar dataKey="Wages"       stackId="s" fill="#F59E0B" name="Wages"><LabelList dataKey="WagesPct"       content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Advertising" stackId="s" fill="#EC4899" name="Advertising"><LabelList dataKey="AdvertisingPct" content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Rent"        stackId="s" fill="#9CA3AF" name="Rent"><LabelList dataKey="RentPct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="Utilities"   stackId="s" fill="#06B6D4" name="Utilities"><LabelList dataKey="UtilitiesPct"   content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="COGS"        stackId="s" fill="#3B82F6" name="COGS"><LabelList dataKey="COGSPct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="SG&A"        stackId="s" fill="#8B5CF6" name="SG&A"><LabelList dataKey="SG&APct"        content={renderSegmentLabel} /></Bar>
                  <Bar dataKey="EBITDA"      stackId="s" fill="#22C55E" name="EBITDA"><LabelList dataKey="EBITDAPct"      content={renderTopLabel}     /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* No data after sync */}
          {!isSyncing && dept.revenue === 0 && dept.ebitda === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No Zoho data found for this date range.{" "}
              <button className="underline" onClick={() => triggerSync(true)}>Try syncing again</button>
            </Card>
          )}
        </>
      )}

      {/* Reconciliation check — always visible once page has loaded */}
      {!isLoading && (
        <EbitdaReconciliation dateFrom={dateFrom} dateTo={dateTo} />
      )}

      <CIChat />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export default function AestheticsEBITDAPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <AestheticsEBITDAContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
