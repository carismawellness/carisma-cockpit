"use client";

import { useState } from "react";
import {
  RefreshCw, CheckCircle2, AlertTriangle,
  XCircle, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import { useReconCheck, ReconStatus } from "@/lib/hooks/useReconCheck";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtEur(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}€${(abs / 1_000).toFixed(1)}K`;
  return `${sign}€${abs.toFixed(1)}`;
}

function fmtDiff(v: number): string {
  const abs = Math.abs(v);
  const compact = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M`
                : abs >= 1_000     ? `${(abs / 1_000).toFixed(1)}K`
                : abs.toFixed(1);
  return `${v >= 0 ? "+" : "-"}€${compact}`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusPill({ status }: { status: "ok" | "mismatch" }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-medium">
        <CheckCircle2 className="h-2.5 w-2.5" /> OK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-medium">
      <XCircle className="h-2.5 w-2.5" /> Mismatch
    </span>
  );
}

function Row({ label, value, valueClass = "text-foreground" }: {
  label: string; value: string; valueClass?: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums shrink-0 ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge pill config                                                  */
/* ------------------------------------------------------------------ */

function pillConfig(status: ReconStatus, totalGapEur: number, unmappedCount: number) {
  switch (status) {
    case "idle":
      return {
        dot: "bg-slate-300",
        text: "Check costs",
        textClass: "text-muted-foreground",
        bg: "bg-background hover:bg-muted/50 border-border",
        cursor: "cursor-pointer",
      };
    case "loading":
      return {
        dot: null,
        text: "Checking…",
        textClass: "text-muted-foreground",
        bg: "bg-muted/40 border-border/60",
        cursor: "cursor-wait",
      };
    case "ok":
      return {
        dot: "bg-emerald-500",
        text: "Costs reconciled",
        textClass: "text-emerald-700",
        bg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
        cursor: "cursor-pointer",
      };
    case "warning":
      return {
        dot: "bg-amber-500",
        text: `${unmappedCount} unmapped account${unmappedCount !== 1 ? "s" : ""}`,
        textClass: "text-amber-700",
        bg: "bg-amber-50 border-amber-200 hover:bg-amber-100",
        cursor: "cursor-pointer",
      };
    case "mismatch":
      return {
        dot: "bg-red-500",
        text: `${fmtEur(totalGapEur)} gap — review`,
        textClass: "text-red-600",
        bg: "bg-red-50 border-red-200 hover:bg-red-100",
        cursor: "cursor-pointer",
      };
    case "error":
      return {
        dot: "bg-red-400",
        text: "Check failed",
        textClass: "text-red-500",
        bg: "bg-red-50 border-red-200 hover:bg-red-100",
        cursor: "cursor-pointer",
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ReconBadge({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [enabled,  setEnabled]  = useState(false);
  const [expanded, setExpanded] = useState(false);

  const recon = useReconCheck(dateFrom, dateTo, enabled);
  const pill  = pillConfig(recon.status, recon.totalGapEur, recon.unmappedCount);

  function handleBadgeClick() {
    if (!enabled) {
      // First click — trigger the check
      setEnabled(true);
      return;
    }
    if (recon.isLoading) return;
    // Subsequent clicks — toggle the detail panel
    setExpanded(x => !x);
  }

  const showChevron = enabled && !recon.isLoading && recon.status !== "idle";

  return (
    <div className="relative flex flex-col items-end">
      {/* ── Badge pill ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleBadgeClick}
        disabled={recon.isLoading}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${pill.bg} ${pill.cursor}`}
        title={recon.status === "idle" ? "Run EBITDA reconciliation check against Zoho Books" : undefined}
      >
        {pill.dot ? (
          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${pill.dot}`} />
        ) : (
          <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        )}
        <span className={pill.textClass}>{pill.text}</span>
        {showChevron && (
          expanded
            ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
            : <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {/* ── Detail panel ───────────────────────────────────────────── */}
      {expanded && recon.spa && recon.aes && (
        <div className="absolute right-0 top-8 w-[360px] rounded-lg border border-border bg-background shadow-xl text-xs z-50">

          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
            <div>
              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide">
                EBITDA Reconciliation
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Zoho Books vs dashboard — {recon.spa.period.date_from} → {recon.spa.period.date_to}
              </p>
            </div>
            <button
              type="button"
              onClick={() => recon.refresh()}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded border border-border/50 hover:bg-muted/40"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Re-check
            </button>
          </div>

          {/* SPA section */}
          <div className="px-3 py-2.5 border-b border-border/60">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-foreground">SPA (Zoho Books)</span>
              <StatusPill status={recon.spa.reconciliation.status} />
            </div>
            <div className="space-y-1">
              <Row
                label="Expected EBITDA (Zoho – supplement)"
                value={fmtEur(recon.spa.reconciliation.expected_with_cockpit)}
              />
              <Row
                label="Dashboard EBITDA (Cockpit + Zoho costs)"
                value={fmtEur(recon.spa.reconciliation.frontend_ebitda)}
              />
              <Row
                label="Difference"
                value={fmtDiff(recon.spa.reconciliation.difference)}
                valueClass={Math.abs(recon.spa.reconciliation.difference) < 500 ? "text-emerald-600" : "text-red-600"}
              />
              {recon.spa.zoho.below_total > 0 && (
                <Row
                  label="Below-EBITDA items (deprec., tax, interest)"
                  value={fmtEur(recon.spa.zoho.below_total)}
                  valueClass="text-slate-500"
                />
              )}
              {recon.spa.gap_analysis.totals.not_linked_total + recon.spa.gap_analysis.totals.not_in_db_total > 0 && (
                <Row
                  label={`Unmapped expenses (${recon.spa.gap_analysis.not_linked_expenses.length + recon.spa.gap_analysis.not_in_db_expenses.length} accounts)`}
                  value={fmtEur(
                    recon.spa.gap_analysis.totals.not_linked_total +
                    recon.spa.gap_analysis.totals.not_in_db_total
                  )}
                  valueClass="text-amber-600"
                />
              )}
            </div>

            {/* Unmapped account list */}
            {(recon.spa.gap_analysis.not_linked_expenses.length > 0 ||
              recon.spa.gap_analysis.not_in_db_expenses.length > 0) && (
              <div className="mt-2 pl-2 border-l-2 border-amber-200 space-y-0.5">
                {[
                  ...recon.spa.gap_analysis.not_linked_expenses,
                  ...recon.spa.gap_analysis.not_in_db_expenses,
                ]
                  .slice(0, 6)
                  .map(item => (
                    <div key={item.code} className="flex justify-between items-baseline gap-2 text-[10px]">
                      <span className="text-amber-700 truncate">{item.name}</span>
                      <span className="text-amber-600 shrink-0 tabular-nums">{fmtEur(item.amount)}</span>
                    </div>
                  ))}
                {(recon.spa.gap_analysis.not_linked_expenses.length +
                  recon.spa.gap_analysis.not_in_db_expenses.length) > 6 && (
                  <p className="text-[10px] text-muted-foreground">
                    +{recon.spa.gap_analysis.not_linked_expenses.length +
                       recon.spa.gap_analysis.not_in_db_expenses.length - 6} more — see detail page
                  </p>
                )}
              </div>
            )}

            {recon.spa.gap_analysis.totals.excluded_total > 0 && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Intentionally excluded: {fmtEur(recon.spa.gap_analysis.totals.excluded_total)}
                {" "}({recon.spa.gap_analysis.excluded_expenses.length} accounts)
              </p>
            )}
          </div>

          {/* Aesthetics & Slimming section */}
          <div className="px-3 py-2.5 border-b border-border/60">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-foreground">Aesthetics &amp; Slimming</span>
              <StatusPill status={recon.aes.reconciliation.status} />
            </div>
            <div className="space-y-1">
              <Row
                label="Expected EBITDA (CoA + daily sales)"
                value={fmtEur(recon.aes.reconciliation.expected_ebitda)}
              />
              <Row
                label="Dashboard EBITDA"
                value={fmtEur(recon.aes.reconciliation.frontend_ebitda)}
              />
              <Row
                label="Difference"
                value={fmtDiff(recon.aes.reconciliation.difference)}
                valueClass={Math.abs(recon.aes.reconciliation.difference) < 500 ? "text-emerald-600" : "text-red-600"}
              />
              {recon.aes.zoho.below_total > 0 && (
                <Row
                  label="Below-EBITDA items"
                  value={fmtEur(recon.aes.zoho.below_total)}
                  valueClass="text-slate-500"
                />
              )}
              {recon.aes.gap_analysis.totals.not_linked_total + recon.aes.gap_analysis.totals.not_in_db_total > 0 && (
                <Row
                  label={`Unmapped expenses (${recon.aes.gap_analysis.not_linked_expenses.length + recon.aes.gap_analysis.not_in_db_expenses.length} accounts)`}
                  value={fmtEur(
                    recon.aes.gap_analysis.totals.not_linked_total +
                    recon.aes.gap_analysis.totals.not_in_db_total
                  )}
                  valueClass="text-amber-600"
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-3 py-2 flex items-center gap-4 bg-muted/20 rounded-b-lg">
            <p className="text-[10px] text-muted-foreground flex-1">
              €500 tolerance · cached 10 min
            </p>
            <a
              href="/finance/ebitda/spa"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              SPA detail <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <a
              href="/finance/ebitda/aesthetics"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Aesthetics <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
