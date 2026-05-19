"use client";

import { useState, useMemo, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, RefreshCw, Tag, SplitSquareHorizontal, Sheet } from "lucide-react";
import type { ZohoSpaBreakdownResult, AccountRow, TagOption } from "@/lib/etl/zoho-spa-breakdown";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function fmt(v: number): string {
  if (v === 0) return "—";
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${Math.round(v / 1_000)}K`;
  return `€${Math.round(v)}`;
}

function fmtFull(v: number): string {
  if (v === 0) return "€0";
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LINE_LABELS: Record<string, string> = {
  revenue:     "Revenue",
  cogs:        "COGS",
  wages:       "Wages & Salaries",
  advertising: "Advertising",
  rent:        "Rent",
  utilities:   "Utilities",
  sga:         "SG&A",
};

const LINE_COLORS: Record<string, string> = {
  revenue:     "bg-emerald-50 text-emerald-800",
  cogs:        "bg-blue-50 text-blue-800",
  wages:       "bg-amber-50 text-amber-800",
  advertising: "bg-pink-50 text-pink-800",
  rent:        "bg-slate-50 text-slate-700",
  utilities:   "bg-cyan-50 text-cyan-800",
  sga:         "bg-purple-50 text-purple-800",
};

/* ------------------------------------------------------------------ */
/*  Pivot table                                                         */
/* ------------------------------------------------------------------ */

function PivotTable({
  result,
  showRevenue,
}: {
  result: ZohoSpaBreakdownResult;
  showRevenue: boolean;
}) {
  const { tag_options, venue_slugs, accounts } = result;

  // Group accounts by EBITDA line
  const grouped = useMemo(() => {
    const map = new Map<string, AccountRow[]>();
    for (const acc of accounts) {
      if (!showRevenue && acc.ebitda_line === "revenue") continue;
      if (!map.has(acc.ebitda_line)) map.set(acc.ebitda_line, []);
      map.get(acc.ebitda_line)!.push(acc);
    }
    const ORDER = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"];
    return ORDER.filter(l => map.has(l)).map(l => ({ line: l, rows: map.get(l)! }));
  }, [accounts, showRevenue]);

  // Compute per-venue totals per EBITDA line
  const lineTotals = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const { line, rows } of grouped) {
      result[line] = {};
      for (const slug of venue_slugs) {
        result[line][slug] = rows.reduce((s, r) => s + (r.venue_amounts[slug] ?? 0), 0);
      }
      result[line]["__total"] = rows.reduce((s, r) => s + r.total, 0);
    }
    return result;
  }, [grouped, venue_slugs]);

  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set(["cogs", "wages", "sga"]));

  const toggle = (line: string) => setExpandedLines(prev => {
    const next = new Set(prev);
    next.has(line) ? next.delete(line) : next.add(line);
    return next;
  });

  const displayedVenues = tag_options;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap border-separate border-spacing-0">
        <thead>
          <tr>
            {/* Left columns */}
            <th className="sticky left-0 z-20 bg-background text-left py-2 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border min-w-[220px]">
              Account
            </th>
            <th className="sticky left-[220px] z-20 bg-background text-left py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border min-w-[80px]">
              Code
            </th>
            <th className="sticky left-[300px] z-20 bg-background text-left py-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border min-w-[110px]">
              Split Rule
            </th>
            {/* Venue columns */}
            {displayedVenues.map(v => (
              <th key={v.slug} className="text-right py-2 px-2 font-semibold text-foreground border-b border-border min-w-[90px]">
                {v.display_name}
              </th>
            ))}
            {/* Total */}
            <th className="text-right py-2 px-2 font-bold text-foreground border-b border-border bg-slate-50 min-w-[90px] border-l border-border">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {grouped.map(({ line, rows }) => {
            const isExpanded = expandedLines.has(line);
            const totRow = lineTotals[line] ?? {};

            return [
              /* Section header row */
              <tr key={`hdr-${line}`} className="bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer" onClick={() => toggle(line)}>
                <td className="sticky left-0 z-10 bg-muted/40 py-2 px-3 font-semibold text-foreground border-b border-border">
                  <span className="flex items-center gap-1.5">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${LINE_COLORS[line] ?? "bg-slate-100 text-slate-700"}`}>
                      {LINE_LABELS[line] ?? line}
                    </span>
                    <span className="text-muted-foreground font-normal text-[10px]">{rows.length} accounts</span>
                  </span>
                </td>
                <td className="sticky left-[220px] z-10 bg-muted/40 py-2 px-2 border-b border-border" />
                <td className="sticky left-[300px] z-10 bg-muted/40 py-2 px-2 border-b border-border" />
                {displayedVenues.map(v => (
                  <td key={v.slug} className="py-2 px-2 text-right font-semibold text-foreground tabular-nums border-b border-border">
                    {fmt(totRow[v.slug] ?? 0)}
                  </td>
                ))}
                <td className="py-2 px-2 text-right font-bold text-foreground tabular-nums bg-slate-50 border-l border-border border-b border-border">
                  {fmt(totRow["__total"] ?? 0)}
                </td>
              </tr>,

              /* Account detail rows */
              ...(isExpanded ? rows.map(acc => {
                const isTagged = acc.tagged_total > 0;
                const isPartiallyTagged = isTagged && acc.untagged_amount > 0;
                return (
                  <tr key={acc.code || acc.name} className="group hover:bg-muted/20 transition-colors">
                    <td className="sticky left-0 z-10 bg-background group-hover:bg-muted/20 py-1.5 px-3 text-foreground border-b border-border/50 transition-colors">
                      <span className="flex items-center gap-1.5">
                        {isTagged && (
                          <span title={isPartiallyTagged ? "Partially tagged in Zoho" : "Tagged in Zoho"}>
                            <Tag className={`h-3 w-3 shrink-0 ${isPartiallyTagged ? "text-amber-500" : "text-emerald-500"}`} />
                          </span>
                        )}
                        {!isTagged && (
                          <span title="Distributed by split rule">
                            <SplitSquareHorizontal className="h-3 w-3 shrink-0 text-slate-400" />
                          </span>
                        )}
                        <span className="truncate max-w-[180px]" title={acc.name}>{acc.name}</span>
                      </span>
                    </td>
                    <td className="sticky left-[220px] z-10 bg-background group-hover:bg-muted/20 py-1.5 px-2 text-muted-foreground font-mono border-b border-border/50 transition-colors">
                      {acc.code}
                    </td>
                    <td className="sticky left-[300px] z-10 bg-background group-hover:bg-muted/20 py-1.5 px-2 text-muted-foreground border-b border-border/50 transition-colors">
                      <span className="truncate max-w-[100px] block" title={acc.split_rule}>{acc.split_rule}</span>
                    </td>
                    {displayedVenues.map(v => {
                      const amt = acc.venue_amounts[v.slug] ?? 0;
                      return (
                        <td key={v.slug} className="py-1.5 px-2 text-right tabular-nums border-b border-border/50 text-foreground" title={fmtFull(amt)}>
                          {amt === 0 ? <span className="text-muted-foreground/40">—</span> : fmt(amt)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2 text-right font-medium text-foreground tabular-nums bg-slate-50/60 border-l border-border border-b border-border/50" title={fmtFull(acc.total)}>
                      {fmt(acc.total)}
                    </td>
                  </tr>
                );
              }) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Tag className="h-3 w-3 text-emerald-500" />
        Tagged directly in Zoho (full)
      </span>
      <span className="flex items-center gap-1.5">
        <Tag className="h-3 w-3 text-amber-500" />
        Partially tagged — remainder via split rule
      </span>
      <span className="flex items-center gap-1.5">
        <SplitSquareHorizontal className="h-3 w-3 text-slate-400" />
        Distributed by COA split rule (no Zoho tag)
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Summary bar                                                         */
/* ------------------------------------------------------------------ */

function SummaryBar({ result }: { result: ZohoSpaBreakdownResult }) {
  const { tag_options, venue_slugs, accounts } = result;
  const taggedCount   = accounts.filter(a => a.tagged_total > 0).length;
  const untaggedCount = accounts.filter(a => a.tagged_total === 0).length;
  const totalTaggedAmt   = accounts.reduce((s, a) => s + a.tagged_total, 0);
  const totalUntaggedAmt = accounts.reduce((s, a) => s + a.untagged_amount, 0);
  const totalAmt = totalTaggedAmt + totalUntaggedAmt;
  const taggedPct = totalAmt > 0 ? Math.round((totalTaggedAmt / totalAmt) * 100) : 0;

  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5">
        <span className="font-medium text-foreground">{result.tag_options.length}</span>
        <span className="text-muted-foreground">venue tags discovered</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5">
        <span className="font-medium text-foreground">{accounts.length}</span>
        <span className="text-muted-foreground">accounts</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5">
        <Tag className="h-3 w-3 text-emerald-600" />
        <span className="font-medium text-emerald-700">{taggedPct}% tagged directly in Zoho</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">
        <SplitSquareHorizontal className="h-3 w-3 text-slate-500" />
        <span className="text-slate-600">{100 - taggedPct}% distributed via split rules</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner component                                                     */
/* ------------------------------------------------------------------ */

function BreakdownContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [status,       setStatus]      = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result,       setResult]      = useState<ZohoSpaBreakdownResult | null>(null);
  const [errorMsg,     setErrorMsg]    = useState("");
  const [showRevenue,  setShowRevenue] = useState(false);
  const [logOpen,      setLogOpen]     = useState(false);
  const [pushStatus,   setPushStatus]  = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [pushMsg,      setPushMsg]     = useState("");

  const pushToSheets = useCallback(async (from: Date, to: Date) => {
    setPushStatus("pushing");
    setPushMsg("");
    try {
      const fromStr = toDateStr(new Date(from.getFullYear(), from.getMonth(), 1));
      const toStr   = toDateStr(new Date(to.getFullYear(), to.getMonth() + 1, 0));
      const resp    = await window.fetch("/api/finance/zoho-spa-breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: fromStr, date_to: toStr }),
      });
      const json = await resp.json();
      if (!resp.ok) { setPushMsg(json.error ?? "Push failed"); setPushStatus("error"); return; }
      setPushMsg(`Done — ${json.rows_written} rows written to "EBITDA Zoho data" sheet.`);
      setPushStatus("done");
    } catch (e) {
      setPushMsg(String(e));
      setPushStatus("error");
    }
  }, []);

  const fetch = useCallback(async (from: Date, to: Date) => {
    setStatus("loading");
    setResult(null);
    setErrorMsg("");
    try {
      const fromStr = toDateStr(new Date(from.getFullYear(), from.getMonth(), 1));
      const toStr   = toDateStr(new Date(to.getFullYear(), to.getMonth() + 1, 0));
      const resp    = await window.fetch(
        `/api/finance/zoho-spa-breakdown?date_from=${fromStr}&date_to=${toStr}`,
      );
      const json = await resp.json();
      if (!resp.ok) { setErrorMsg(json.error ?? "Request failed"); setStatus("error"); return; }
      setResult(json as ZohoSpaBreakdownResult);
      setStatus("done");
    } catch (e) {
      setErrorMsg(String(e));
      setStatus("error");
    }
  }, []);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Zoho SPA — Account Breakdown</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All non-excluded accounts split by Zoho venue tags, with COA split rules for untagged amounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => pushToSheets(dateFrom, dateTo)}
            disabled={pushStatus === "pushing"}
            className="inline-flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            title="Fetch from Zoho and write directly to the 'EBITDA Zoho data' Google Sheet"
          >
            <Sheet className={`h-4 w-4 ${pushStatus === "pushing" ? "animate-pulse" : ""}`} />
            {pushStatus === "pushing" ? "Pushing to Sheets…" : "Push to Google Sheets"}
          </button>
          <button
            onClick={() => fetch(dateFrom, dateTo)}
            disabled={status === "loading"}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${status === "loading" ? "animate-spin" : ""}`} />
            {status === "loading" ? "Fetching…" : status === "done" ? "Preview" : "Preview"}
          </button>
        </div>
      </div>

      {/* Push status */}
      {pushStatus === "done" && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 flex items-center gap-2">
          <Sheet className="h-4 w-4 shrink-0" />
          {pushMsg}
          <a
            href="https://docs.google.com/spreadsheets/d/1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s/edit#gid=1505489272"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-emerald-700 underline text-xs shrink-0"
          >
            Open sheet ↗
          </a>
        </div>
      )}
      {pushStatus === "error" && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          Google Sheets error: {pushMsg}
        </div>
      )}

      {/* Idle prompt */}
      {status === "idle" && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground text-sm mb-2">
            Click <strong>Fetch from Zoho</strong> to pull the SPA P&amp;L and split it by venue tags + split rules.
          </p>
          <p className="text-xs text-muted-foreground">
            This makes ~{10 + 1} Zoho API calls and takes 15–30 seconds.
          </p>
        </Card>
      )}

      {/* Loading */}
      {status === "loading" && (
        <Card className="p-8 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Fetching P&amp;L for each venue from Zoho Books… please wait.
          </div>
        </Card>
      )}

      {/* Error */}
      {status === "error" && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{errorMsg}</p>
        </Card>
      )}

      {/* Results */}
      {status === "done" && result && (
        <>
          <SummaryBar result={result} />

          <Card className="p-3 md:p-6">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Account × Venue Breakdown</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {result.period.from_date} – {result.period.to_date} · {result.accounts.length} accounts across {result.tag_options.length} venues
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showRevenue}
                  onChange={e => setShowRevenue(e.target.checked)}
                  className="rounded"
                />
                Show revenue accounts
              </label>
            </div>

            <Legend />

            <div className="mt-4">
              <PivotTable result={result} showRevenue={showRevenue} />
            </div>
          </Card>

          {/* Debug log */}
          <div className="rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setLogOpen(x => !x)}
              className="w-full flex items-center justify-between px-4 py-2 bg-muted/30 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <span className="font-medium">Fetch log ({result.log.length} entries)</span>
              {logOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {logOpen && (
              <pre className="text-[11px] text-muted-foreground bg-muted/10 p-4 overflow-x-auto leading-relaxed font-mono">
                {result.log.join("\n")}
              </pre>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function SpaBreakdownPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <BreakdownContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
