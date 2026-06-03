"use client";

import { useMemo, useState } from "react";
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

interface ImportFromZohoProps {
  roleByContact: Map<string, WageRole>;
  setRole: ReturnType<typeof useWageRoles>["setRole"];
}

const CACHE_KEY = "wage-contacts-cache";

function ImportFromZoho({ roleByContact, setRole }: ImportFromZohoProps) {
  const [importedContacts, setImportedContacts] = useState<ImportedContact[] | null>(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as ImportedContact[]) : null;
    } catch { return null; }
  });
  const [isImporting, setIsImporting] = useState(false);
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
      const res = await fetch("/api/settings/wage-contacts", {
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
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
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

  function saveAll() {
    if (!importedContacts) return;
    for (const c of importedContacts) {
      const role = mergedRoles[c.contact_name];
      setRole.mutate({ contactName: c.contact_name, role: (role || null) as WageRole | null });
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Import from Zoho</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discover all wage contacts from Jan 2025 – Jun 2026 and assign roles in bulk.
          </p>
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
        <div className="px-4 py-6 text-sm text-center text-muted-foreground">
          No wage contacts found for the selected period.
        </div>
      )}

      {importedContacts && importedContacts.length > 0 && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Employee
                </th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Zoho Org
                </th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Role / Designation
                </th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {importedContacts.map((c) => {
                const alreadyMapped = roleByContact.has(c.contact_name);
                return (
                  <tr
                    key={c.contact_name}
                    className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="py-1.5 px-4">
                      <span className="text-foreground">{c.contact_name}</span>
                      {alreadyMapped && (
                        <span className="ml-2 inline-flex items-center rounded-sm border border-green-300 bg-green-50 px-1 py-px text-[9px] font-medium text-green-700">
                          Already mapped
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-muted-foreground">
                      {orgsLabel(c.orgs)}
                    </td>
                    <td className="py-1.5 px-4">
                      <select
                        value={mergedRoles[c.contact_name] ?? ""}
                        onChange={(ev) =>
                          setLocalRoles((prev) => ({
                            ...prev,
                            [c.contact_name]: ev.target.value as WageRole | "",
                          }))
                        }
                        disabled={setRole.isPending}
                        className={`text-xs border rounded px-2 py-1 bg-background disabled:opacity-50 ${
                          draftRoles[c.contact_name]
                            ? "border-border text-foreground"
                            : "border-amber-400 text-amber-700"
                        }`}
                      >
                        <option value="">Unassigned</option>
                        {WAGE_ROLES.map((r) => (
                          <option key={r} value={r}>{WAGE_ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-4">
                      <button
                        onClick={() => saveOne(c.contact_name)}
                        disabled={setRole.isPending}
                        className="text-xs border border-border rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-50 transition-colors"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button
              onClick={saveAll}
              disabled={setRole.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              Save All
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  CONTENT                                                            */
/* ------------------------------------------------------------------ */

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

      <ImportFromZoho roleByContact={roleByContact} setRole={setRole} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function EmployeeMappingPage() {
  return (
    <DashboardShell>
      {() => <EmployeeMappingContent />}
    </DashboardShell>
  );
}
