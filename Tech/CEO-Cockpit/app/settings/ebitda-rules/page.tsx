"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, Trash2, ToggleLeft, ToggleRight, Pencil, Check, X,
  Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";

// ── Shared helper ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ══════════════════════════════════════════════════════════════════════════════
// HARDCODED RULES  (special persons · hardwired venue rules · cost floor)
// ══════════════════════════════════════════════════════════════════════════════

type SpecialPerson = {
  id: string;
  contact_key: string;
  display_name: string;
  active: boolean;
};

type CogsContact = {
  id: string;
  contact_key: string;
  display_name: string;
  active: boolean;
};

type HardwiredRule = {
  id: string;
  venue: string;
  ebitda_line: string;
  rule_type: string;
  params: Record<string, number>;
  effective_from: string;
  effective_to?: string;
  note?: string;
};

type CostFloorRule = {
  id: number;
  account_code: string;
  account_name: string;
  rule_type: string;
  active: boolean;
  params: Record<string, unknown>;
};

function ruleTypeLabel(rule_type: string): string {
  return ({
    fixed_monthly:         "Fixed monthly amount",
    base_plus_revenue_pct: "Base + % of revenue",
    skip:                  "Skip (no Zoho data)",
  } as Record<string, string>)[rule_type] ?? rule_type;
}

function paramsDisplay(rule_type: string, params: Record<string, number>): string {
  if (rule_type === "fixed_monthly")
    return `€${(params.monthly_amount ?? 0).toLocaleString()}/mo`;
  if (rule_type === "base_plus_revenue_pct")
    return `€${(params.base_monthly ?? 0).toLocaleString()} base + ${params.revenue_pct ?? 0}% revenue`;
  return "—";
}

function venueLabel(params: Record<string, unknown>): string {
  if (params.venue) return String(params.venue).replace(/_/g, " ");
  if (Array.isArray(params.venues)) return (params.venues as string[]).map(v => v.replace(/_/g, " ")).join(", ");
  return "—";
}

