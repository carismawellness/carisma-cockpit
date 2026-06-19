"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Loader2, Save, RefreshCw } from "lucide-react";
import type { AgentMappingRow } from "@/app/api/settings/crm-agent-mapping/route";

const POSITION_OPTIONS = [
  { value: "sdr",  label: "SDR"  },
  { value: "chat", label: "Chat" },
] as const;

const BRAND_OPTIONS = [
  { value: "",            label: "— none —"   },
  { value: "spa",         label: "Spa"         },
  { value: "aesthetics",  label: "Aesthetics"  },
  { value: "slimming",    label: "Slimming"    },
] as const;

const BRAND_COLOR: Record<string, string> = {
  spa:        "bg-blue-50 text-blue-700 border-blue-200",
  aesthetics: "bg-pink-50 text-pink-700 border-pink-200",
  slimming:   "bg-amber-50 text-amber-700 border-amber-200",
};

const POSITION_COLOR: Record<string, string> = {
  sdr:  "bg-violet-50 text-violet-700 border-violet-200",
  chat: "bg-slate-50 text-slate-600 border-slate-200",
};

function Pill({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border ${colorClass}`}>
      {label}
    </span>
  );
}

export default function CrmAgentMappingPage() {
  const [agents,  setAgents]  = useState<AgentMappingRow[]>([]);
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [saved,   setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [edits,   setEdits]   = useState<Record<string, Partial<AgentMappingRow>>>({});

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/crm-agent-mapping");
      const d = await r.json();
      setAgents(d.agents ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function patch(slug: string, field: keyof AgentMappingRow, value: unknown) {
    setEdits(prev => ({ ...prev, [slug]: { ...prev[slug], [field]: value } }));
  }

  function current<K extends keyof AgentMappingRow>(agent: AgentMappingRow, field: K): AgentMappingRow[K] {
    const e = edits[agent.agent_slug];
    return (e && field in e ? e[field] : agent[field]) as AgentMappingRow[K];
  }

  async function saveAgent(agent: AgentMappingRow) {
    const slug = agent.agent_slug;
    setSaving(prev => ({ ...prev, [slug]: true }));
    const merged = { ...agent, ...(edits[slug] ?? {}) };
    await fetch("/api/settings/crm-agent-mapping", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    });
    setAgents(prev => prev.map(a => a.agent_slug === slug ? { ...a, ...merged } : a));
    setEdits(prev => { const n = { ...prev }; delete n[slug]; return n; });
    setSaving(prev => ({ ...prev, [slug]: false }));
    setSaved(prev => ({ ...prev, [slug]: true }));
    setTimeout(() => setSaved(prev => ({ ...prev, [slug]: false })), 1800);
  }

  async function reseed() {
    setSeeding(true);
    await fetch("/api/settings/crm-agent-mapping/setup", { method: "POST" });
    await load();
    setSeeding(false);
  }

  return (
    <DashboardShell hideDatePicker>
      {() => (
      <div className="p-4 md:p-6 max-w-3xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">CRM Agent Mapping</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Assign agents to brands and positions. SDR agents are used to compute
              leads per agent, booking efficiency, and deposit rate in the funnel dashboard.
            </p>
          </div>
          <button
            onClick={reseed}
            disabled={seeding}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-warm-border text-muted-foreground hover:text-foreground hover:border-gold/60 transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`h-3 w-3 ${seeding ? "animate-spin" : ""}`} />
            Reset to defaults
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-border bg-muted/30">
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">Agent</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-28">Position</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-36">Brand</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-28">Status</th>
                  <th className="py-2.5 px-3 w-16" />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent, idx) => {
                  const slug      = agent.agent_slug;
                  const isDirty   = !!edits[slug] && Object.keys(edits[slug]).length > 0;
                  const position  = current(agent, "position");
                  const brand     = current(agent, "brand_slug") as string | null;
                  const isActive  = current(agent, "is_active") as boolean;
                  const isInactive = !isActive;
                  return (
                    <tr
                      key={slug}
                      className={`border-b border-warm-border/50 last:border-0 transition-colors ${isInactive ? "opacity-50" : ""} ${idx % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      {/* Agent name */}
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        {agent.display_name}
                      </td>

                      {/* Position dropdown */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={position}
                            onChange={e => patch(slug, "position", e.target.value as "sdr" | "chat")}
                            className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40 w-full max-w-[76px]"
                          >
                            {POSITION_OPTIONS.map(p => (
                              <option key={p.value} value={p.value}>{p.label}</option>
                            ))}
                          </select>
                          <Pill label={position.toUpperCase()} colorClass={POSITION_COLOR[position] ?? ""} />
                        </div>
                      </td>

                      {/* Brand dropdown */}
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={brand ?? ""}
                            onChange={e => patch(slug, "brand_slug", e.target.value === "" ? null : e.target.value as AgentMappingRow["brand_slug"])}
                            className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40 w-full max-w-[96px]"
                          >
                            {BRAND_OPTIONS.map(b => (
                              <option key={b.value} value={b.value}>{b.label}</option>
                            ))}
                          </select>
                          {brand && (
                            <Pill label={brand.charAt(0).toUpperCase() + brand.slice(1, 3) + "."} colorClass={BRAND_COLOR[brand] ?? ""} />
                          )}
                        </div>
                      </td>

                      {/* Active / Inactive dropdown */}
                      <td className="py-2 px-3">
                        <select
                          value={isActive ? "active" : "inactive"}
                          onChange={e => patch(slug, "is_active", e.target.value === "active")}
                          className={`text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gold/40 w-full max-w-[90px] font-medium ${
                            isActive
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 bg-gray-50 text-gray-500"
                          }`}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </td>

                      {/* Save */}
                      <td className="py-2 px-3 text-right">
                        {saving[slug] ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
                        ) : saved[slug] ? (
                          <span className="text-xs text-green-600 font-medium">Saved ✓</span>
                        ) : (
                          <button
                            onClick={() => saveAgent(agent)}
                            disabled={!isDirty}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-warm-border text-muted-foreground hover:text-foreground hover:border-gold/60 transition-colors disabled:opacity-25 disabled:cursor-not-allowed ml-auto"
                          >
                            <Save className="h-3 w-3" />
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
      )}
    </DashboardShell>
  );
}
