"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Row = {
  employee_name: string;
  venue: string;
  role: string;
  salary: number;
  revenue: number;
  k_pct: number | null;
  flag: "no_match" | "no_revenue" | "no_salary" | null;
};

type ApiData = {
  date_from: string;
  date_to: string;
  spa: Row[];
  aesthetics: Row[];
  slimming: Row[];
};

const BRAND_LABELS: Record<"spa" | "aesthetics" | "slimming", string> = {
  spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming",
};

function fmtC(v: number): string {
  if (v === 0) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return `€${(v / 1000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function kBadge(k: number | null) {
  if (k == null) return <span className="text-muted-foreground text-xs">n/a</span>;
  const cls = k <= 30 ? "bg-emerald-100 text-emerald-800"
            : k <= 50 ? "bg-amber-100 text-amber-800"
            : "bg-red-100 text-red-800";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{k}%</span>;
}

function flagPill(flag: Row["flag"]) {
  if (!flag) return null;
  const label = flag === "no_revenue" ? "no revenue matched"
              : flag === "no_salary"  ? "no salary matched"
              : "no match";
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700">
      <AlertTriangle className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

export function PractitionerProductivityTable({
  dateFrom, dateTo,
}: { dateFrom: string; dateTo: string }) {
  const [data, setData]   = useState<ApiData | null>(null);
  const [tab, setTab]     = useState<"spa" | "aesthetics" | "slimming">("spa");
  const [loading, setLoad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoad(true); setError(null); setData(null);
    const c = new AbortController();
    fetch(`/api/finance/practitioner-productivity?date_from=${dateFrom}&date_to=${dateTo}`, { signal: c.signal })
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); setLoad(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(String(e)); setLoad(false); } });
    return () => c.abort();
  }, [dateFrom, dateTo]);

  const rows = data?.[tab] ?? [];

  return (
    <div className="rounded border bg-card">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Practitioner Productivity</h3>
          <p className="text-xs text-muted-foreground">Salary cost as % of revenue generated, per practitioner. Therapists + practitioners only.</p>
        </div>
        <div className="flex gap-1">
          {(["spa", "aesthetics", "slimming"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                tab === t ? "bg-foreground text-background" : "hover:bg-muted"
              }`}>
              {BRAND_LABELS[t]} {data ? `(${data[t].length})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        {loading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {error   && <p className="text-sm text-destructive py-4 px-4">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">No data for this period.</p>
        )}
        {!loading && !error && rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium">Practitioner</th>
                <th className="text-left px-3 py-2 font-medium">Venue</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-right px-3 py-2 font-medium">Salary</th>
                <th className="text-right px-3 py-2 font-medium">Revenue</th>
                <th className="text-right px-3 py-2 font-medium">K%</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.venue}-${r.employee_name}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-1.5 capitalize text-muted-foreground">{r.venue.replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5 capitalize text-muted-foreground">{r.role}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtC(r.salary)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtC(r.revenue)}</td>
                  <td className="px-3 py-1.5 text-right">{kBadge(r.k_pct)}</td>
                  <td className="px-3 py-1.5">{flagPill(r.flag)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td className="px-3 py-2 font-semibold" colSpan={3}>Total ({rows.length})</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {fmtC(rows.reduce((s, r) => s + r.salary, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {fmtC(rows.reduce((s, r) => s + r.revenue, 0))}
                </td>
                <td className="px-3 py-2 text-right">
                  {(() => {
                    const totS = rows.reduce((s, r) => s + r.salary, 0);
                    const totR = rows.reduce((s, r) => s + r.revenue, 0);
                    return totR > 0 ? kBadge(+((totS / totR) * 100).toFixed(1)) : kBadge(null);
                  })()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