function HardcodedRulesSection() {
  const [persons, setPersons]           = useState<SpecialPerson[]>([]);
  const [cogsContacts, setCogsContacts] = useState<CogsContact[]>([]);
  const [rules, setRules]               = useState<HardwiredRule[]>([]);
  const [fallback, setFallback]         = useState<CostFloorRule[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [showAdd, setShowAdd]           = useState(false);
  const [newKey, setNewKey]             = useState("");
  const [newName, setNewName]           = useState("");
  const [saving, setSaving]             = useState(false);

  const [showAddCogs, setShowAddCogs]   = useState(false);
  const [newCogsKey, setNewCogsKey]     = useState("");
  const [newCogsName, setNewCogsName]   = useState("");
  const [savingCogs, setSavingCogs]     = useState(false);

  const [editRuleId, setEditRuleId]     = useState<string | null>(null);
  const [editNote, setEditNote]         = useState("");

  const [editFloorId, setEditFloorId]   = useState<number | null>(null);
  const [editFloorAmt, setEditFloorAmt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/settings/ebitda-v2-rules");
    if (!res.ok) { setError("Failed to load"); setLoading(false); return; }
    const data = await res.json();
    setPersons(data.special_persons ?? []);
    setCogsContacts(data.cogs_contacts ?? []);
    setRules(data.hardwired_rules ?? []);
    setFallback(data.fallback_rules ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/settings/ebitda-v2-rules", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? "Request failed");
    }
    return res.json();
  }

  async function addPerson() {
    if (!newKey.trim() || !newName.trim()) return;
    setSaving(true);
    try {
      await post({ action: "add_person", contact_key: newKey.trim(), display_name: newName.trim() });
      setNewKey(""); setNewName(""); setShowAdd(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally { setSaving(false); }
  }

  async function togglePerson(id: string, active: boolean) {
    await post({ action: "toggle_person", id, active });
    await load();
  }

  async function deletePerson(id: string) {
    if (!confirm("Remove this special person?")) return;
    await post({ action: "delete_person", id });
    await load();
  }

  async function addCogsContact() {
    if (!newCogsKey.trim() || !newCogsName.trim()) return;
    setSavingCogs(true);
    try {
      await post({ action: "add_cogs_contact", contact_key: newCogsKey.trim(), display_name: newCogsName.trim() });
      setNewCogsKey(""); setNewCogsName(""); setShowAddCogs(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally { setSavingCogs(false); }
  }

  async function toggleCogsContact(id: string, active: boolean) {
    await post({ action: "toggle_cogs_contact", id, active });
    await load();
  }

  async function deleteCogsContact(id: string) {
    if (!confirm("Remove this COGS contact?")) return;
    await post({ action: "delete_cogs_contact", id });
    await load();
  }

  async function saveRuleNote(id: string) {
    await post({ action: "update_rule", id, note: editNote });
    setEditRuleId(null);
    await load();
  }

  async function saveFloor(id: number) {
    const amt = parseFloat(editFloorAmt);
    if (isNaN(amt) || amt < 0) return;
    try {
      await post({ action: "update_fallback_floor", id, monthly_amount: amt });
      setEditFloorId(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (error)   return <div className="p-8 text-sm text-destructive">{error}</div>;

  return (
    <div className="space-y-8">
      {/* ── Special Persons ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">Special Persons</h2>
            <p className="text-xs text-muted-foreground">
              Contacts always classified as Wages &amp; Salaries, regardless of which Zoho account they
              were posted to. If no venue tag is present, they default to HQ.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        </div>

        {showAdd && (
          <Card className="p-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Match key (lowercase, substring)</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="e.g. april joy banaban"
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Display name</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="April Joy Banaban"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={addPerson} disabled={saving || !newKey.trim() || !newName.trim()}>
                {saving ? "…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The match key is checked as a substring against the contact name in Zoho (case-insensitive).
            </p>
          </Card>
        )}

        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2">Display name</th>
                <th className="text-left px-4 py-2">Match key</th>
                <th className="text-center px-4 py-2 w-20">Active</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {persons.map(p => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{p.display_name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.contact_key}</td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => togglePerson(p.id, !p.active)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title={p.active ? "Disable" : "Enable"}
                    >
                      {p.active
                        ? <ToggleRight className="h-5 w-5 text-green-600" />
                        : <ToggleLeft  className="h-5 w-5" />}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => deletePerson(p.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {persons.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    No special persons defined.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ── COGS Contacts ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">COGS Contacts</h2>
            <p className="text-xs text-muted-foreground">
              Contacts always classified as COGS, regardless of which Zoho account they were posted to.
              Venue is taken from the venue tag on the transaction (e.g. POS fee charges per branch).
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowAddCogs(v => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add
          </Button>
        </div>

        {showAddCogs && (
          <Card className="p-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Match key (lowercase, substring)</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="e.g. pos fee"
                  value={newCogsKey}
                  onChange={e => setNewCogsKey(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Display name</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="POS Fee"
                  value={newCogsName}
                  onChange={e => setNewCogsName(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={addCogsContact} disabled={savingCogs || !newCogsKey.trim() || !newCogsName.trim()}>
                {savingCogs ? "…" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddCogs(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              The match key is checked as a substring against the contact name in Zoho (case-insensitive).
            </p>
          </Card>
        )}

        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2">Display name</th>
                <th className="text-left px-4 py-2">Match key</th>
                <th className="text-center px-4 py-2 w-20">Active</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {cogsContacts.map(c => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{c.display_name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.contact_key}</td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleCogsContact(c.id, !c.active)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title={c.active ? "Disable" : "Enable"}
                    >
                      {c.active
                        ? <ToggleRight className="h-5 w-5 text-green-600" />
                        : <ToggleLeft  className="h-5 w-5" />}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => deleteCogsContact(c.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {cogsContacts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    No COGS contacts defined.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* ── Hardwired Venue Rules ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-medium">Hardwired Venue Rules</h2>
          <p className="text-xs text-muted-foreground">
            Venue/line combinations where the amount is calculated by a fixed formula
            instead of (or in addition to) Zoho data.
          </p>
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2">Venue</th>
                <th className="text-left px-4 py-2">Line</th>
                <th className="text-left px-4 py-2">Rule</th>
                <th className="text-left px-4 py-2">Formula</th>
                <th className="text-left px-4 py-2">From</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium capitalize">{r.venue}</td>
                  <td className="px-4 py-2 capitalize">{r.ebitda_line}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{ruleTypeLabel(r.rule_type)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{paramsDisplay(r.rule_type, r.params)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.effective_from}</td>
                  <td className="px-4 py-2">
                    {editRuleId === r.id ? (
                      <div className="flex gap-1">
                        <input
                          className="border rounded px-1 py-0.5 text-xs w-48"
                          value={editNote}
                          onChange={e => setEditNote(e.target.value)}
                          placeholder="Note"
                        />
                        <button onClick={() => saveRuleNote(r.id)} className="text-green-600 hover:text-green-700">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditRuleId(null)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditRuleId(r.id); setEditNote(r.note ?? ""); }}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit note"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    No hardwired rules configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {rules.some(r => r.note) && (
            <div className="px-4 py-3 border-t space-y-1">
              {rules.filter(r => r.note).map(r => (
                <p key={r.id} className="text-xs text-muted-foreground">
                  <span className="font-medium capitalize">{r.venue} {r.ebitda_line}</span>: {r.note}
                </p>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ── Cost Floor Rules ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-medium">Cost Floor Rules</h2>
          <p className="text-xs text-muted-foreground">
            Minimum monthly amounts per cost account and venue. If actual Zoho spend is below
            the floor, the deficit is added automatically. Click the pencil to edit any amount.
          </p>
        </div>
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2">Account</th>
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Venue</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-right px-4 py-2">Floor / month</th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {fallback.map(r => {
                const p = r.params;
                const amt = Number(p.monthly_amount ?? 0);
                const sub = p.ebitda_sub_line ? ` · ${p.ebitda_sub_line}` : "";
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.account_code}</td>
                    <td className="px-4 py-2">{r.account_name}</td>
                    <td className="px-4 py-2 capitalize text-sm">{venueLabel(p)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground capitalize">
                      {String(p.ebitda_line ?? "—")}{sub}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {editFloorId === r.id ? (
                        <div className="flex gap-1 justify-end items-center">
                          <span className="text-muted-foreground text-xs">€</span>
                          <input
                            className="border rounded px-1 py-0.5 text-xs w-24 text-right"
                            value={editFloorAmt}
                            onChange={e => setEditFloorAmt(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveFloor(r.id); if (e.key === "Escape") setEditFloorId(null); }}
                            autoFocus
                          />
                          <button onClick={() => saveFloor(r.id)} className="text-green-600 hover:text-green-700">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setEditFloorId(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span>€{amt.toLocaleString()}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {editFloorId !== r.id && (
                        <button
                          onClick={() => { setEditFloorId(r.id); setEditFloorAmt(String(amt)); }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit floor amount"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {fallback.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    No cost floor rules defined.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FALLBACK RULES
// ══════════════════════════════════════════════════════════════════════════════

type RuleType = "ttm_spread" | "manual_annual" | "previous_month" | "quarterly_average" | "disabled";
type Org = "spa" | "aesthetics";

interface FallbackRow {
  id: number;
  zoho_org: Org;
  account_code: string;
  account_name: string;
  rule_type: RuleType;
  active: boolean;
  notes: string | null;
  params: { annual_amount?: number } | null;
  created_at: string;
  updated_at: string;
}

const ORG_OPTIONS: { value: Org; label: string }[] = [
  { value: "spa",        label: "SPA" },
  { value: "aesthetics", label: "Aesthetics" },
];

const RULE_OPTIONS: { value: RuleType; label: string }[] = [
  { value: "ttm_spread",        label: "TTM-spread" },
  { value: "manual_annual",     label: "Manual annual" },
  { value: "previous_month",    label: "Previous month" },
  { value: "quarterly_average", label: "Quarterly avg (last 3 mo)" },
  { value: "disabled",          label: "Disabled" },
];

const RULE_LABEL: Record<RuleType, string> = Object.fromEntries(
  RULE_OPTIONS.map((r) => [r.value, r.label]),
) as Record<RuleType, string>;

function AddAccountModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [zohoOrg, setZohoOrg]   = useState<Org>("spa");
  const [code, setCode]         = useState("");
  const [name, setName]         = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("ttm_spread");
  const [amount, setAmount]     = useState("");
  const [err, setErr]           = useState("");

  const createMut = useMutation({
    mutationFn: (body: object) =>
      apiFetch("/api/settings/fallback-rules", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      setZohoOrg("spa"); setCode(""); setName(""); setRuleType("ttm_spread"); setAmount(""); setErr("");
      onCreated(); onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;

  function submit() {
    setErr("");
    if (!code.trim())  { setErr("Account code is required"); return; }
    if (!name.trim())  { setErr("Account name is required"); return; }
    const body: Record<string, unknown> = {
      zoho_org: zohoOrg, account_code: code.trim(), account_name: name.trim(),
      rule_type: ruleType, active: true,
    };
    if (ruleType === "manual_annual") {
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0) { setErr("Annual amount must be a non-negative number"); return; }
      body.annual_amount = n;
    }
    createMut.mutate(body);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl border border-warm-border">
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-border">
          <h2 className="text-sm font-semibold text-charcoal">Add fallback rule</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-charcoal transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Org</label>
              <select value={zohoOrg} onChange={(e) => setZohoOrg(e.target.value as Org)}
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40">
                {ORG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Rule type</label>
              <select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40">
                {RULE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-text-secondary block mb-1">Account code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 619140"
              className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 font-mono" />
          </div>
          <div>
            <label className="text-[11px] text-text-secondary block mb-1">Account name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent - InterContinental"
              className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40" />
          </div>
          {ruleType === "manual_annual" && (
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Annual amount (EUR)</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40" />
            </div>
          )}
          {err && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> {err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-warm-border bg-warm-white">
          <button onClick={onClose} disabled={createMut.isPending}
            className="px-3 py-1.5 text-xs rounded-md border border-warm-border text-text-secondary hover:bg-white transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={createMut.isPending}
            className="px-3 py-1.5 text-xs rounded-md bg-gold text-white hover:bg-gold/90 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add account
          </button>
        </div>
      </div>
    </div>
  );
}

function FallbackRowItem({
  row, onPatch, onDelete, saving,
}: {
  row: FallbackRow;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  saving: boolean;
}) {
  const manual = row.rule_type === "manual_annual";
  const serverAmount = row.params?.annual_amount;
  const serverAmountStr = serverAmount != null ? String(serverAmount) : "";
  const [amountStr, setAmountStr] = useState<string>(serverAmountStr);

  useEffect(() => { setAmountStr(serverAmountStr); }, [serverAmountStr]);

  const commitAmount = () => {
    if (!manual) return;
    const n = Number(amountStr);
    const prev = serverAmount;
    if (!Number.isFinite(n) || n < 0) { setAmountStr(prev != null ? String(prev) : ""); return; }
    if (n === prev) return;
    onPatch(row.id, { annual_amount: n });
  };

  return (
    <tr className="border-b border-warm-border hover:bg-warm-gray/30 transition-colors">
      <td className="px-3 py-2 text-xs text-text-secondary uppercase">{row.zoho_org === "spa" ? "SPA" : "Aesthetics"}</td>
      <td className="px-3 py-2 text-xs font-mono text-text-secondary">{row.account_code}</td>
      <td className="px-3 py-2 text-sm text-charcoal">{row.account_name}</td>
      <td className="px-3 py-2">
        <select className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
          value={row.rule_type}
          onChange={(e) => onPatch(row.id, { rule_type: e.target.value as RuleType })}>
          {RULE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        {manual ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-secondary">€</span>
            <input type="number" min="0" step="0.01" value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              onBlur={commitAmount}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-28 text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 text-right" />
          </div>
        ) : (
          <span className="text-xs text-text-secondary italic">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={row.active}
            onChange={(e) => onPatch(row.id, { active: e.target.checked })}
            className="h-4 w-4 rounded border-warm-border text-gold focus:ring-gold/40" />
        </label>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
          <button
            onClick={() => { if (confirm(`Delete fallback rule for ${row.account_code} – ${row.account_name}?`)) onDelete(row.id); }}
            className="p-1 text-text-secondary hover:text-red-500 transition-colors" title="Delete rule">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function FallbackRulesSection() {
  const qc = useQueryClient();
  const [search, setSearch]       = useState("");
  const [orgFilter, setOrgFilter] = useState<"all" | Org>("all");
  const [showAdd, setShowAdd]     = useState(false);
  const [savingId, setSavingId]   = useState<number | null>(null);
  const [toast, setToast]         = useState<{ ok: boolean; text: string } | null>(null);

  function showToast(ok: boolean, text: string) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 2500);
  }

  const { data: rows = [], isLoading } = useQuery<FallbackRow[]>({
    queryKey: ["fallback-rules"],
    queryFn:  () => apiFetch("/api/settings/fallback-rules"),
    staleTime: 0,
  });

  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      apiFetch(`/api/settings/fallback-rules?id=${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: ({ id }) => setSavingId(id),
    onSuccess: (updated: FallbackRow) => {
      qc.setQueryData<FallbackRow[]>(["fallback-rules"], (old) =>
        old?.map((r) => (r.id === updated.id ? updated : r)) ?? []);
      showToast(true, "Saved");
    },
    onError: (e: Error) => showToast(false, e.message),
    onSettled: () => setSavingId(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/settings/fallback-rules?id=${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      qc.setQueryData<FallbackRow[]>(["fallback-rules"], (old) => old?.filter((r) => r.id !== id) ?? []);
      showToast(true, "Deleted");
    },
    onError: (e: Error) => showToast(false, e.message),
  });

  const handlePatch  = useCallback((id: number, patch: Record<string, unknown>) => patchMut.mutate({ id, patch }), [patchMut]);
  const handleDelete = useCallback((id: number) => deleteMut.mutate(id), [deleteMut]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (orgFilter !== "all" && r.zoho_org !== orgFilter) return false;
      if (!needle) return true;
      return r.account_code.toLowerCase().includes(needle) || r.account_name.toLowerCase().includes(needle);
    });
  }, [rows, search, orgFilter]);

  const counts = useMemo(() => ({
    total:    rows.length,
    active:   rows.filter((r) => r.active).length,
    manual:   rows.filter((r) => r.rule_type === "manual_annual").length,
    disabled: rows.filter((r) => r.rule_type === "disabled").length,
  }), [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-text-secondary mt-1 max-w-3xl">
            Accounts in this list get period-smoothed when running partial-period EBITDA.{" "}
            <span className="font-medium">TTM-spread</span> = last 12 months / 365 × days_in_period.{" "}
            <span className="font-medium">Manual annual</span> = your specified annual amount / 365 × days_in_period.{" "}
            <span className="font-medium">Previous month</span> = prior calendar month total × (days_in_period / days_in_prev_month).{" "}
            <span className="font-medium">Quarterly avg</span> = last 3 full months total / 90 × days_in_period.{" "}
            <span className="font-medium">Disabled</span> = literal period sum.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors shrink-0">
          <Plus className="h-3.5 w-3.5" /> Add Account
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total rules",   value: counts.total    },
          { label: "Active",        value: counts.active   },
          { label: "Manual annual", value: counts.manual   },
          { label: "Disabled",      value: counts.disabled },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-[11px] uppercase tracking-wide text-text-secondary">{s.label}</p>
            <p className="text-lg font-bold text-charcoal mt-0.5">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-warm-border bg-warm-white">
          <input
            className="text-sm border border-warm-border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 flex-1 min-w-[200px] max-w-md"
            placeholder="Search code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-1 border border-warm-border rounded-md p-0.5">
            {([
              { key: "all", label: "All" },
              { key: "spa", label: "SPA" },
              { key: "aesthetics", label: "Aesthetics" },
            ] as { key: "all" | Org; label: string }[]).map((f) => (
              <button key={f.key} onClick={() => setOrgFilter(f.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${orgFilter === f.key ? "bg-charcoal text-white" : "text-text-secondary hover:bg-warm-gray"}`}>
                {f.label}
              </button>
            ))}
          </div>
          {toast && (
            <span className={`ml-auto text-xs px-2 py-1 rounded-md flex items-center gap-1 ${toast.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {toast.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {toast.text}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-text-secondary gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-text-secondary">
            {rows.length === 0 ? "No fallback rules yet. Click Add Account to create one." : "No rules match your filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-warm-border bg-warm-gray/50">
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Org</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Code</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Account Name</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Rule</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Annual € (if manual)</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Active</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <FallbackRowItem key={row.id} row={row} onPatch={handlePatch} onDelete={handleDelete} saving={savingId === row.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-warm-border bg-warm-white text-xs text-text-secondary">
            {filtered.length} of {rows.length} rules shown
          </div>
        )}
      </Card>

      <AddAccountModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => qc.invalidateQueries({ queryKey: ["fallback-rules"] })}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: "hardcoded", label: "Hardcoded Rules" },
  { key: "fallback",  label: "Fallback Rules"  },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function EbitdaRulesPage() {
  const [tab, setTab] = useState<Tab>("hardcoded");
  return (
    <DashboardShell hideDatePicker>
      {() => (
        <div className="space-y-0">
          {/* Page header */}
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-foreground">EBITDA Rules</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage hardcoded venue overrides and fallback smoothing rules for EBITDA calculations.
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

          {tab === "hardcoded" && <HardcodedRulesSection />}
          {tab === "fallback"  && <FallbackRulesSection  />}
        </div>
      )}
    </DashboardShell>
  );
}
