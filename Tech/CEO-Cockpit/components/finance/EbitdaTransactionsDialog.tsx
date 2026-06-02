"use client";

import { AlertTriangle, CheckCircle2, FileText, Loader2, SplitSquareHorizontal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useEbitdaTransactions, DrillTarget } from "@/lib/hooks/useEbitdaTransactions";

function fmtFull(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}€${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EbitdaTransactionsDialog({
  dateFrom,
  dateTo,
  target,
  onClose,
}: {
  dateFrom: Date;
  dateTo: Date;
  target: DrillTarget | null;
  onClose: () => void;
}) {
  const { data, isLoading, isFetching, error } = useEbitdaTransactions(dateFrom, dateTo, target);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {target?.label ?? "Transactions"}
          </DialogTitle>
          <DialogDescription>
            Individual Zoho transactions behind this cost for{" "}
            {dateFrom.toLocaleDateString()} – {dateTo.toLocaleDateString()}.
          </DialogDescription>
        </DialogHeader>

        {/* Reconciliation summary */}
        {data && (
          <div className="flex flex-wrap items-center gap-3 text-xs border-y border-border py-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1">
              <span className="text-muted-foreground">Cell total</span>
              <span className="font-semibold text-foreground tabular-nums">{fmtFull(data.cell_total)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1">
              <span className="text-muted-foreground">Transactions</span>
              <span className="font-semibold text-foreground tabular-nums">{data.txn_count}</span>
            </span>
            {data.reconciles ? (
              <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50/60">
                <CheckCircle2 className="h-3 w-3" /> Reconciles
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50/60">
                <AlertTriangle className="h-3 w-3" /> Partial reconciliation
              </Badge>
            )}
          </div>
        )}

        {/* Body */}
        <div className="overflow-auto flex-1 -mx-1 px-1">
          {(isLoading || (isFetching && !data)) && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pulling transactions from Zoho…
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error.message}
            </div>
          )}

          {data && !isLoading && (
            <>
              {data.transactions.length === 0 && data.synthetic_rows.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No individual transactions for this selection.
                </div>
              )}

              {data.transactions.length > 0 && (
                <table className="w-full text-xs border-separate border-spacing-0">
                  <thead className="sticky top-0 bg-popover z-10">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left py-1.5 px-2 border-b border-border">Date</th>
                      <th className="text-left py-1.5 px-2 border-b border-border">Payee / Description</th>
                      <th className="text-left py-1.5 px-2 border-b border-border">Type</th>
                      <th className="text-left py-1.5 px-2 border-b border-border">Ref</th>
                      <th className="text-left py-1.5 px-2 border-b border-border">Account</th>
                      <th className="text-left py-1.5 px-2 border-b border-border">Venue</th>
                      <th className="text-right py-1.5 px-2 border-b border-border">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t, i) => (
                      <tr key={`${t.transaction_id}-${t.account_code}-${i}`} className="hover:bg-muted/30 transition-colors">
                        <td className="py-1.5 px-2 border-b border-border/50 tabular-nums whitespace-nowrap text-foreground">{t.date}</td>
                        <td className="py-1.5 px-2 border-b border-border/50 max-w-[220px]">
                          <div className="truncate text-foreground" title={t.payee || t.description}>
                            {t.payee || <span className="text-muted-foreground italic">(no payee)</span>}
                          </div>
                          {t.description && t.description !== t.payee && (
                            <div className="truncate text-muted-foreground/70 text-[11px]" title={t.description}>{t.description}</div>
                          )}
                        </td>
                        <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground whitespace-nowrap">{t.transaction_type}</td>
                        <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground font-mono whitespace-nowrap">{t.reference || "—"}</td>
                        <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground whitespace-nowrap" title={t.account_name}>
                          <span className="font-mono">{t.account_code}</span>
                        </td>
                        <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground whitespace-nowrap">{t.venue}</td>
                        <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums whitespace-nowrap">
                          {t.is_split ? (
                            <span className="inline-flex items-center justify-end gap-1" title={`Allocated ${(t.allocation_factor * 100).toFixed(1)}% of raw ${fmtFull(t.amount)}`}>
                              <SplitSquareHorizontal className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="text-foreground font-medium">{fmtFull(t.allocated_amount)}</span>
                            </span>
                          ) : (
                            <span className="text-foreground font-medium">{fmtFull(t.allocated_amount)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={6} className="py-2 px-2 text-right text-muted-foreground">Transactions total</td>
                      <td className="py-2 px-2 text-right tabular-nums text-foreground">{fmtFull(data.txn_allocated_total)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* Synthetic / non-Zoho contributions */}
              {data.synthetic_rows.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                    Other contributions (estimated / off-ledger)
                  </p>
                  <table className="w-full text-xs border-separate border-spacing-0">
                    <tbody>
                      {data.synthetic_rows.map((r, i) => (
                        <tr key={`${r.account_code}-${i}`} className="hover:bg-muted/30">
                          <td className="py-1.5 px-2 border-b border-border/50 text-foreground whitespace-nowrap">
                            <span className="font-mono text-muted-foreground">{r.account_code}</span> {r.account_name}
                          </td>
                          <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground">{r.venue}</td>
                          <td className="py-1.5 px-2 border-b border-border/50 text-muted-foreground italic max-w-[280px] truncate" title={r.reason}>{r.reason}</td>
                          <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums text-foreground font-medium">{fmtFull(r.period_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Notes / caveats */}
              {data.notes.length > 0 && (
                <ul className="mt-4 space-y-1 text-[11px] text-muted-foreground">
                  {data.notes.map((n, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-muted-foreground/50">·</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
