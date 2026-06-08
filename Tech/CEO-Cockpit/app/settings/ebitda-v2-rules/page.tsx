"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Pencil, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type SpecialPerson = {
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

type FallbackRule = {
  id: number;
  account_code: string;
  account_name: string;
  rule_type: string;
  active: boolean;
  params: Record<string, unknown>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ruleTypeLabel(rule_type: string): string {
  return {
    fixed_monthly:         "Fixed monthly amount",
    base_plus_revenue_pct: "Base + % of revenue",
    skip:                  "Skip (no Zoho data)",
  }[rule_type] ?? rule_type;
}

function paramsDisplay(rule_type: string, params: Record<string, number>): string {
  if (rule_type === "fixed_monthly")
    return `€${(params.monthly_amount ?? 0).toLocaleString()}/mo`;
  if (rule_type === "base_plus_revenue_pct")
    return `€${(params.base_monthly ?? 0).toLocaleString()} base + ${params.revenue_pct ?? 0}% revenue`;
  return "—";
}

// ── Main page ─────────────────────────────────────────────────────────────────

function venueLabel(params: Record<string, unknown>): string {
  if (params.venue) return String(params.venue).replace(/_/g, " ");
  if (Array.isArray(params.venues)) return (params.venues as string[]).map(v => v.replace(/_/g, " ")).join(", ");
  return "—";
}

export default function EbitdaV2RulesPage() {
  const [persons, setPersons]         = useState<SpecialPerson[]>([]);
  const [rules, setRules]             = useState<HardwiredRule[]>([]);
  const [fallback, setFallback]       = useState<FallbackRule[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Add-person form
  const [showAdd, setShowAdd]         = useState(false);
  const [newKey, setNewKey]           = useState("");
  const [newName, setNewName]         = useState("");
  const [saving, setSaving]           = useState(false);

  // Edit-hardwired-rule state
  const [editRuleId, setEditRuleId]   = useState<string | null>(null);
  const [editNote, setEditNote]       = useState("");

  // Edit-fallback-floor state
  const [editFloorId, setEditFloorId] = useState<number | null>(null);
  const [editFloorAmt, setEditFloorAmt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/settings/ebitda-v2-rules");
    if (!res.ok) { setError("Failed to load"); setLoading(false); return; }
    const data = await res.json();
    setPersons(data.special_persons ?? []);
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
    } finally {
      setSaving(false);
    }
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
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">EBITDA V2 Rules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure special persons (always routed to Wages) and hardwired venue rules
          (fixed amounts / formulas that override Zoho data).
        </p>
      </div>

      {/* ── Special Persons ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">Special Persons</h2>
            <p className="text-xs text-muted-foreground">
              Contacts that are always classified as Wages &amp; Salaries in EBITDA V2,
              regardless of which Zoho account they were posted to.
              If no venue tag is present, they default to HQ.
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
                        <button onClick={() => saveRuleNote(r.id)}
                          className="text-green-600 hover:text-green-700">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditRuleId(null)}
                          className="text-muted-foreground hover:text-foreground">
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

      {/* ── Cost Floor Rules (min_monthly) ──────────────────────────────── */}
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
