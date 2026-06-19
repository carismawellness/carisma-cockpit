// components/sales/SpaIntegrityBadge.tsx
//
// Visible "data verified ✓" / "drift ⚠" indicator that runs a live
// triangulation between the Cockpit Datasheet CSV and the Supabase
// spa_revenue_daily table on every page load. Click to expand details.
//
// Backed by /api/sales/spa/integrity — see that route for the methodology.

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, AlertCircle, Loader2, ChevronDown, ChevronUp, Clock } from "lucide-react";

type Status = "ok" | "pending" | "warn" | "error";

interface Check {
  name:         string;
  status:       Status;
  source_total: number;
  stored_total: number;
  diff:         number;
  diff_pct:     number;
  source_rows:  number;
  stored_rows:  number;
  note?:        string;
}

interface IntegrityResponse {
  overall:      Status;
  checks:       Check[];
  last_sync_at: string | null;
  generated_at: string;
  methodology: {
    sources: { A: string; B: string };
    bands:   { ok_pct: number; warn_pct: number };
    notes:   string[];
  };
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtEur(v: number): string {
  return `€${Math.round(v).toLocaleString()}`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

interface Props {
  dateFrom: Date;
  dateTo:   Date;
}

export function SpaIntegrityBadge({ dateFrom, dateTo }: Props) {
  const [open, setOpen] = useState(false);
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<IntegrityResponse>({
    queryKey: ["spa-integrity", fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/spa/integrity?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    // Verification is the one place where stale data defeats the purpose,
    // but we still cache for 5 min to avoid hammering the sheet on every
    // re-render. Refresh by changing the date picker.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  if (isFetching && !data) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Verifying…
      </span>
    );
  }

  if (error || !data) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900">
        <AlertTriangle className="h-3 w-3" /> Verification unavailable
      </span>
    );
  }

  const { overall, checks, last_sync_at, methodology } = data;
  const summary = checks.find((c) => c.name.startsWith("Spa total"));

  const tone =
    overall === "ok"
      ? { ring: "border-emerald-300", bg: "bg-emerald-50", fg: "text-emerald-800", Icon: CheckCircle2, label: "Data verified" }
      : overall === "pending"
        ? { ring: "border-sky-300", bg: "bg-sky-50", fg: "text-sky-900", Icon: Clock, label: "Sync pending" }
        : overall === "warn"
          ? { ring: "border-amber-300", bg: "bg-amber-50", fg: "text-amber-900", Icon: AlertTriangle, label: "Drift detected" }
          : { ring: "border-red-300", bg: "bg-red-50", fg: "text-red-900", Icon: AlertCircle, label: "Verification failed" };
  const Icon = tone.Icon;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border ${tone.ring} ${tone.bg} ${tone.fg} px-2.5 py-1 text-[11px] font-medium hover:brightness-95 transition`}
        aria-expanded={open}
        title={`Source: ${methodology.sources.A}\nLast ETL: ${fmtRelative(last_sync_at)}`}
      >
        <Icon className="h-3 w-3" />
        {tone.label}
        {summary && overall !== "ok" && (
          <span className="opacity-80">· {summary.diff_pct.toFixed(1)}%</span>
        )}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="rounded-md border border-border bg-white p-3 text-xs shadow-sm space-y-3 max-w-xl">
          <div className="space-y-0.5">
            <p className="font-semibold text-foreground">Triangulation: Cockpit Datasheet ↔ Supabase</p>
            <p className="text-muted-foreground">
              Last ETL: {fmtRelative(last_sync_at)} · Verified just now
            </p>
          </div>

          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Cut</th>
                <th className="text-right py-1.5 font-medium">Sheet (source)</th>
                <th className="text-right py-1.5 font-medium">Supabase (stored)</th>
                <th className="text-right py-1.5 font-medium">Δ</th>
                <th className="text-right py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => {
                const checkTone =
                  c.status === "ok"      ? "text-emerald-700"
                  : c.status === "pending" ? "text-sky-700"
                  : c.status === "warn"    ? "text-amber-700"
                  : "text-red-700";
                const checkLabel =
                  c.status === "ok"      ? "✓ ok"
                  : c.status === "pending" ? "⏱ pending"
                  : c.status === "warn"    ? "⚠ warn"
                  : "✗ fail";
                return (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium text-foreground">{c.name}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtEur(c.source_total)}
                      <span className="text-muted-foreground" title="Line items in the Cockpit sheet"> · {c.source_rows.toLocaleString()} tx</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtEur(c.stored_total)}
                      <span className="text-muted-foreground" title="Daily aggregate rows (1 row = 1 day × 1 location)"> · {c.stored_rows.toLocaleString()} daily</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {c.diff === 0 ? "—" : `${c.diff > 0 ? "+" : ""}${fmtEur(c.diff)}`}
                      <span className="text-muted-foreground"> ({c.diff_pct.toFixed(2)}%)</span>
                    </td>
                    <td className={`py-2 text-right font-semibold ${checkTone}`}>
                      {checkLabel}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {checks.some((c) => c.note) && (
            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
              {checks.filter((c) => c.note).map((c) => (
                <li key={c.name}><span className="font-medium text-foreground">{c.name}:</span> {c.note}</li>
              ))}
            </ul>
          )}

          <div className="pt-2 border-t border-border text-[10px] text-muted-foreground leading-relaxed">
            <p><span className="font-medium text-foreground">Bands:</span> ✓ ≤ {methodology.bands.ok_pct}% drift · ⚠ ≤ {methodology.bands.warn_pct}% · ✗ greater.</p>
            <p className="mt-1"><span className="font-medium text-foreground">Source A:</span> {methodology.sources.A}</p>
            <p><span className="font-medium text-foreground">Source B:</span> {methodology.sources.B}</p>
          </div>
        </div>
      )}
    </div>
  );
}
