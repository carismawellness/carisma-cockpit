"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import {
  RefreshCw, Download, Plus, Trash2, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Settings2, Loader2, Users,
} from "lucide-react";
import {
  useWageRoles,
  WAGE_ROLES,
  WAGE_ROLE_LABEL,
  type WageRole,
} from "@/lib/hooks/useWageRoles";

// ── Shared helper ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ══════════════════════════════════════════════════════════════════════════════
// COA MAPPING
// ══════════════════════════════════════════════════════════════════════════════

interface SplitRule {
  id: number;
  name: string;
  zoho_org: string;
  rule_type: "direct" | "equal" | "sales_ratio" | "salary_cost" | "custom_fixed" | "marketing_spend_ratio";
  is_system: boolean;
  config: Record<string, number> | null;
}

interface CoaRow {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string | null;
  zoho_org: string;
  ebitda_line: string | null;
  split_rule_id: number | null;
  coa_split_rules: SplitRule | null;
  last_synced_at: string | null;
}

const EBITDA_LINES = [
  { value: "revenue",           label: "Revenue" },
  { value: "cogs",              label: "COGS" },
  { value: "wages",             label: "Wages & Salaries" },
  { value: "advertising",       label: "Marketing" },
  { value: "rent",              label: "Rent" },
  { value: "utilities",         label: "Utilities" },
  { value: "sga_prof_services", label: "SG&A - Prof services" },
  { value: "sga_fuel",          label: "SG&A - Fuel" },
  { value: "sga_laundry",       label: "SG&A - Laundry" },
  { value: "sga_software",      label: "SG&A - Software" },
  { value: "sga_cleaning",      label: "SG&A - Cleaning" },
  { value: "sga_travel",        label: "SG&A - Travel" },
  { value: "sga_misc",          label: "SG&A - Misc" },
  { value: "sga_insurance",     label: "SG&A - Insurance" },
  { value: "sga_events",        label: "SG&A - Events" },
  { value: "sga_maintenance",   label: "SG&A - Maintenance" },
  { value: "sga_telecom",       label: "SG&A - Telecom" },
  { value: "excluded",          label: "Excluded" },
];

const SPA_LOCATIONS: { key: string; label: string }[] = [
  { key: "inter",     label: "InterContinental" },
  { key: "hugos",     label: "Hugos" },
  { key: "hyatt",     label: "Hyatt" },
  { key: "ramla",     label: "Ramla" },
  { key: "labranda",  label: "Riviera" },
  { key: "odycy",     label: "Sunny Coast" },
  { key: "excelsior", label: "Excelsior" },
  { key: "novotel",   label: "Novotel" },
];

const AESTH_DEPTS: { key: string; label: string }[] = [
  { key: "aesthetics", label: "Aesthetics" },
  { key: "slimming",   label: "Slimming"   },
];

