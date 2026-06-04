"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import {
  useWageRoles,
  WAGE_ROLES,
  WAGE_ROLE_LABEL,
  type WageRole,
} from "@/lib/hooks/useWageRoles";

interface ImportedContact {
  contact_name: string;
  total_amount: number;
  orgs: string[];
}

function orgsLabel(orgs: string[]): string {
  const set = new Set(orgs.map((o) => o.toUpperCase()));
  const hasSpa = set.has("SPA");
  const hasAes = set.has("AESTHETICS") || set.has("AES");
  if (hasSpa && hasAes) return "Both";
  if (hasSpa)  return "SPA";
  if (hasAes)  return "Aesthetics";
  return orgs.join(" / ") || "—";
}

interface ContactImportSectionProps {
  title: string;
  subtitle: string;
  apiEndpoint: string;
  cacheKey: string;
  emptyMessage: string;
  showDelete?: boolean;
  noCache?: boolean;   // when true, never auto-restore on page load — require explicit click
  roleByContact: Map<string, WageRole>;
  setRole: ReturnType<typeof useWageRoles>["setRole"];
}

function ContactImportSection({
  title, subtitle, apiEndpoint, cacheKey, emptyMessage, showDelete = false, noCache = false, roleByContact, setRole,
}: ContactImportSectionProps) {
  const [importedContacts, setImportedContacts] = useState<ImportedContact[] | null>(() => {
    if (noCache) return null;
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? (JSON.parse(raw) as ImportedContact[]) : null;
    } catch { return null; }
  });
  const queryClient = useQueryClient();
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const draftRoles = useMemo(() => {
    const draft: Record<string, WageRole | ""> = {};
    for (const c of importedContacts ?? []) {
      const key = (c.contact_name || "").trim().toLowerCase().replace(/\s+/g, " ");
      draft[c.contact_name] = roleByContact.get(key) ?? "";
    }
    return draft;
  }, [importedContacts, roleByContact]);

  const [localRoles, setLocalRoles] = useState<Record<string, WageRole | "">>({});
  const mergedRoles = { ...draftRoles, ...localRoles };

  async function handleLoad() {
    setIsImporting(true);
    setImportError(null);
    try {
      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: "2025-01-01", date_to: "2026-06-30" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Server error ${res.status}: ${text}`);
      }
      const json = await res.json();
      const data: ImportedContact[] = json.contacts ?? [];
      setImportedContacts(data);
      setLocalRoles({});
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* ignore */ }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  }

  function saveOne(contactName: string) {
    const role = mergedRoles[contactName];
    setRole.mutate({ contactName, role: (role || null) as WageRole | null });
  }

  function deleteRow(contactName: string) {
    // Hide from this session's view only — DB role is preserved.
    // A fresh "Load Contacts" will bring it back.
    setImportedContacts((prev) => {
      const next = (prev ?? []).filter((c) => c.contact_name !== contactName);
      try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setLocalRoles((prev) => { const n = { ...prev }; delete n[contactName]; return n; });
  }

  async function saveAll() {
    if (!importedContacts) return;
    setIsSavingAll(true);
    try {
      const assignments = importedContacts
        .map((c) => ({ contact_name: c.contact_name, role: mergedRoles[c.contact_name] || null }))
        .filter((a) => a.role);
      if (assignments.length > 0) {
        const res = await fetch("/api/settings/wage-roles/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignments }),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        await queryClient.invalidateQueries({ queryKey: ["wage-roles"] });
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingAll(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <button
          onClick={handleLoad}
          disabled={isImporting}
          className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
        >
          {isImporting && (
            <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {isImporting ? "Loading…" : "Load Contacts from Zoho (Jan 2025 – Jun 2026)"}
        </button>
      </div>

      {importError && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50/60 border-b border-red-200">
          {importError}
        </div>
      )}

      {importedContacts && importedContacts.length === 0 && (
        <div className="px-4 py-6 text-sm text-center text-muted-foreground">{emptyMessage}</div>
      )}

      {importedContacts && importedContacts.length > 0 && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Employee</th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Zoho Org</th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Role / Designation</th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {importedContacts.map((c) => {
                const mapped = roleByContact.has(normalizeKey(c.contact_name));
                return (
                  <tr key={c.contact_name} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-1.5 px-4">
                      <span className="text-foreground">{c.contact_name}</span>
                      {mapped && (
                        <span className="ml-2 inline-flex items-center rounded-sm border border-green-300 bg-green-50 px-1 py-px text-[9px] font-medium text-green-700">
                          mapped
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-muted-foreground">{orgsLabel(c.orgs)}</td>
                    <td className="py-1.5 px-4">
                      <select
                        value={mergedRoles[c.contact_name] ?? ""}
                        onChange={(ev) => setLocalRoles((prev) => ({ ...prev, [c.contact_name]: ev.target.value as WageRole | "" }))}
                        disabled={setRole.isPending}
                        className={`text-xs border rounded px-2 py-1 bg-background disabled:opacity-50 ${draftRoles[c.contact_name] ? "border-border text-foreground" : "border-amber-400 text-amber-700"}`}
                      >
                        <option value="">Unassigned</option>
                        {WAGE_ROLES.map((r) => (
                          <option key={r} value={r}>{WAGE_ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => saveOne(c.contact_name)} disabled={setRole.isPending} className="text-xs border border-border rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-50 transition-colors">
                          Save
                        </button>
                        {showDelete && (
                          <button onClick={() => deleteRow(c.contact_name)} className="text-xs border border-red-200 text-red-600 rounded px-2 py-1 hover:bg-red-50 transition-colors">
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button onClick={saveAll} disabled={isSavingAll} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
              {isSavingAll ? "Saving…" : "Save All"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function normalizeKey(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Salary Breakdown ────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtMonth(m: string): string {
  const [year, mon] = m.split("-");
  return `${MONTH_NAMES[parseInt(mon, 10) - 1]} ${year.slice(2)}`;
}

function fmtMonthFull(m: string): string {
  const [year, mon] = m.split("-");
  return `${MONTH_NAMES[parseInt(mon, 10) - 1]} ${year}`;
}

function fmtAmount(n: number): string {
  if (!n) return "";
  return `€${Math.round(n).toLocaleString("en-GB")}`;
}

function orgLabel(org: string): string {
  if (org === "spa") return "SPA";
  if (org === "aesthetics") return "Aesthetics";
  return org.charAt(0).toUpperCase() + org.slice(1);
}

interface SalaryEmployee {
  contact_name: string;
  org: string;
  monthly: Record<string, number>;
  total: number;
  coa_codes: string[];
  has_supplement: boolean;
}

interface SalaryData {
  months: string[];
  employees: SalaryEmployee[];
}

const MONTH_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const opts = [];
  for (let y = 2024; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      opts.push({ value: `${y}-${mm}`, label: `${MONTH_NAMES[m - 1]} ${y}` });
    }
  }
  return opts;
})();

function SalaryBreakdown() {
  const [data, setData] = useState<SalaryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState("2025-01");
  const [toMonth, setToMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  async function handleLoad() {
    setIsLoading(true);
    setError(null);
    try {
      const dateFrom = `${fromMonth}-01`;
      const [toY, toM] = toMonth.split("-").map(Number);
      const lastDay = new Date(toY, toM, 0).getDate();
      const dateTo  = `${toMonth}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch(`/api/settings/salary-monthly?date_from=${dateFrom}&date_to=${dateTo}`);
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Server error ${res.status}: ${text}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  const grandTotal = data?.employees.reduce((s, e) => s + e.total, 0) ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">Salary Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monthly wages + supplements per employee by org — {fmtMonthFull(fromMonth)} to {fmtMonthFull(toMonth)}.
            Source: Zoho wages (wages COA) + frozen supplements.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label className="text-xs text-muted-foreground">From</label>
          <select
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground"
          >
            {MONTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="text-xs text-muted-foreground">To</label>
          <select
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground"
          >
            {MONTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={handleLoad}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
          >
            {isLoading && (
              <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {isLoading ? "Loading…" : "Load Salary Breakdown"}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50/60 border-b border-red-200">
          {error}
        </div>
      )}

      {data && data.employees.length === 0 && (
        <div className="px-4 py-6 text-sm text-center text-muted-foreground">
          No salary transactions found for the selected period.
        </div>
      )}

      {data && data.employees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 min-w-[180px]">
                  Employee
                </th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[90px]">
                  Org
                </th>
                <th className="text-left py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[110px]">
                  Source / COA
                </th>
                {data.months.map((m) => (
                  <th key={m} className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[72px]">
                    {fmtMonth(m)}
                  </th>
                ))}
                <th className="text-right py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr
                  key={`${emp.contact_name}|${emp.org}`}
                  className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-1.5 px-4 text-foreground sticky left-0 bg-background z-10 whitespace-nowrap">
                    {emp.contact_name}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                    {orgLabel(emp.org)}
                  </td>
                  <td className="py-1.5 px-3 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex gap-1 flex-wrap">
                        {emp.coa_codes.length > 0 && (
                          <span className="inline-flex items-center rounded-sm bg-blue-50 border border-blue-200 px-1 py-px text-[9px] font-medium text-blue-700">Zoho</span>
                        )}
                        {emp.has_supplement && (
                          <span className="inline-flex items-center rounded-sm bg-amber-50 border border-amber-200 px-1 py-px text-[9px] font-medium text-amber-700">Supp</span>
                        )}
                      </div>
                      {emp.coa_codes.length > 0 && (
                        <span className="text-[10px] text-muted-foreground tabular-nums leading-tight">
                          {emp.coa_codes.join(", ")}
                        </span>
                      )}
                    </div>
                  </td>
                  {data.months.map((m) => (
                    <td key={m} className="py-1.5 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                      {emp.monthly[m]
                        ? <span className="text-foreground">{fmtAmount(emp.monthly[m])}</span>
                        : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  ))}
                  <td className="py-1.5 px-4 text-right text-xs tabular-nums font-semibold text-foreground whitespace-nowrap">
                    {fmtAmount(emp.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td
                  colSpan={3}
                  className="py-2 px-4 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/20 z-10"
                >
                  Monthly total
                </td>
                {data.months.map((m) => {
                  const monthTotal = data.employees.reduce((s, e) => s + (e.monthly[m] ?? 0), 0);
                  return (
                    <td key={m} className="py-2 px-3 text-right text-xs tabular-nums font-medium text-foreground whitespace-nowrap">
                      {monthTotal > 0
                        ? fmtAmount(monthTotal)
                        : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  );
                })}
                <td className="py-2 px-4 text-right text-xs tabular-nums font-bold text-foreground whitespace-nowrap">
                  {fmtAmount(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function EmployeeMappingContent() {
  const { roleByContact, setRole } = useWageRoles();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5 text-gold" />
          Employee Mapping
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Assign each employee a role (Manager, Reception, Practitioner, CRM). The EBITDA cockpit&apos;s
          Wages &amp; Salaries row uses these mappings to break payroll down by role for the selected period.
          Unassigned employees are counted separately. Employees are loaded from the last 2 years of payroll data.
        </p>
      </div>

      <ContactImportSection
        title="Wages & Salary COA"
        subtitle="All payroll contacts from wages/salary GL accounts — Jan 2025 to Jun 2026."
        apiEndpoint="/api/settings/wage-contacts"
        cacheKey="wage-contacts-cache"
        emptyMessage="No wage contacts found for the selected period."
        roleByContact={roleByContact}
        setRole={setRole}
      />

      <ContactImportSection
        title="Professional Fees COA"
        showDelete
        subtitle="Contractors and CRM staff from professional fees GL accounts — Jan 2025 to Jun 2026."
        apiEndpoint="/api/settings/prof-fee-contacts"
        cacheKey="prof-fee-contacts-cache"
        emptyMessage="No professional fee contacts found for the selected period."
        roleByContact={roleByContact}
        setRole={setRole}
      />

      <SalaryBreakdown />
    </div>
  );
}

export default function EmployeeMappingPage() {
  return (
    <DashboardShell>
      {() => <EmployeeMappingContent />}
    </DashboardShell>
  );
}
