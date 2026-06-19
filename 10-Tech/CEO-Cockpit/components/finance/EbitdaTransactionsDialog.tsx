"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, SplitSquareHorizontal, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEbitdaTransactions, DrillTarget } from "@/lib/hooks/useEbitdaTransactions";
import { useContactBreakdown } from "@/lib/hooks/useContactBreakdown";
import { useWageRoleBreakdown } from "@/lib/hooks/useWageRoleBreakdown";
import { WAGE_ROLES, WAGE_ROLE_LABEL } from "@/lib/hooks/useWageRoles";

function fmtFull(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}€${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(p: number): string {
  return `${Math.round(p)}%`;
}

// Lines where contact breakdown is meaningful
const CONTACT_LINES = new Set(["wages", "sga", "cogs", "advertising", "rent", "utilities"]);

function targetToOrg(target: DrillTarget | null): string {
  if (!target) return "both";
  switch (target.brand) {
    case "SPA":  return "spa";
    case "AES":
    case "SLIM": return "aesthetics";
    default:     return "both";
  }
}

function targetToEbitdaLine(target: DrillTarget | null): string | null {
  if (!target) return null;
  const cat = target.category;
  if (cat === "wages")       return "wages";
  if (cat === "cogs")        return "cogs";
  if (cat === "advertising") return "advertising";
  if (cat === "rent_plus" || cat === "rent") return "rent";
  if (cat === "utilities")   return "utilities";
  if (cat === "sga" || cat.startsWith("sga_")) return "sga";
  return null;
}

function targetToSubLine(target: DrillTarget | null): string | null {
  if (!target) return null;
  switch (target.category) {
    case "sga_prof_services": return "prof_services";
    case "sga_fuel":          return "fuel";
    case "sga_laundry":       return "laundry";
    case "sga_software":      return "software";
    case "sga_cleaning":      return "cleaning";
    case "sga_travel":        return "travel";
    case "sga_insurance":     return "insurance";
    case "sga_events":        return "events";
    case "sga_maintenance":   return "maintenance";
    case "sga_telecom":       return "telecom";
    default:                  return null;
  }
}

export function EbitdaTransactionsDialog({
  dateFrom,
  dateTo,
  target,
  onClose,
  employeeBreakdown,
}: {
  dateFrom: Date;
  dateTo: Date;
  target: DrillTarget | null;
  onClose: () => void;
  employeeBreakdown?: { contact: string; amount: number }[] | null;
}) {
  const hasEmployeeBreakdown = employeeBreakdown != null;
  const employeeTotal = employeeBreakdown?.reduce((sum, r) => sum + r.amount, 0) ?? 0;

  const ebitdaLine    = targetToEbitdaLine(target);
  const ebitdaSubLine = targetToSubLine(target);
  // showContactTab applies when NOT drilling a specific role row (those use employeeBreakdown instead)
  const showContactTab = !hasEmployeeBreakdown && ebitdaLine !== null && CONTACT_LINES.has(ebitdaLine);
  const isWages = ebitdaLine === "wages";

  // Default to the richest tab: employees for role rows, contacts for other drillable rows
  const defaultTab = hasEmployeeBreakdown ? "employees" : (showContactTab ? "contacts" : "transactions");
  const [activeTab, setActiveTab] = useState<"transactions" | "contacts" | "employees">(defaultTab);

  const { data, isLoading, isFetching, error } = useEbitdaTransactions(dateFrom, dateTo, target);

  const { data: contactData, isLoading: contactLoading, error: contactError } = useContactBreakdown(
    targetToOrg(target),
    ebitdaLine,
    dateFrom,
    dateTo,
    showContactTab && activeTab === "contacts" && !isWages,
    ebitdaSubLine,
    target?.venue,   // pass venue so breakdown is filtered to this venue's tagged transactions
  );
  const { data: roleData, isLoading: roleLoading, error: roleError } = useWageRoleBreakdown(
    targetToOrg(target),
    dateFrom,
    dateTo,
    showContactTab && activeTab === "contacts" && isWages,
  );

  // Switch to appropriate default when target changes
  useEffect(() => {
    if (target === null) {
      setActiveTab("transactions");
    } else if (hasEmployeeBreakdown) {
      setActiveTab("employees");
    } else if (showContactTab) {
      setActiveTab("contacts");
    } else {
      setActiveTab("transactions");
    }
  }, [target, hasEmployeeBreakdown, showContactTab]);

  // ESC key closes the panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && target !== null) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [target, onClose]);

  const isOpen = target !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ease-in-out ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        className={`fixed right-0 top-0 h-full z-50 bg-background shadow-2xl border-l border-border flex flex-col w-full sm:w-[480px] transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 shrink-0">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              {target?.label ?? "Transactions"}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dateFrom.toLocaleDateString()} – {dateTo.toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-0 -mb-px px-4 shrink-0">
          {hasEmployeeBreakdown && (
            <button
              onClick={() => setActiveTab("employees")}
              className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === "employees"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3 w-3" /> By Employee
            </button>
          )}
          {showContactTab && (
            <button
              onClick={() => setActiveTab("contacts")}
              className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors flex items-center gap-1.5 ${
                activeTab === "contacts"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3 w-3" /> {isWages ? "By Role" : "By Contact"}
            </button>
          )}
          <button
            onClick={() => setActiveTab("transactions")}
            className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 transition-colors ${
              activeTab === "transactions"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Transactions
          </button>
        </div>

        {/* ── By Employee tab (role row drills) ──────────────────────────── */}
        {activeTab === "employees" && (
          <div className="overflow-y-auto flex-1 px-4 py-2">
            {employeeBreakdown!.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No employees mapped to this role for this venue.
              </div>
            ) : (
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 bg-popover z-10">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-1.5 px-2 border-b border-border">Employee</th>
                    <th className="text-right py-1.5 px-2 border-b border-border">Amount</th>
                    <th className="text-right py-1.5 px-2 border-b border-border w-20">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeBreakdown!.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="py-1.5 px-2 border-b border-border/50 text-foreground">
                        {row.contact || <span className="italic text-muted-foreground">(no contact)</span>}
                      </td>
                      <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums font-medium text-foreground">
                        {fmtFull(row.amount)}
                      </td>
                      <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{ width: `${employeeTotal > 0 ? Math.min(row.amount / employeeTotal * 100, 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-muted-foreground w-10 text-right">
                            {employeeTotal > 0 ? fmtPct(row.amount / employeeTotal * 100) : "—"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2 px-2 text-right text-muted-foreground">Total</td>
                    <td className="py-2 px-2 text-right tabular-nums text-foreground">{fmtFull(employeeTotal)}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">100%</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {/* ── Transactions tab ─────────────────────────────────────────────── */}
        {activeTab === "transactions" && (
          <>
            {data && (
              <div className="flex flex-wrap items-center gap-3 text-xs border-b border-border py-2 px-4 shrink-0">
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

            <div className="overflow-y-auto flex-1 px-4 py-2">
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
          </>
        )}

        {/* ── By Contact / By Role tab ─────────────────────────────────────── */}
        {activeTab === "contacts" && (
          <div className="overflow-y-auto flex-1 px-4 py-2">

            {/* ── By Role (wages only) ── */}
            {isWages && (
              <>
                {roleLoading && (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading role breakdown…
                  </div>
                )}
                {roleError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {roleError.message}
                  </div>
                )}
                {roleData && !roleLoading && (
                  <>
                    {!roleData.has_data ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No data yet — run a Sync to populate
                      </div>
                    ) : (
                      <table className="w-full text-xs border-separate border-spacing-0">
                        <thead className="sticky top-0 bg-popover z-10">
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left py-1.5 px-2 border-b border-border">Role</th>
                            <th className="text-right py-1.5 px-2 border-b border-border">Amount</th>
                            <th className="text-right py-1.5 px-2 border-b border-border w-20">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {([...WAGE_ROLES, "unassigned"] as const).map((role) => {
                            const isUnassigned = role === "unassigned";
                            const label = isUnassigned ? "Unassigned" : WAGE_ROLE_LABEL[role as keyof typeof WAGE_ROLE_LABEL];
                            const amount = roleData.roles[role];
                            const pct = roleData.total > 0 ? (amount / roleData.total) * 100 : 0;
                            return (
                              <tr key={role} className={`hover:bg-muted/30 transition-colors ${isUnassigned ? "text-muted-foreground" : ""}`}>
                                <td className="py-1.5 px-2 border-b border-border/50">
                                  {isUnassigned ? <span className="italic">{label}</span> : label}
                                </td>
                                <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums font-medium text-foreground">
                                  {fmtFull(amount)}
                                </td>
                                <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${isUnassigned ? "bg-muted-foreground/30" : "bg-amber-400"}`}
                                        style={{ width: `${Math.min(pct, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold">
                            <td className="py-2 px-2 text-right text-muted-foreground">Total</td>
                            <td className="py-2 px-2 text-right tabular-nums text-foreground">{fmtFull(roleData.total)}</td>
                            <td className="py-2 px-2 text-right text-muted-foreground">100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── By Contact (all other lines) ── */}
            {!isWages && (
              <>
                {contactLoading && (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading contact breakdown…
                  </div>
                )}
                {contactError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {contactError.message}
                  </div>
                )}
                {contactData && !contactLoading && (
                  <>
                    {contactData.rows.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        No contact data for this selection. Run a Sync to populate.
                      </div>
                    ) : (
                      <table className="w-full text-xs border-separate border-spacing-0">
                        <thead className="sticky top-0 bg-popover z-10">
                          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left py-1.5 px-2 border-b border-border">Contact</th>
                            <th className="text-right py-1.5 px-2 border-b border-border">Amount</th>
                            <th className="text-right py-1.5 px-2 border-b border-border w-20">Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contactData.rows.map((r, i) => {
                            const isUnassigned = r.contact_name === "Unassigned";
                            return (
                              <tr key={i} className={`hover:bg-muted/30 transition-colors ${isUnassigned ? "text-muted-foreground" : ""}`}>
                                <td className="py-1.5 px-2 border-b border-border/50">
                                  {isUnassigned
                                    ? <span className="italic">{r.contact_name}</span>
                                    : r.contact_name}
                                </td>
                                <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums font-medium text-foreground">
                                  {fmtFull(r.amount)}
                                </td>
                                <td className="py-1.5 px-2 border-b border-border/50 text-right tabular-nums">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${isUnassigned ? "bg-muted-foreground/30" : "bg-amber-400"}`}
                                        style={{ width: `${Math.min(r.pct, 100)}%` }}
                                      />
                                    </div>
                                    <span className="text-muted-foreground w-10 text-right">{r.pct.toFixed(1)}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold">
                            <td className="py-2 px-2 text-right text-muted-foreground">Total</td>
                            <td className="py-2 px-2 text-right tabular-nums text-foreground">{fmtFull(contactData.total)}</td>
                            <td className="py-2 px-2 text-right text-muted-foreground">100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </>
  );
}
