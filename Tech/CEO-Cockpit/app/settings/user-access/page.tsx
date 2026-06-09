"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DASHBOARDS, DASHBOARD_KEYS } from "@/lib/constants/dashboards";
import { UserPlus, Trash2, CheckCircle2, Clock, Ban, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Invitation {
  id: string;
  email: string;
  is_active: boolean;
  created_at: string;
  registered: boolean;
}

interface PermissionRow {
  dashboard_key: string;
  has_access: boolean;
}

const GROUPS = Array.from(new Set(DASHBOARDS.map((d) => d.group)));

export default function UserAccessPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [selected, setSelected] = useState<Invitation | null>(null);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  // Invite form state
  const [newEmail, setNewEmail] = useState("");
  const [invitePerms, setInvitePerms] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  const loadInvitations = useCallback(async () => {
    const res = await fetch("/api/admin/invitations");
    if (res.ok) setInvitations(await res.json());
  }, []);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);

  useEffect(() => {
    if (!selected) { setPermissions([]); return; }
    setLoadingPerms(true);
    fetch(`/api/admin/user-permissions?email=${encodeURIComponent(selected.email)}`)
      .then((r) => r.json())
      .then((data: PermissionRow[]) => setPermissions(data))
      .finally(() => setLoadingPerms(false));
  }, [selected]);

  function toggleInvitePerm(key: string) {
    setInvitePerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function selectAllInvitePerms() {
    setInvitePerms(new Set(DASHBOARD_KEYS));
  }

  function clearAllInvitePerms() {
    setInvitePerms(new Set());
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setInviting(true);
    setError("");
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail.trim().toLowerCase(),
          permissions: Array.from(invitePerms),
        }),
      });
      if (res.ok) {
        setNewEmail("");
        setInvitePerms(new Set());
        await loadInvitations();
      } else {
        let msg = "Failed to invite";
        try { msg = (await res.json()).error ?? msg; } catch {}
        setError(msg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setInviting(false);
    }
  }

  async function toggleActive(inv: Invitation) {
    await fetch("/api/admin/invitations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inv.email, is_active: !inv.is_active }),
    });
    await loadInvitations();
    if (selected?.email === inv.email) {
      setSelected((prev) => prev ? { ...prev, is_active: !prev.is_active } : null);
    }
  }

  async function removeInvitation(email: string) {
    if (!confirm(`Remove access for ${email}?`)) return;
    await fetch(`/api/admin/invitations?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    if (selected?.email === email) setSelected(null);
    await loadInvitations();
  }

  async function togglePermission(key: string, current: boolean) {
    if (!selected) return;
    setSaving(key);
    await fetch("/api/admin/user-permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: selected.email, dashboard_key: key, has_access: !current }),
    });
    setPermissions((prev) =>
      prev.map((p) => p.dashboard_key === key ? { ...p, has_access: !current } : p)
    );
    setSaving(null);
  }

  const permMap = Object.fromEntries(permissions.map((p) => [p.dashboard_key, p.has_access]));

  return (
    <DashboardShell hideDatePicker>
      {() => (
        <div className="space-y-6 max-w-5xl">
          <div>
            <h1 className="text-2xl font-bold text-foreground">User Access</h1>
            <p className="text-sm text-muted-foreground mt-1">Invite users and set their dashboard permissions in one step.</p>
          </div>

          {/* ── Invite form ─────────────────────────────────────────────────── */}
          <Card className="rounded-2xl border-warm-border shadow-sm">
            <CardHeader className="pb-3 border-b border-warm-border">
              <CardTitle className="text-sm font-semibold text-charcoal flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-gold" />
                Invite New User
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={handleInvite} className="space-y-5">
                {/* Email row */}
                <div className="flex gap-2 items-center">
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    required
                    className="border-warm-border focus-visible:ring-gold/30 rounded-lg h-10 text-sm max-w-sm"
                  />
                  <Button
                    type="submit"
                    disabled={inviting}
                    className="bg-gold hover:bg-gold-dark text-white h-10 px-5 rounded-lg text-sm font-medium shrink-0"
                  >
                    {inviting ? "Inviting…" : "Invite"}
                  </Button>
                </div>

                {/* Permission grid */}
                <div className="border border-warm-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-warm-gray border-b border-warm-border">
                    <span className="text-xs font-semibold text-charcoal uppercase tracking-wider">
                      Dashboard Permissions
                      <span className="ml-2 font-normal text-text-secondary normal-case tracking-normal">
                        ({invitePerms.size} of {DASHBOARD_KEYS.length} selected)
                      </span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllInvitePerms}
                        className="text-xs text-gold hover:underline font-medium"
                      >
                        Select all
                      </button>
                      <span className="text-text-secondary text-xs">·</span>
                      <button
                        type="button"
                        onClick={clearAllInvitePerms}
                        className="text-xs text-text-secondary hover:underline font-medium"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-x divide-warm-border">
                    {GROUPS.map((group, gi) => (
                      <div key={group} className={cn("p-4 space-y-2.5", gi > 0 && "border-t sm:border-t-0 border-warm-border")}>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-3">
                          {group}
                        </p>
                        {DASHBOARDS.filter((d) => d.group === group).map((d) => (
                          <label
                            key={d.key}
                            className="flex items-center gap-2.5 cursor-pointer group"
                          >
                            <input
                              type="checkbox"
                              checked={invitePerms.has(d.key)}
                              onChange={() => toggleInvitePerm(d.key)}
                              className="w-4 h-4 rounded border-warm-border accent-[#B8943E] cursor-pointer shrink-0"
                            />
                            <span className="text-sm text-charcoal group-hover:text-gold transition-colors">
                              {d.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {error && <p className="text-red-500 text-xs">{error}</p>}
              </form>
            </CardContent>
          </Card>

          {/* ── Invited users + permission editing ─────────────────────────── */}
          {invitations.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
              {/* User list */}
              <Card className="rounded-2xl border-warm-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-charcoal">
                    Invited Users ({invitations.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-warm-border">
                    {invitations.map((inv) => (
                      <li
                        key={inv.email}
                        onClick={() => setSelected(inv.email === selected?.email ? null : inv)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                          selected?.email === inv.email ? "bg-gold-bg" : "hover:bg-warm-gray"
                        )}
                      >
                        <span className="shrink-0">
                          {!inv.is_active ? (
                            <Ban className="h-4 w-4 text-red-400" />
                          ) : inv.registered ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-amber-400" />
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-charcoal truncate">{inv.email}</p>
                          <p className="text-[11px] text-text-secondary">
                            {!inv.is_active ? "Disabled" : inv.registered ? "Active" : "Pending"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Badge
                            variant="outline"
                            onClick={() => toggleActive(inv)}
                            className={cn(
                              "cursor-pointer text-[10px] px-1.5 py-0 h-5 border rounded-md font-medium transition-colors",
                              inv.is_active
                                ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                : "border-red-200 text-red-600 hover:bg-red-50"
                            )}
                          >
                            {inv.is_active ? "On" : "Off"}
                          </Badge>
                          <button
                            onClick={() => removeInvitation(inv.email)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {selected?.email === inv.email
                          ? <ChevronUp className="h-4 w-4 text-gold shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-text-secondary shrink-0" />}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Permission editor */}
              {selected ? (
                <Card className="rounded-2xl border-warm-border shadow-sm sticky top-6">
                  <CardHeader className="pb-3 border-b border-warm-border">
                    <CardTitle className="text-sm font-semibold text-charcoal">Edit Permissions</CardTitle>
                    <p className="text-xs text-text-secondary mt-0.5 truncate">{selected.email}</p>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {loadingPerms ? (
                      <p className="text-xs text-text-secondary">Loading…</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                        {GROUPS.map((group) => (
                          <div key={group} className="col-span-full mb-3 first:mt-0 mt-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary mb-2">
                              {group}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                              {DASHBOARDS.filter((d) => d.group === group).map((d) => {
                                const checked = permMap[d.key] ?? false;
                                return (
                                  <div key={d.key} className="flex items-center justify-between py-0.5">
                                    <span className="text-sm text-charcoal">{d.label}</span>
                                    <Switch
                                      checked={checked}
                                      disabled={saving === d.key}
                                      onCheckedChange={() => togglePermission(d.key, checked)}
                                      className={saving === d.key ? "opacity-50" : undefined}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="hidden lg:flex items-center justify-center h-40 rounded-2xl border-2 border-dashed border-warm-border">
                  <p className="text-sm text-text-secondary">Select a user to edit their permissions</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
