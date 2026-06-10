"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Loader2, Save } from "lucide-react";
import type { AgentMappingRow } from "@/app/api/settings/crm-agent-mapping/route";

const POSITIONS = ["sdr", "chat"] as const;
const BRANDS    = [
  { value: null,          label: "— none —"   },
  { value: "spa",         label: "Spa"         },
  { value: "aesthetics",  label: "Aesthetics"  },
  { value: "slimming",    label: "Slimming"    },
] as const;

const BRAND_COLOR: Record<string, string> = {
  spa:        "text-[#4e9af1]",
  aesthetics: "text-[#e891b0]",
  slimming:   "text-[#f5a623]",
};

export default function CrmAgentMappingPage() {
  const [agents,  setAgents]  = useState<AgentMappingRow[]>([]);
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [saved,   setSaved]   = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [edits,   setEdits]   = useState<Record<string, Partial<AgentMappingRow>>>({});

  useEffect(() => {
    fetch("/api/settings/crm-agent-mapping")
      .then(r => r.json())
      .then(d => { setAgents(d.agents ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function patch(slug: string, field: keyof AgentMappingRow, value: unknown) {
    setEdits(prev => ({ ...prev, [slug]: { ...prev[slug], [field]: value } }));
  }

  function current(agent: AgentMappingRow, field: keyof AgentMappingRow) {
    const e = edits[agent.agent_slug];
    return e && field in e ? e[field] : agent[field];
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

  const sdrs  = agents.filter(a => a.position === "sdr");
  const chats = agents.filter(a => a.position === "chat");

  function AgentTable({ rows, title }: { rows: AgentMappingRow[]; title: string }) {
    return (
      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-border">
                <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wider w-36">Agent</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-28">Position</th>
                <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-36">Brand</th>
                <th className="text-center py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Active</th>
                <th className="py-2 px-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map(agent => {
                const slug    = agent.agent_slug;
                const isDirty = !!edits[slug] && Object.keys(edits[slug]).length > 0;
                const brand   = current(agent, "brand_slug") as string | null;
                return (
                  <tr key={slug} className="border-b border-warm-border/50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{agent.display_name}</td>

                    <td className="py-2 px-3">
                      <select
                        value={current(agent, "position") as string}
                        onChange={e => patch(slug, "position", e.target.value as "sdr" | "chat")}
                        className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
                      >
                        {POSITIONS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                      </select>
                    </td>

                    <td className="py-2 px-3">
                      <select
                        value={(current(agent, "brand_slug") as string | null) ?? ""}
                        onChange={e => patch(slug, "brand_slug", e.target.value === "" ? null : e.target.value)}
                        className="text-xs border border-warm-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-gold/40"
                        style={{ color: brand ? undefined : undefined }}
                      >
                        {BRANDS.map(b => (
                          <option key={String(b.value)} value={b.value ?? ""}>{b.label}</option>
                        ))}
                      </select>
                      {brand && (
                        <span className={`ml-2 text-xs font-semibold capitalize ${BRAND_COLOR[brand] ?? ""}`}>{brand}</span>
                      )}
                    </td>

                    <td className="py-2 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={current(agent, "is_active") as boolean}
                        onChange={e => patch(slug, "is_active", e.target.checked)}
                        className="h-3.5 w-3.5 accent-gold"
                      />
                    </td>

                    <td className="py-2 px-3 text-right">
                      {saving[slug] ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />
                      ) : saved[slug] ? (
                        <span className="text-xs text-green-600 font-medium">Saved</span>
                      ) : (
                        <button
                          onClick={() => saveAgent(agent)}
                          disabled={!isDirty}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-warm-border text-muted-foreground hover:text-foreground hover:border-gold/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ml-auto"
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
        </div>
      </div>
    );
  }

  return (
    <DashboardShell hideDatePicker>
      {() => (
      <div className="p-4 md:p-6 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">CRM Agent Mapping</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Assign agents to brands and positions. SDR agents assigned to a brand are used to compute
            leads per agent, booking efficiency, and deposit rate in the funnel dashboard.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="p-4 md:p-6">
            <AgentTable rows={sdrs}  title="SDR Agents"  />
            <AgentTable rows={chats} title="Chat Agents" />
          </Card>
        )}
      </div>
      )}
    </DashboardShell>
  );
}