function SplitRulesPanel({ org, rules }: { org: "spa" | "aesthetics"; rules: SplitRule[] }) {
  const qc = useQueryClient();
  const [open, setOpen]         = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName]   = useState("");
  const [newPct, setNewPct]     = useState<Record<string, string>>({});
  const [formErr, setFormErr]   = useState("");
  const isSpa = org === "spa";

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/settings/split-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["split-rules", org] }),
  });

  const createMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/split-rules", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["split-rules", org] });
      setShowForm(false); setNewName(""); setNewPct({}); setFormErr("");
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  function handleCreate() {
    setFormErr("");
    const config: Record<string, number> = {};
    const entities = isSpa ? SPA_LOCATIONS : AESTH_DEPTS;
    for (const loc of entities) {
      const v = parseFloat(newPct[loc.key] ?? "0");
      if (v > 0) config[loc.key] = v;
    }
    const total = Object.values(config).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.01) { setFormErr(`Percentages must sum to 100 (currently ${total.toFixed(1)})`); return; }
    createMut.mutate({ name: newName, zoho_org: org, config });
  }

  const customRules = rules.filter(r => !r.is_system);

  return (
    <div className="border border-warm-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-warm-white hover:bg-warm-gray transition-colors text-sm font-semibold text-charcoal">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-text-secondary" />
          Split Rules
          <span className="text-xs font-normal text-text-secondary ml-1">
            ({rules.filter(r => r.rule_type !== "direct").length} total, {customRules.length} custom)
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="p-5 space-y-4 border-t border-warm-border bg-white">
          <div>
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">System rules</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {rules.filter(r => r.is_system && r.rule_type !== "direct").map(r => (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-warm-gray text-xs text-text-secondary">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                  <span className="truncate">{r.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Custom rules</p>
              <button onClick={() => setShowForm(!showForm)}
                className="flex items-center gap-1 text-xs font-medium text-gold hover:text-gold/80 transition-colors">
                <Plus className="h-3.5 w-3.5" />Add rule
              </button>
            </div>

            {customRules.length === 0 && !showForm && (
              <p className="text-xs text-text-secondary italic">
                {isSpa ? "No custom rules yet. Add one to define a fixed % split across locations." : "No custom rules yet. Add one to define a fixed % split between Aesthetics and Slimming."}
              </p>
            )}

            {customRules.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2 border-b border-warm-border last:border-0">
                <span className="text-sm font-medium text-charcoal flex-1">{r.name}</span>
                <span className="text-xs text-text-secondary">
                  {Object.entries(r.config ?? {}).map(([k, v]) => {
                    const entity = isSpa ? SPA_LOCATIONS.find(l => l.key === k) : AESTH_DEPTS.find(d => d.key === k);
                    return `${entity?.label ?? k}: ${v}%`;
                  }).join(" · ")}
                </span>
                <button onClick={() => deleteMut.mutate(r.id)} disabled={deleteMut.isPending}
                  className="p-1 text-text-secondary hover:text-red-500 transition-colors" title="Delete rule">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {showForm && (
              <div className="mt-3 p-4 border border-warm-border rounded-lg bg-warm-gray space-y-3">
                <input className="w-full text-sm border border-warm-border rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                  placeholder={isSpa ? "Rule name (e.g. Hotel shared costs)" : "Rule name (e.g. 70/30 Aesthetics-Slimming)"}
                  value={newName} onChange={e => setNewName(e.target.value)} />
                <div className={`grid gap-2 ${isSpa ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2"}`}>
                  {(isSpa ? SPA_LOCATIONS : AESTH_DEPTS).map(loc => (
                    <div key={loc.key} className="flex flex-col gap-1">
                      <label className="text-[11px] text-text-secondary">{loc.label}</label>
                      <div className="flex items-center gap-1">
                        <input type="number" min="0" max="100" step="0.5"
                          className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                          placeholder="0" value={newPct[loc.key] ?? ""}
                          onChange={e => setNewPct(p => ({ ...p, [loc.key]: e.target.value }))} />
                        <span className="text-xs text-text-secondary">%</span>
                      </div>
                    </div>
                  ))}
                </div>
                {formErr && <p className="text-xs text-red-500">{formErr}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setShowForm(false); setFormErr(""); }}
                    className="px-3 py-1.5 text-xs rounded-md border border-warm-border text-text-secondary hover:bg-white transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleCreate} disabled={!newName.trim() || createMut.isPending}
                    className="px-3 py-1.5 text-xs rounded-md bg-gold text-white hover:bg-gold/90 disabled:opacity-50 transition-colors">
                    {createMut.isPending ? "Saving…" : "Save rule"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CoaTableRow({ row, rules, onSave, hidesSplitRule = false }: {
  row: CoaRow;
  rules: SplitRule[];
  onSave: (id: number, field: "ebitda_line" | "split_rule_id", value: string | number | null) => void;
  hidesSplitRule?: boolean;
}) {
  const isExcluded = row.ebitda_line === "excluded";
  const isMapped   = !!row.ebitda_line && (isExcluded || hidesSplitRule || !!row.split_rule_id);
  return (
    <tr className={`border-b border-warm-border hover:bg-warm-gray/30 transition-colors ${!isMapped ? "bg-amber-50/40" : ""}`}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isMapped ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
          <span className="text-sm text-charcoal">{row.account_name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-text-secondary font-mono">{row.account_code}</td>
      <td className="px-4 py-2.5 text-xs text-text-secondary">{row.account_type ?? "—"}</td>
      <td className="px-4 py-2.5">
        <select className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full"
          value={row.ebitda_line ?? ""} onChange={e => onSave(row.id, "ebitda_line", e.target.value || null)}>
          <option value="">— select —</option>
          {EBITDA_LINES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </td>
      {!hidesSplitRule && (
        <td className="px-4 py-2.5">
          {isExcluded ? (
            <span className="text-xs text-text-secondary italic">— not required —</span>
          ) : (
            <select className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full"
              value={row.split_rule_id ?? ""} onChange={e => onSave(row.id, "split_rule_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— select —</option>
              <optgroup label="System rules">
                {rules.filter(r => r.is_system && r.rule_type !== "direct").map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </optgroup>
              {rules.filter(r => !r.is_system).length > 0 && (
                <optgroup label="Custom rules">
                  {rules.filter(r => !r.is_system).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              )}
            </select>
          )}
        </td>
      )}
    </tr>
  );
}

function CoaMappingSection() {
  const [org, setOrg]         = useState<"spa" | "aesthetics">("spa");
  const [filter, setFilter]   = useState<"all" | "unmapped">("all");
  const [search, setSearch]   = useState("");
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const qc = useQueryClient();

  const { data: rules = [], isLoading: rulesLoading } = useQuery<SplitRule[]>({
    queryKey: ["split-rules", org],
    queryFn: () => apiFetch(`/api/settings/split-rules?org=${org}`),
  });

  const { data: rows = [], isLoading: coaLoading } = useQuery<CoaRow[]>({
    queryKey: ["coa-mapping", org, filter, search],
    queryFn: () => apiFetch(`/api/settings/coa-mapping?org=${org}&filter=${filter}&q=${encodeURIComponent(search)}`),
    staleTime: 0,
  });

  const unmappedCount = rows.filter(r => !r.ebitda_line || (r.ebitda_line !== "excluded" && !r.split_rule_id)).length;

  const patchMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/coa-mapping", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (updated: CoaRow) => {
      qc.setQueryData<CoaRow[]>(["coa-mapping", org, filter, search], old => old?.map(r => r.id === updated.id ? updated : r) ?? []);
    },
  });

  const handleSave = useCallback(
    (id: number, field: "ebitda_line" | "split_rule_id", value: string | number | null) => { patchMut.mutate({ id, [field]: value }); },
    [patchMut]
  );

  const syncMut = useMutation({
    mutationFn: () => apiFetch("/api/settings/coa-mapping/sync", { method: "POST", body: JSON.stringify({ org }) }),
    onSuccess: (d) => {
      setSyncMsg({ ok: true, text: `Synced ${d.synced} accounts from Zoho. ${d.unmapped} unmapped.` });
      qc.invalidateQueries({ queryKey: ["coa-mapping", org] });
    },
    onError: (e: Error) => setSyncMsg({ ok: false, text: e.message }),
  });

  const seedMut = useMutation({
    mutationFn: () => apiFetch("/api/settings/coa-mapping/seed", { method: "POST", body: JSON.stringify({ org }) }),
    onSuccess: (d) => {
      setSyncMsg({ ok: true, text: `Applied mapping & split rules: ${d.updated ?? 0} updated, ${d.inserted ?? 0} newly added.` });
      qc.invalidateQueries({ queryKey: ["coa-mapping", org] });
    },
    onError: (e: Error) => setSyncMsg({ ok: false, text: e.message }),
  });

  const isBusy = rulesLoading || coaLoading;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-secondary mt-0.5">
          Map each Zoho Books income/expense account to an EBITDA line and cost split rule.
        </p>
        <div className="flex items-center gap-1 border border-warm-border rounded-lg p-0.5 bg-warm-white shrink-0">
          {([
            { key: "spa",        label: "SPA" },
            { key: "aesthetics", label: "Aesthetics & Slimming" },
          ] as { key: "spa" | "aesthetics"; label: string }[]).map(tab => (
            <button key={tab.key} onClick={() => { setOrg(tab.key); setFilter("all"); setSearch(""); setSyncMsg(null); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${tab.key === org ? "bg-gold text-white" : "text-text-secondary hover:bg-warm-gray"}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <SplitRulesPanel org={org} rules={rules} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-warm-border bg-warm-white">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <input className="text-sm border border-warm-border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full max-w-xs"
              placeholder="Search accounts…" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="flex items-center gap-1 border border-warm-border rounded-md p-0.5">
              {[
                { key: "all",      label: "All" },
                { key: "unmapped", label: `Unmapped${unmappedCount > 0 ? ` (${unmappedCount})` : ""}` },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key as "all" | "unmapped")}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${filter === f.key ? "bg-charcoal text-white" : "text-text-secondary hover:bg-warm-gray"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            {syncMsg && (
              <span className={`text-xs px-2 py-1 rounded-md ${syncMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>{syncMsg.text}</span>
            )}
            <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-warm-border rounded-md text-text-secondary hover:bg-warm-gray transition-colors disabled:opacity-50">
              {seedMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Apply Mapping & Split Rules
            </button>
            <button onClick={() => { setSyncMsg(null); syncMut.mutate(); }} disabled={syncMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors disabled:opacity-50">
              {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync from Zoho
            </button>
          </div>
        </div>

        {isBusy ? (
          <div className="flex items-center justify-center py-16 text-text-secondary gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="h-12 w-12 rounded-full bg-warm-gray flex items-center justify-center">
              <Settings2 className="h-6 w-6 text-text-secondary" />
            </div>
            <div>
              <p className="font-semibold text-charcoal">No accounts yet</p>
              <p className="text-sm text-text-secondary mt-1">
                Click <strong>Apply Mapping</strong> to load defaults, or <strong>Sync from Zoho</strong> once credentials are configured.
              </p>
            </div>
            <button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors">
              {seedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Apply Mapping & Split Rules
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-warm-border bg-warm-gray/50">
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">Account Name</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">Code</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">Type</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">EBITDA Line</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">Split Rule</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => <CoaTableRow key={row.id} row={row} rules={rules} onSave={handleSave} />)}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="px-5 py-3 border-t border-warm-border bg-warm-white text-xs text-text-secondary flex items-center gap-3">
            <span>{rows.length} accounts shown</span>
            {unmappedCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertCircle className="h-3.5 w-3.5" />{unmappedCount} need mapping
              </span>
            )}
            {patchMut.isPending && (
              <span className="flex items-center gap-1 text-blue-600 ml-auto">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE MAPPING
// ══════════════════════════════════════════════════════════════════════════════

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

function normalizeKey(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function ContactImportSection({
  title, subtitle, apiEndpoint, cacheKey, emptyMessage, showDelete = false, noCache = false, roleByContact, setRole,
}: {
  title: string;
  subtitle: string;
  apiEndpoint: string;
  cacheKey: string;
  emptyMessage: string;
  showDelete?: boolean;
  noCache?: boolean;
  roleByContact: Map<string, WageRole>;
  setRole: ReturnType<typeof useWageRoles>["setRole"];
}) {
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
      const key = normalizeKey(c.contact_name);
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
    } finally { setIsImporting(false); }
  }

  function saveOne(contactName: string) {
    const role = mergedRoles[contactName];
    setRole.mutate({ contactName, role: (role || null) as WageRole | null });
  }

  function deleteRow(contactName: string) {
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
    } finally { setIsSavingAll(false); }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <button onClick={handleLoad} disabled={isImporting}
          className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
          {isImporting && <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>}
          {isImporting ? "Loading…" : "Load Contacts from Zoho (Jan 2025 – Jun 2026)"}
        </button>
      </div>

      {importError && <div className="px-4 py-3 text-sm text-red-700 bg-red-50/60 border-b border-red-200">{importError}</div>}
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
                        <span className="ml-2 inline-flex items-center rounded-sm border border-green-300 bg-green-50 px-1 py-px text-[9px] font-medium text-green-700">mapped</span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-muted-foreground">{orgsLabel(c.orgs)}</td>
                    <td className="py-1.5 px-4">
                      <select value={mergedRoles[c.contact_name] ?? ""}
                        onChange={(ev) => setLocalRoles((prev) => ({ ...prev, [c.contact_name]: ev.target.value as WageRole | "" }))}
                        disabled={setRole.isPending}
                        className={`text-xs border rounded px-2 py-1 bg-background disabled:opacity-50 ${draftRoles[c.contact_name] ? "border-border text-foreground" : "border-amber-400 text-amber-700"}`}>
                        <option value="">Unassigned</option>
                        {WAGE_ROLES.map((r) => <option key={r} value={r}>{WAGE_ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => saveOne(c.contact_name)} disabled={setRole.isPending}
                          className="text-xs border border-border rounded px-2 py-1 hover:bg-muted/50 disabled:opacity-50 transition-colors">Save</button>
                        {showDelete && (
                          <button onClick={() => deleteRow(c.contact_name)}
                            className="text-xs border border-red-200 text-red-600 rounded px-2 py-1 hover:bg-red-50 transition-colors">✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button onClick={saveAll} disabled={isSavingAll}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
              {isSavingAll ? "Saving…" : "Save All"}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

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
  const [data, setData]         = useState<SalaryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState("2025-01");
  const [toMonth, setToMonth]   = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  async function handleLoad() {
    setIsLoading(true); setError(null);
    try {
      const dateFrom = `${fromMonth}-01`;
      const [toY, toM] = toMonth.split("-").map(Number);
      const lastDay = new Date(toY, toM, 0).getDate();
      const dateTo  = `${toMonth}-${String(lastDay).padStart(2, "0")}`;
      const res = await fetch(`/api/settings/salary-monthly?date_from=${dateFrom}&date_to=${dateTo}`);
      if (!res.ok) { const text = await res.text().catch(() => res.statusText); throw new Error(`Server error ${res.status}: ${text}`); }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setIsLoading(false); }
  }

  const grandTotal = data?.employees.reduce((s, e) => s + e.total, 0) ?? 0;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-foreground">Salary Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monthly wages + supplements per employee by org — {fmtMonthFull(fromMonth)} to {fmtMonthFull(toMonth)}.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <label className="text-xs text-muted-foreground">From</label>
          <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground">
            {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="text-xs text-muted-foreground">To</label>
          <select value={toMonth} onChange={(e) => setToMonth(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground">
            {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={handleLoad} disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
            {isLoading && <svg className="animate-spin h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>}
            {isLoading ? "Loading…" : "Load Salary Breakdown"}
          </button>
        </div>
      </div>

      {error && <div className="px-4 py-3 text-sm text-red-700 bg-red-50/60 border-b border-red-200">{error}</div>}
      {data && data.employees.length === 0 && (
        <div className="px-4 py-6 text-sm text-center text-muted-foreground">No salary transactions found for the selected period.</div>
      )}
      {data && data.employees.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sticky left-0 bg-background z-10 min-w-[180px]">Employee</th>
                <th className="text-left py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[90px]">Org</th>
                <th className="text-left py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[110px]">Source / COA</th>
                {data.months.map((m) => (
                  <th key={m} className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[72px]">{fmtMonth(m)}</th>
                ))}
                <th className="text-right py-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((emp) => (
                <tr key={`${emp.contact_name}|${emp.org}`} className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-1.5 px-4 text-foreground sticky left-0 bg-background z-10 whitespace-nowrap">{emp.contact_name}</td>
                  <td className="py-1.5 px-4 text-xs text-muted-foreground whitespace-nowrap">{orgLabel(emp.org)}</td>
                  <td className="py-1.5 px-3 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex gap-1 flex-wrap">
                        {emp.coa_codes.length > 0 && <span className="inline-flex items-center rounded-sm bg-blue-50 border border-blue-200 px-1 py-px text-[9px] font-medium text-blue-700">Zoho</span>}
                        {emp.has_supplement && <span className="inline-flex items-center rounded-sm bg-amber-50 border border-amber-200 px-1 py-px text-[9px] font-medium text-amber-700">Supp</span>}
                      </div>
                      {emp.coa_codes.length > 0 && <span className="text-[10px] text-muted-foreground tabular-nums leading-tight">{emp.coa_codes.join(", ")}</span>}
                    </div>
                  </td>
                  {data.months.map((m) => (
                    <td key={m} className="py-1.5 px-3 text-right text-xs tabular-nums whitespace-nowrap">
                      {emp.monthly[m] ? <span className="text-foreground">{fmtAmount(emp.monthly[m])}</span> : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  ))}
                  <td className="py-1.5 px-4 text-right text-xs tabular-nums font-semibold text-foreground whitespace-nowrap">{fmtAmount(emp.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/20">
                <td colSpan={3} className="py-2 px-4 text-xs font-medium text-muted-foreground sticky left-0 bg-muted/20 z-10">Monthly total</td>
                {data.months.map((m) => {
                  const monthTotal = data.employees.reduce((s, e) => s + (e.monthly[m] ?? 0), 0);
                  return (
                    <td key={m} className="py-2 px-3 text-right text-xs tabular-nums font-medium text-foreground whitespace-nowrap">
                      {monthTotal > 0 ? fmtAmount(monthTotal) : <span className="text-muted-foreground/30">—</span>}
                    </td>
                  );
                })}
                <td className="py-2 px-4 text-right text-xs tabular-nums font-bold text-foreground whitespace-nowrap">{fmtAmount(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function EmployeeMappingSection() {
  const { roleByContact, setRole } = useWageRoles();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Assign each employee a role (Manager, Reception, Practitioner, CRM). The EBITDA cockpit&apos;s
        Wages &amp; Salaries row uses these mappings to break payroll down by role for the selected period.
        Unassigned employees are counted separately. Employees are loaded from the last 2 years of payroll data.
      </p>
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

// ══════════════════════════════════════════════════════════════════════════════
// SALARY SUPPLEMENT
// ══════════════════════════════════════════════════════════════════════════════

interface SupplementRow {
  id: number;
  month: string;
  employee_name: string;
  talexio_id: number | null;
  talexio_name: string | null;
  amount: number;
  spa_slug: string | null;
  role: string | null;
  is_frozen: boolean;
  synced_at: string;
}

const SPA_OPTIONS = [
  { slug: "inter",      label: "InterContinental" },
  { slug: "hugos",      label: "Hugos" },
  { slug: "hyatt",      label: "Hyatt" },
  { slug: "ramla",      label: "Ramla Bay" },
  { slug: "labranda",   label: "Riviera" },
  { slug: "odycy",      label: "Sunny Coast" },
  { slug: "excelsior",  label: "Excelsior" },
  { slug: "novotel",    label: "Novotel" },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "slimming",   label: "Slimming" },
  { slug: "hq",         label: "HQ" },
];

const SPA_LABEL: Record<string, string> = Object.fromEntries(SPA_OPTIONS.map((s) => [s.slug, s.label]));

const ROLE_OPTIONS = [
  { value: "manager",      label: "Manager" },
  { value: "reception",    label: "Reception" },
  { value: "practitioner", label: "Practitioner" },
  { value: "therapist",    label: "Therapist" },
  { value: "crm",          label: "CRM" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));

function availableMonths(): { value: string; label: string }[] {
  const months = [];
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const start = new Date(2025, 0, 1);
  const d = new Date(start);
  while (d <= end) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const value = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    months.unshift({ value, label });
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function fmtCurrency(n: number) {
  if (!Number.isFinite(n)) return "€0.0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}€${(abs / 1_000).toFixed(1)}K`;
  return `${sign}€${abs.toFixed(1)}`;
}

function SalarySupplementSection() {
  const [month, setMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const months = availableMonths();

  const { data: rows = [], isFetching } = useQuery<SupplementRow[]>({
    queryKey: ["salary-supplement", month],
    queryFn: () => apiFetch(`/api/settings/salary-supplement?month=${month}`),
    staleTime: 0,
  });

  const isFrozen      = rows.length > 0 && rows.every((r) => r.is_frozen);
  const unassigned    = rows.filter((r) => !r.spa_slug);
  const unassignedRole = rows.filter((r) => !r.role);
  const total         = rows.reduce((s, r) => s + Number(r.amount), 0);

  const spaTotals = SPA_OPTIONS.map((spa) => ({
    ...spa,
    total: rows.filter((r) => r.spa_slug === spa.slug).reduce((s, r) => s + Number(r.amount), 0),
  })).filter((s) => s.total > 0);

  const syncMutation = useMutation({
    mutationFn: () => apiFetch("/api/settings/salary-supplement/sync", { method: "POST", body: JSON.stringify({ month }) }),
    onSuccess: (data) => {
      setSyncError(null);
      queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] });
      if (data.excluded?.length) console.info("Excluded (not SPA):", data.excluded);
    },
    onError: (e: Error) => setSyncError(e.message),
  });

  const updateSpa = useMutation({
    mutationFn: ({ id, spa_slug }: { id: number; spa_slug: string | null }) =>
      apiFetch("/api/settings/salary-supplement", { method: "PATCH", body: JSON.stringify({ id, spa_slug }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string | null }) =>
      apiFetch("/api/settings/salary-supplement", { method: "PATCH", body: JSON.stringify({ id, role }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  const freezeMutation = useMutation({
    mutationFn: () => apiFetch("/api/settings/salary-supplement", { method: "PATCH", body: JSON.stringify({ month, freeze: true }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  const unfreezeMutation = useMutation({
    mutationFn: () => apiFetch("/api/settings/salary-supplement", { method: "PATCH", body: JSON.stringify({ month, freeze: false }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  const handleSpaChange  = useCallback((id: number, slug: string) => updateSpa.mutate({ id, spa_slug: slug || null }), [updateSpa]);
  const handleRoleChange = useCallback((id: number, role: string) => updateRole.mutate({ id, role: role || null }), [updateRole]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Additional salary not in Zoho — synced from Google Sheets, added to EBITDA wages.
        </p>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setSyncError(null); }}
          className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || isFrozen}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {syncMutation.isPending ? "Syncing…" : "Sync from Sheet"}
        </button>
        {rows.length > 0 && !isFrozen && (
          <button onClick={() => freezeMutation.mutate()}
            disabled={freezeMutation.isPending || unassigned.length > 0}
            title={unassigned.length > 0 ? "Assign all spas before freezing" : undefined}
            className="text-sm px-4 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors">
            {freezeMutation.isPending ? "Saving…" : "Save & Freeze"}
          </button>
        )}
        {isFrozen && (
          <>
            <span className="text-sm text-emerald-600 font-medium">✓ Frozen — included in EBITDA wages</span>
            <button onClick={() => unfreezeMutation.mutate()} disabled={unfreezeMutation.isPending}
              className="text-sm px-4 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors">
              {unfreezeMutation.isPending ? "Unlocking…" : "Edit"}
            </button>
          </>
        )}
        {syncError && <span className="text-sm text-red-600">{syncError}</span>}
      </div>

      {isFetching && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isFetching && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No data for this month yet.{" "}
          <button className="underline text-primary" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            Sync from Sheet
          </button>{" "}
          to import active employees with additional salary.
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Employee</th>
                <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground">Amount</th>
                <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Allocated To</th>
                <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Designation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-4 text-foreground">{row.employee_name}</td>
                  <td className="py-2 px-4 text-right font-medium text-foreground">{fmtCurrency(row.amount)}</td>
                  <td className="py-2 px-4">
                    {isFrozen ? (
                      <span className={row.spa_slug ? "text-foreground" : "text-red-500"}>{row.spa_slug ? SPA_LABEL[row.spa_slug] : "⚠ Unassigned"}</span>
                    ) : (
                      <select value={row.spa_slug ?? ""} onChange={(e) => handleSpaChange(row.id, e.target.value)}
                        className={`text-sm border rounded px-2 py-1 bg-background ${!row.spa_slug ? "border-amber-400 text-amber-700" : "border-border text-foreground"}`}>
                        <option value="">⚠ Unassigned</option>
                        {SPA_OPTIONS.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="py-2 px-4">
                    {isFrozen ? (
                      <span className={row.role ? "text-foreground" : "text-muted-foreground"}>{row.role ? ROLE_LABEL[row.role] : "—"}</span>
                    ) : (
                      <select value={row.role ?? ""} onChange={(e) => handleRoleChange(row.id, e.target.value)}
                        className={`text-sm border rounded px-2 py-1 bg-background ${!row.role ? "border-amber-400 text-amber-700" : "border-border text-foreground"}`}>
                        <option value="">Unassigned</option>
                        {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/20">
                <td className="py-2.5 px-4 font-semibold text-foreground">Total ({rows.length} employees)</td>
                <td className="py-2.5 px-4 text-right font-bold text-foreground">{fmtCurrency(total)}</td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground">
                  {unassigned.length > 0 && <span className="text-amber-600">⚠ {unassigned.length} unassigned venue</span>}
                </td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground">
                  {unassignedRole.length > 0 && <span className="text-amber-600">⚠ {unassignedRole.length} no designation</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {spaTotals.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Supplement by Location</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {spaTotals.map((s) => (
              <div key={s.slug} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground">{fmtCurrency(s.total)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: "coa",        label: "COA Mapping"       },
  { key: "employee",   label: "Employee Mapping"   },
  { key: "supplement", label: "Salary Supplement"  },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function EbitdaMappingPage() {
  const [tab, setTab] = useState<Tab>("coa");
  return (
    <DashboardShell hideDatePicker>
      {() => (
        <div className="space-y-0">
          {/* Page header */}
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Users className="h-5 w-5 text-gold" />
              EBITDA Mapping
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Map Zoho accounts to EBITDA lines, assign employee roles, and manage salary supplements.
            </p>
          </div>

          {/* Tab bar */}
          <div className="flex gap-0 border-b border-warm-border mb-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key
                    ? "border-gold text-gold"
                    : "border-transparent text-text-secondary hover:text-charcoal"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "coa"        && <CoaMappingSection        />}
          {tab === "employee"   && <EmployeeMappingSection   />}
          {tab === "supplement" && <SalarySupplementSection  />}
        </div>
      )}
    </DashboardShell>
  );
}
