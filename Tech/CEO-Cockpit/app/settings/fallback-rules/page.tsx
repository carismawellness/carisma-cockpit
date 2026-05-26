"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Loader2, AlertCircle, CheckCircle2, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type RuleType =
  | "ttm_spread"
  | "manual_annual"
  | "previous_month"
  | "quarterly_average"
  | "disabled";
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

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

// ── Add Account modal ─────────────────────────────────────────────────────────

function AddAccountModal({
  open,
  onClose,
  onCreated,
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
      apiFetch("/api/settings/fallback-rules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setZohoOrg("spa");
      setCode("");
      setName("");
      setRuleType("ttm_spread");
      setAmount("");
      setErr("");
      onCreated();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;

  function submit() {
    setErr("");
    if (!code.trim())  { setErr("Account code is required"); return; }
    if (!name.trim())  { setErr("Account name is required"); return; }

    const body: Record<string, unknown> = {
      zoho_org: zohoOrg,
      account_code: code.trim(),
      account_name: name.trim(),
      rule_type: ruleType,
      active: true,
    };
    if (ruleType === "manual_annual") {
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0) {
        setErr("Annual amount must be a non-negative number");
        return;
      }
      body.annual_amount = n;
    }
    createMut.mutate(body);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl border border-warm-border">
        <div className="flex items-center justify-between px-5 py-3 border-b border-warm-border">
          <h2 className="text-sm font-semibold text-charcoal">Add fallback rule</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-charcoal transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Org</label>
              <select
                value={zohoOrg}
                onChange={(e) => setZohoOrg(e.target.value as Org)}
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
              >
                {ORG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Rule type</label>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as RuleType)}
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
              >
                {RULE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-text-secondary block mb-1">Account code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 619140"
              className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] text-text-secondary block mb-1">Account name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rent - InterContinental"
              className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
            />
          </div>

          {ruleType === "manual_annual" && (
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Annual amount (EUR)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full text-sm border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
              />
            </div>
          )}

          {err && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {err}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-warm-border bg-warm-white">
          <button
            onClick={onClose}
            disabled={createMut.isPending}
            className="px-3 py-1.5 text-xs rounded-md border border-warm-border text-text-secondary hover:bg-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={createMut.isPending}
            className="px-3 py-1.5 text-xs rounded-md bg-gold text-white hover:bg-gold/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add account
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function FallbackRow({
  row,
  onPatch,
  onDelete,
  saving,
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

  // Re-sync local input when the server row changes (after a successful patch).
  useEffect(() => {
    setAmountStr(serverAmountStr);
  }, [serverAmountStr]);

  const commitAmount = () => {
    if (!manual) return;
    const n = Number(amountStr);
    const prev = serverAmount;
    if (!Number.isFinite(n) || n < 0) {
      // revert visually
      setAmountStr(prev != null ? String(prev) : "");
      return;
    }
    if (n === prev) return;
    onPatch(row.id, { annual_amount: n });
  };

  return (
    <tr className="border-b border-warm-border hover:bg-warm-gray/30 transition-colors">
      <td className="px-3 py-2 text-xs text-text-secondary uppercase">
        {row.zoho_org === "spa" ? "SPA" : "Aesthetics"}
      </td>
      <td className="px-3 py-2 text-xs font-mono text-text-secondary">
        {row.account_code}
      </td>
      <td className="px-3 py-2 text-sm text-charcoal">
        {row.account_name}
      </td>
      <td className="px-3 py-2">
        <select
          className="text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40"
          value={row.rule_type}
          onChange={(e) => onPatch(row.id, { rule_type: e.target.value as RuleType })}
        >
          {RULE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        {manual ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-secondary">€</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              onBlur={commitAmount}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-28 text-xs border border-warm-border rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gold/40 text-right"
            />
          </div>
        ) : (
          <span className="text-xs text-text-secondary italic">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={row.active}
            onChange={(e) => onPatch(row.id, { active: e.target.checked })}
            className="h-4 w-4 rounded border-warm-border text-gold focus:ring-gold/40"
          />
        </label>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
          <button
            onClick={() => {
              if (confirm(`Delete fallback rule for ${row.account_code} – ${row.account_name}?`)) {
                onDelete(row.id);
              }
            }}
            className="p-1 text-text-secondary hover:text-red-500 transition-colors"
            title="Delete rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FallbackRulesPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState("");
  const [orgFilter, setOrgFilter] = useState<"all" | Org>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [toast, setToast]     = useState<{ ok: boolean; text: string } | null>(null);

  function showToast(ok: boolean, text: string) {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 2500);
  }

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery<FallbackRow[]>({
    queryKey: ["fallback-rules"],
    queryFn: () => apiFetch("/api/settings/fallback-rules"),
    staleTime: 0,
  });

  // ── Patch ───────────────────────────────────────────────────────────────────
  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      apiFetch(`/api/settings/fallback-rules?id=${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onMutate: ({ id }) => setSavingId(id),
    onSuccess: (updated: FallbackRow) => {
      qc.setQueryData<FallbackRow[]>(["fallback-rules"], (old) =>
        old?.map((r) => (r.id === updated.id ? updated : r)) ?? [],
      );
      showToast(true, "Saved");
    },
    onError: (e: Error) => showToast(false, e.message),
    onSettled: () => setSavingId(null),
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/settings/fallback-rules?id=${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      qc.setQueryData<FallbackRow[]>(["fallback-rules"], (old) =>
        old?.filter((r) => r.id !== id) ?? [],
      );
      showToast(true, "Deleted");
    },
    onError: (e: Error) => showToast(false, e.message),
  });

  const handlePatch = useCallback(
    (id: number, patch: Record<string, unknown>) => patchMut.mutate({ id, patch }),
    [patchMut],
  );
  const handleDelete = useCallback(
    (id: number) => deleteMut.mutate(id),
    [deleteMut],
  );

  // ── Filtered view ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (orgFilter !== "all" && r.zoho_org !== orgFilter) return false;
      if (!needle) return true;
      return (
        r.account_code.toLowerCase().includes(needle) ||
        r.account_name.toLowerCase().includes(needle)
      );
    });
  }, [rows, search, orgFilter]);

  const counts = useMemo(() => {
    const active = rows.filter((r) => r.active).length;
    const manual = rows.filter((r) => r.rule_type === "manual_annual").length;
    const disabled = rows.filter((r) => r.rule_type === "disabled").length;
    return { total: rows.length, active, manual, disabled };
  }, [rows]);

  return (
    <DashboardShell>
      {() => (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-charcoal">Fallback Rules</h1>
              <p className="text-sm text-text-secondary mt-1 max-w-3xl">
                Accounts in this list get period-smoothed when running partial-period EBITDA.{" "}
                <span className="font-medium">TTM-spread</span> = last 12 months / 365 × days_in_period.{" "}
                <span className="font-medium">Manual annual</span> = your specified annual amount / 365 × days_in_period.{" "}
                <span className="font-medium">Previous month</span> = prior calendar month total × (days_in_period / days_in_prev_month).{" "}
                <span className="font-medium">Quarterly avg</span> = last 3 full months total / 90 × days_in_period.{" "}
                <span className="font-medium">Disabled</span> = literal period sum.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gold text-white rounded-md hover:bg-gold/90 transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Account
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">Total rules</p>
              <p className="text-lg font-bold text-charcoal mt-0.5">{counts.total}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">Active</p>
              <p className="text-lg font-bold text-charcoal mt-0.5">{counts.active}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">Manual annual</p>
              <p className="text-lg font-bold text-charcoal mt-0.5">{counts.manual}</p>
            </Card>
            <Card className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">Disabled</p>
              <p className="text-lg font-bold text-charcoal mt-0.5">{counts.disabled}</p>
            </Card>
          </div>

          {/* Table */}
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
                  { key: "all",        label: "All" },
                  { key: "spa",        label: "SPA" },
                  { key: "aesthetics", label: "Aesthetics" },
                ] as { key: "all" | Org; label: string }[]).map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setOrgFilter(f.key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      orgFilter === f.key
                        ? "bg-charcoal text-white"
                        : "text-text-secondary hover:bg-warm-gray"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {toast && (
                <span
                  className={`ml-auto text-xs px-2 py-1 rounded-md flex items-center gap-1 ${
                    toast.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                  }`}
                >
                  {toast.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : <AlertCircle  className="h-3.5 w-3.5" />}
                  {toast.text}
                </span>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-text-secondary gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-text-secondary">
                {rows.length === 0
                  ? "No fallback rules yet. Click Add Account to create one."
                  : "No rules match your filters."}
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
                      <FallbackRow
                        key={row.id}
                        row={row}
                        onPatch={handlePatch}
                        onDelete={handleDelete}
                        saving={savingId === row.id}
                      />
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
      )}
    </DashboardShell>
  );
}
