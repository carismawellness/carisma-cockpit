"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import {
  RefreshCw, Download, Plus, Trash2, ChevronDown, ChevronUp,
  CheckCircle2, AlertCircle, Settings2, Loader2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const EBITDA_LINES = [
  { value: "revenue",              label: "Revenue" },
  { value: "cogs",                 label: "COGS" },
  { value: "wages",                label: "Wages & Salaries" },
  { value: "advertising",          label: "Advertising & Marketing" },
  { value: "rent",                 label: "Rent" },
  { value: "utilities",            label: "Utilities" },
  { value: "sga_prof_services",    label: "SG&A - Prof services" },
  { value: "sga_fuel",             label: "SG&A - Fuel" },
  { value: "sga_laundry",          label: "SG&A - Laundry" },
  { value: "sga_software",         label: "SG&A - Software" },
  { value: "sga_cleaning",         label: "SG&A - Cleaning" },
  { value: "sga_travel",           label: "SG&A - Travel" },
  { value: "sga_misc",             label: "SG&A - Misc" },
  { value: "sga_insurance",        label: "SG&A - Insurance" },
  { value: "sga_events",           label: "SG&A - Events" },
  { value: "sga_maintenance",      label: "SG&A - Maintenance" },
  { value: "sga_telecom",          label: "SG&A - Telecom" },
  { value: "excluded",             label: "Excluded" },
];

const SPA_LOCATIONS: { key: string; label: string }[] = [
  { key: "inter",     label: "InterContinental" },
  { key: "hugos",     label: "Hugo's" },
  { key: "hyatt",     label: "Hyatt" },
  { key: "ramla",     label: "Ramla" },
  { key: "labranda",  label: "Labranda" },
  { key: "odycy",     label: "Sunny Coast" },
  { key: "excelsior", label: "Excelsior" },
  { key: "novotel",   label: "Novotel" },
];

