"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupplementRow {
  id: number;
  month: string;
  employee_name: string;
  talexio_id: number | null;
  talexio_name: string | null;
  amount: number;
  spa_slug: string | null;
  is_frozen: boolean;
  synced_at: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SPA_OPTIONS = [
  { slug: "inter",       label: "InterContinental" },
  { slug: "hugos",       label: "Hugo's" },
  { slug: "hyatt",       label: "Hyatt" },
  { slug: "ramla",       label: "Ramla Bay" },
  { slug: "labranda",    label: "Labranda" },
  { slug: "odycy",       label: "Sunny Coast" },
  { slug: "excelsior",   label: "Excelsior" },
  { slug: "novotel",     label: "Novotel" },
  { slug: "aesthetics",  label: "Aesthetics" },
  { slug: "slimming",    label: "Slimming" },
  { slug: "centre",      label: "Centre" },
];

const SPA_LABEL: Record<string, string> = Object.fromEntries(
  SPA_OPTIONS.map((s) => [s.slug, s.label])
);

// Generate list of months from Oct 2025 to current month + 2 ahead
function availableMonths(): { value: string; label: string }[] {
  const months = [];
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const start = new Date(2025, 9, 1); // Oct 2025
  const d = new Date(start);
  while (d <= end) {
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const value = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    months.unshift({ value, label }); // newest first
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function fmtCurrency(n: number) {
  return `€${Math.round(n).toLocaleString()}`;
}

// ── Editable employee number cell ─────────────────────────────────────────────

function EmpNoCell({
  row,
  onSave,
}: {
  row: SupplementRow;
  onSave: (id: number, empNo: number | null) => void;
}) {
  const [val, setVal] = useState(String(row.talexio_id ?? ""));

  const commit = () => {
    const parsed = val.trim() ? parseInt(val.trim(), 10) : null;
    if (parsed !== row.talexio_id) onSave(row.id, parsed);
  };

  return (
    <input
      type="number"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      placeholder="—"
      className="w-20 text-sm text-center border border-border rounded px-1 py-0.5 bg-background text-foreground"
    />
  );
}

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SalarySupplement() {
  const router = useRouter();
  const [month, setMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const months = availableMonths();

  // ── Fetch rows ──────────────────────────────────────────────────────────────
  const { data: rows = [], isFetching } = useQuery<SupplementRow[]>({
    queryKey: ["salary-supplement", month],
    queryFn: () => apiFetch(`/api/settings/salary-supplement?month=${month}`),
    staleTime: 0,
  });

  const isFrozen = rows.length > 0 && rows.every((r) => r.is_frozen);
  const unassigned = rows.filter((r) => !r.spa_slug);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  // ── Spa totals ──────────────────────────────────────────────────────────────
  const spaTotals = SPA_OPTIONS.map((spa) => ({
    ...spa,
    total: rows.filter((r) => r.spa_slug === spa.slug).reduce((s, r) => s + Number(r.amount), 0),
  })).filter((s) => s.total > 0);

  // ── Sync mutation ───────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/salary-supplement/sync", {
        method: "POST",
        body: JSON.stringify({ month }),
      }),
    onSuccess: (data) => {
      setSyncError(null);
      queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] });
      if (data.excluded?.length) {
        console.info("Excluded (not SPA):", data.excluded);
      }
    },
    onError: (e: Error) => setSyncError(e.message),
  });

  // ── Spa update mutation ─────────────────────────────────────────────────────
  const updateSpa = useMutation({
    mutationFn: ({ id, spa_slug }: { id: number; spa_slug: string | null }) =>
      apiFetch("/api/settings/salary-supplement", {
        method: "PATCH",
        body: JSON.stringify({ id, spa_slug }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  // ── Emp no update mutation ──────────────────────────────────────────────────
  const updateEmpNo = useMutation({
    mutationFn: ({ id, talexio_id }: { id: number; talexio_id: number | null }) =>
      apiFetch("/api/settings/salary-supplement", {
        method: "PATCH",
        body: JSON.stringify({ id, talexio_id }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  // ── Talexio allocate mutation ───────────────────────────────────────────────
  const [talexioResult, setTalexioResult] = useState<{ allocated: number; skipped: number; unmatched: string[] } | null>(null);
  const talexioAllocate = useMutation({
    mutationFn: (force: boolean) =>
      apiFetch("/api/settings/salary-supplement/talexio-allocate", {
        method: "POST",
        body: JSON.stringify({ month, force }),
      }),
    onSuccess: (data) => {
      setTalexioResult(data);
      queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] });
    },
    onError: (e: Error) => setSyncError(e.message),
  });

  // ── Freeze mutation ─────────────────────────────────────────────────────────
  const freezeMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/salary-supplement", {
        method: "PATCH",
        body: JSON.stringify({ month, freeze: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  // ── Unfreeze mutation ───────────────────────────────────────────────────────
  const unfreezeMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/settings/salary-supplement", {
        method: "PATCH",
        body: JSON.stringify({ month, freeze: false }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["salary-supplement", month] }),
  });

  const handleSpaChange = useCallback(
    (id: number, slug: string) => {
      updateSpa.mutate({ id, spa_slug: slug || null });
    },
    [updateSpa]
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <h1 className="text-2xl font-bold text-foreground">Salary Supplement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Additional salary not in Zoho — synced from Google Sheets, added to EBITDA wages
          </p>
        </div>

        {/* Month selector */}
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value); setSyncError(null); }}
          className="text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground"
        >
          {months.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || isFrozen}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {syncMutation.isPending ? "Syncing…" : "Sync from Sheet"}
        </button>

        <button
          onClick={() => { setTalexioResult(null); talexioAllocate.mutate(false); }}
          disabled={talexioAllocate.isPending || isFrozen || rows.length === 0}
          title="Auto-assign location from Talexio for unassigned rows"
          className="text-sm px-4 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {talexioAllocate.isPending ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Allocating…
            </>
          ) : "Sync from Talexio"}
        </button>

        {rows.length > 0 && !isFrozen && (
          <button
            onClick={() => freezeMutation.mutate()}
            disabled={freezeMutation.isPending || unassigned.length > 0}
            title={unassigned.length > 0 ? "Assign all spas before freezing" : undefined}
            className="text-sm px-4 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {freezeMutation.isPending ? "Saving…" : "Save & Freeze"}
          </button>
        )}

        {isFrozen && (
          <>
            <span className="text-sm text-emerald-600 font-medium">
              ✓ Frozen — included in EBITDA wages
            </span>
            <button
              onClick={() => unfreezeMutation.mutate()}
              disabled={unfreezeMutation.isPending}
              className="text-sm px-4 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {unfreezeMutation.isPending ? "Unlocking…" : "Edit"}
            </button>
          </>
        )}

        {syncError && (
          <span className="text-sm text-red-600">{syncError}</span>
        )}
      </div>

      {talexioResult && (
        <div className={`rounded-md px-4 py-3 text-sm flex flex-wrap items-start gap-3
          ${talexioResult.allocated > 0 ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-amber-50 border border-amber-200 text-amber-800"}`}>
          <span className="font-semibold">Talexio allocation:</span>
          <span>{talexioResult.allocated} assigned</span>
          {talexioResult.skipped > 0 && <span className="text-muted-foreground">· {talexioResult.skipped} already set (skipped)</span>}
          {talexioResult.unmatched.length > 0 && (
            <span className="text-amber-700">
              · {talexioResult.unmatched.length} unmatched: {talexioResult.unmatched.join(", ")}
            </span>
          )}
          <button onClick={() => setTalexioResult(null)} className="ml-auto text-xs underline opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Loading */}
      {isFetching && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {/* Empty state */}
      {!isFetching && rows.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No data for this month yet.{" "}
          <button
            className="underline text-primary"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            Sync from Sheet
          </button>{" "}
          to import active employees with additional salary.
        </Card>
      )}

      {/* Employee table */}
      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Employee</th>
                <th className="text-center py-2.5 px-3 font-semibold text-muted-foreground">Emp No</th>
                <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground">Amount</th>
                <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground">Allocated To</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-4 text-foreground">
                    {row.talexio_name || row.employee_name}
                  </td>
                  <td className="py-2 px-3 text-center text-muted-foreground">
                    {isFrozen ? (
                      row.talexio_id ?? <span className="text-xs">—</span>
                    ) : (
                      <EmpNoCell
                        row={row}
                        onSave={(id, empNo) => updateEmpNo.mutate({ id, talexio_id: empNo })}
                      />
                    )}
                  </td>
                  <td className="py-2 px-4 text-right font-medium text-foreground">
                    {fmtCurrency(row.amount)}
                  </td>
                  <td className="py-2 px-4">
                    {isFrozen ? (
                      <span className={row.spa_slug ? "text-foreground" : "text-red-500"}>
                        {row.spa_slug ? SPA_LABEL[row.spa_slug] : "⚠ Unassigned"}
                      </span>
                    ) : (
                      <select
                        value={row.spa_slug ?? ""}
                        onChange={(e) => handleSpaChange(row.id, e.target.value)}
                        className={`text-sm border rounded px-2 py-1 bg-background ${
                          !row.spa_slug
                            ? "border-amber-400 text-amber-700"
                            : "border-border text-foreground"
                        }`}
                      >
                        <option value="">⚠ Unassigned</option>
                        {SPA_OPTIONS.map((s) => (
                          <option key={s.slug} value={s.slug}>{s.label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/20">
                <td className="py-2.5 px-4 font-semibold text-foreground" colSpan={2}>
                  Total ({rows.length} employees)
                </td>
                <td className="py-2.5 px-4 text-right font-bold text-foreground">
                  {fmtCurrency(total)}
                </td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground">
                  {unassigned.length > 0 && (
                    <span className="text-amber-600">⚠ {unassigned.length} unassigned</span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* Spa breakdown summary */}
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