const AESTH_DEPTS: { key: string; label: string }[] = [
  { key: "aesthetics", label: "Aesthetics" },
  { key: "slimming",   label: "Slimming"   },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: fetch wrapper
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(url: string, opts?: RequestInit) {
  const r = await fetch(url, opts);
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

// ─────────────────────────────────────────────────────────────────────────────
// Split Rules Manager panel
// ─────────────────────────────────────────────────────────────────────────────
function SplitRulesPanel({ org, rules }: { org: "spa" | "aesthetics"; rules: SplitRule[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPct, setNewPct] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const isSpa = org === "spa";

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/settings/split-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["split-rules", org] }),
  });

  const createMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/split-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["split-rules", org] });
      setShowForm(false);
      setNewName("");
      setNewPct({});
      setFormErr("");
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
    if (Math.abs(total - 100) > 0.01) {
      setFormErr(`Percentages must sum to 100 (currently ${total.toFixed(1)})`);
      return;
    }
    createMut.mutate({ name: newName, zoho_org: org, config });
  }

  const customRules = rules.filter(r => !r.is_system);

  return (
    <div className="border border-warm-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-warm-white hover:bg-warm-gray transition-colors text-sm font-semibold text-charcoal"
      >
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
          {/* System rules (read-only) */}
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

          {/* Custom rules — SPA only (Aesthetics & Slimming is one entity, no location split) */}
          {isSpa && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Custom rules</p>
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-1 text-xs font-medium text-gold hover:text-gold/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add rule
                </button>
              </div>

              {customRules.length === 0 && !showForm && (
                <p className="text-xs text-text-secondary italic">No custom rules yet. Add one to define a fixed % split across locations.</p>
              )}

              {customRules.map(r => (
                <div key={r.id} className="flex items-center gap-3 py-2 border-b border-warm-border last:border-0">
                  <span className="text-sm font-medium text-charcoal flex-1">{r.name}</span>
                  <span className="text-xs text-text-secondary">
                    {Object.entries(r.config ?? {}).map(([k, v]) => {
                      const loc = SPA_LOCATIONS.find(l => l.key === k);
                      return `${loc?.label ?? k}: ${v}%`;
                    }).join(" · ")}
                  </span>
                  <button
                    onClick={() => deleteMut.mutate(r.id)}
                    disabled={deleteMut.isPending}
                    className="p-1 text-text-secondary hover:text-red-500 transition-colors"
                    title="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {showForm && (
                <div className="mt-3 p-4 border border-warm-border rounded-lg bg-warm-gray space-y-3">
                  <input
                    className="w-full text-sm border border-warm-border rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                    placeholder="Rule name (e.g. Hotel shared costs)"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {SPA_LOCATIONS.map(loc => (
                      <div key={loc.key} className="flex flex-col gap-1">
                        <label className="text-[11px] text-text-secondary">{loc.label}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                            placeholder="0"
                            value={newPct[loc.key] ?? ""}
                            onChange={e => setNewPct(p => ({ ...p, [loc.key]: e.target.value }))}
                          />
                          <span className="text-xs text-text-secondary">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {formErr && <p className="text-xs text-red-500">{formErr}</p>}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setShowForm(false); setFormErr(""); }}
                      className="px-3 py-1.5 text-xs rounded-md border border-warm-border text-text-secondary hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim() || createMut.isPending}
                      className="px-3 py-1.5 text-xs rounded-md bg-gold text-white hover:bg-gold/90 disabled:opacity-50 transition-colors"
                    >
                      {createMut.isPending ? "Saving…" : "Save rule"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!isSpa && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Custom rules</p>
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-1 text-xs font-medium text-gold hover:text-gold/80 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add rule
                </button>
              </div>

              {customRules.length === 0 && !showForm && (
                <p className="text-xs text-text-secondary italic">
                  No custom rules yet. Add one to define a fixed % split between Aesthetics and Slimming.
                </p>
              )}

              {customRules.map(r => (
                <div key={r.id} className="flex items-center gap-3 py-2 border-b border-warm-border last:border-0">
                  <span className="text-sm font-medium text-charcoal flex-1">{r.name}</span>
                  <span className="text-xs text-text-secondary">
                    {Object.entries(r.config ?? {}).map(([k, v]) => {
                      const dept = AESTH_DEPTS.find(d => d.key === k);
                      return `${dept?.label ?? k}: ${v}%`;
                    }).join(" · ")}
                  </span>
                  <button
                    onClick={() => deleteMut.mutate(r.id)}
                    disabled={deleteMut.isPending}
                    className="p-1 text-text-secondary hover:text-red-500 transition-colors"
                    title="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {showForm && (
                <div className="mt-3 p-4 border border-warm-border rounded-lg bg-warm-gray space-y-3">
                  <input
                    className="w-full text-sm border border-warm-border rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                    placeholder="Rule name (e.g. 70/30 Aesthetics-Slimming)"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    {AESTH_DEPTS.map(dept => (
                      <div key={dept.key} className="flex flex-col gap-1">
                        <label className="text-[11px] text-text-secondary">{dept.label}</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
                            placeholder="0"
                            value={newPct[dept.key] ?? ""}
                            onChange={e => setNewPct(p => ({ ...p, [dept.key]: e.target.value }))}
                          />
                          <span className="text-xs text-text-secondary">%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {formErr && <p className="text-xs text-red-500">{formErr}</p>}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setShowForm(false); setFormErr(""); }}
                      className="px-3 py-1.5 text-xs rounded-md border border-warm-border text-text-secondary hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!newName.trim() || createMut.isPending}
                      className="px-3 py-1.5 text-xs rounded-md bg-gold text-white hover:bg-gold/90 disabled:opacity-50 transition-colors"
                    >
                      {createMut.isPending ? "Saving…" : "Save rule"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COA Table row
// ─────────────────────────────────────────────────────────────────────────────
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
          {isMapped
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            : <AlertCircle  className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          }
          <span className="text-sm text-charcoal">{row.account_name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-text-secondary font-mono">{row.account_code}</td>
      <td className="px-4 py-2.5 text-xs text-text-secondary">{row.account_type ?? "—"}</td>
      <td className="px-4 py-2.5">
        <select
          className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full"
          value={row.ebitda_line ?? ""}
          onChange={e => onSave(row.id, "ebitda_line", e.target.value || null)}
        >
          <option value="">— select —</option>
          {EBITDA_LINES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </td>
      {!hidesSplitRule && (
        <td className="px-4 py-2.5">
          {isExcluded ? (
            <span className="text-xs text-text-secondary italic">— not required —</span>
          ) : (
            <select
              className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full"
              value={row.split_rule_id ?? ""}
              onChange={e => onSave(row.id, "split_rule_id", e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— select —</option>
              <optgroup label="System rules">
                {rules.filter(r => r.is_system && r.rule_type !== "direct").map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
              {rules.filter(r => !r.is_system).length > 0 && (
                <optgroup label="Custom rules">
                  {rules.filter(r => !r.is_system).map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </td>
      )}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function CoaMappingPage() {
  const [org, setOrg]    = useState<"spa" | "aesthetics" | "hq">("spa");
  const [filter, setFilter] = useState<"all" | "unmapped">("all");
  const [search, setSearch]  = useState("");
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

  const unmappedCount = rows.filter(r =>
    !r.ebitda_line || (r.ebitda_line !== "excluded" && org !== "hq" && !r.split_rule_id)
  ).length;

  const patchMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/coa-mapping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (updated: CoaRow) => {
      qc.setQueryData<CoaRow[]>(["coa-mapping", org, filter, search], old =>
        old?.map(r => r.id === updated.id ? updated : r) ?? []
      );
    },
  });

  const handleSave = useCallback(
    (id: number, field: "ebitda_line" | "split_rule_id", value: string | number | null) => {
      patchMut.mutate({ id, [field]: value });
    },
    [patchMut]
  );

  const syncMut = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/coa-mapping/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org }),
      }),
    onSuccess: (d) => {
      setSyncMsg({ ok: true, text: `Synced ${d.synced} accounts from Zoho. ${d.unmapped} unmapped.` });
      qc.invalidateQueries({ queryKey: ["coa-mapping", org] });
    },
    onError: (e: Error) => setSyncMsg({ ok: false, text: e.message }),
  });

  const seedMut = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/coa-mapping/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org }),
      }),
    onSuccess: (d) => {
      setSyncMsg({ ok: true, text: `Applied mapping & split rules: ${d.updated ?? 0} updated, ${d.inserted ?? 0} newly added.` });
      qc.invalidateQueries({ queryKey: ["coa-mapping", org] });
    },
    onError: (e: Error) => setSyncMsg({ ok: false, text: e.message }),
  });

  const isBusy = rulesLoading || coaLoading;

  return (
    <DashboardShell>
      {() => (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-charcoal">COA Mapping</h1>
              <p className="text-sm text-text-secondary mt-0.5">
                Map each Zoho Books income/expense account to an EBITDA line and cost split rule.
              </p>
            </div>
            {/* Org tabs */}
            <div className="flex items-center gap-1 border border-warm-border rounded-lg p-0.5 bg-warm-white shrink-0">
              {([
                { key: "spa",        label: "SPA" },
                { key: "aesthetics", label: "Aesthetics & Slimming" },
                { key: "hq",         label: "HQ" },
              ] as { key: "spa" | "aesthetics" | "hq"; label: string }[]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setOrg(tab.key); setFilter("all"); setSearch(""); setSyncMsg(null); }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    tab.key === org
                      ? "bg-gold text-white"
                      : "text-text-secondary hover:bg-warm-gray"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Split Rules Panel — not applicable for HQ (no distribution) */}
          {org !== "hq" && <SplitRulesPanel org={org as "spa" | "aesthetics"} rules={rules} />}

          {/* COA Table Card */}
          <Card className="overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-warm-border bg-warm-white">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <input
                  className="text-sm border border-warm-border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 w-full max-w-xs"
                  placeholder="Search accounts…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className="flex items-center gap-1 border border-warm-border rounded-md p-0.5">
                  {[
                    { key: "all",      label: "All" },
                    { key: "unmapped", label: `Unmapped${unmappedCount > 0 ? ` (${unmappedCount})` : ""}` },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key as "all" | "unmapped")}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        filter === f.key
                          ? "bg-charcoal text-white"
                          : "text-text-secondary hover:bg-warm-gray"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {syncMsg && (
                  <span className={`text-xs px-2 py-1 rounded-md ${syncMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {syncMsg.text}
                  </span>
                )}
                <button
                  onClick={() => seedMut.mutate()}
                  disabled={seedMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-warm-border rounded-md text-text-secondary hover:bg-warm-gray transition-colors disabled:opacity-50"
                  title="Assign EBITDA line and split rule to all accounts from the approved COA mapping. Also inserts any accounts missing from the DB."
                >
                  {seedMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Apply Mapping & Split Rules
                </button>
                <button
                  onClick={() => { setSyncMsg(null); syncMut.mutate(); }}
                  disabled={syncMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors disabled:opacity-50"
                  title="Pull latest Chart of Accounts from Zoho Books"
                >
                  {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync from Zoho
                </button>
              </div>
            </div>

            {/* Table */}
            {isBusy ? (
              <div className="flex items-center justify-center py-16 text-text-secondary gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
                <div className="h-12 w-12 rounded-full bg-warm-gray flex items-center justify-center">
                  <Settings2 className="h-6 w-6 text-text-secondary" />
                </div>
                <div>
                  <p className="font-semibold text-charcoal">No accounts yet</p>
                  <p className="text-sm text-text-secondary mt-1">
                    Click <strong>Import defaults</strong> to load the approved mapping, or <strong>Sync from Zoho</strong> once credentials are configured.
                  </p>
                </div>
                <button
                  onClick={() => seedMut.mutate()}
                  disabled={seedMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors"
                >
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
                      {org !== "hq" && <th className="px-4 py-2.5 text-xs font-semibold text-text-secondary uppercase tracking-wide">Split Rule</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <CoaTableRow
                        key={row.id}
                        row={row}
                        rules={rules}
                        onSave={handleSave}
                        hidesSplitRule={org === "hq"}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer count */}
            {rows.length > 0 && (
              <div className="px-5 py-3 border-t border-warm-border bg-warm-white text-xs text-text-secondary flex items-center gap-3">
                <span>{rows.length} accounts shown</span>
                {unmappedCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {unmappedCount} need mapping
                  </span>
                )}
                {patchMut.isPending && (
                  <span className="flex items-center gap-1 text-blue-600 ml-auto">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </span>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </DashboardShell>
  );
}
