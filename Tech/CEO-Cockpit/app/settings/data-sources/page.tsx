"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  RefreshCw, ExternalLink, CheckCircle2, XCircle,
  Clock, AlertTriangle, Database, Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncLog = {
  source_name:  string;
  status:       "running" | "success" | "partial" | "failed";
  rows_upserted: number;
  started_at:   string;
  completed_at: string | null;
  duration_sec: number | null;
  error_message: string | null;
};

type Coverage = {
  from_date: string | null;
  to_date:   string | null;
  rows:      number;
};

type DataSource = {
  id:          string;
  name:        string;
  description: string;
  tables:      readonly string[];
  brand:       string;
  frequency:   string;
  log_key:     string | null;
  endpoint:    string | null;
  manual_note: string | null;
  last_sync:   SyncLog | null;
  coverage:    Coverage | null;
};

type ApiResponse = {
  sources:    DataSource[];
  fetched_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  const h    = Math.floor(m / 60);
  const d    = Math.floor(h / 24);
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  return "just now";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function StatusBadge({ log }: { log: SyncLog | null }) {
  if (!log) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-0.5">
        <Clock className="h-3 w-3" />unknown
      </span>
    );
  }
  const map = {
    success: { icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-emerald-100 text-emerald-700", label: "success" },
    running: { icon: <Loader2  className="h-3 w-3 animate-spin" />, cls: "bg-blue-100 text-blue-700",    label: "running" },
    partial: { icon: <AlertTriangle className="h-3 w-3" />,         cls: "bg-amber-100 text-amber-700",  label: "partial" },
    failed:  { icon: <XCircle  className="h-3 w-3" />,              cls: "bg-red-100 text-red-700",      label: "failed"  },
  } as const;
  const { icon, cls, label } = map[log.status] ?? map.failed;
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded px-2 py-0.5 font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

function BrandChip({ brand }: { brand: string }) {
  const cls =
    brand === "SPA"      ? "bg-sky-100 text-sky-700" :
    brand === "AES"      ? "bg-purple-100 text-purple-700" :
    brand === "SLIM"     ? "bg-orange-100 text-orange-700" :
    brand === "AES / SLIM" ? "bg-indigo-100 text-indigo-700" :
    "bg-muted text-muted-foreground";
  return <span className={`text-xs rounded px-1.5 py-0.5 font-medium ${cls}`}>{brand}</span>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataSourcesPage() {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings/data-sources");
    const d   = await res.json();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function trigger(source: DataSource) {
    if (!source.endpoint) return;
    setTriggering(source.id);
    setTriggerResult(prev => ({ ...prev, [source.id]: "triggering…" }));
    try {
      const res = await fetch("/api/settings/data-sources", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ source_id: source.id }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setTriggerResult(prev => ({ ...prev, [source.id]: `✓ triggered for ${d.date_from} → ${d.date_to}` }));
      // Refresh status after 3s
      setTimeout(load, 3000);
    } catch (e) {
      setTriggerResult(prev => ({ ...prev, [source.id]: `✗ ${e instanceof Error ? e.message : "error"}` }));
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Data Sources</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All data pipelines feeding EBITDA V2 — sources, update frequency, last sync status, and data coverage.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Last sync succeeded</span>
        <span className="flex items-center gap-1"><Loader2  className="h-3.5 w-3.5 text-blue-600" />Currently running</span>
        <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />Partial sync</span>
        <span className="flex items-center gap-1"><XCircle  className="h-3.5 w-3.5 text-red-600" />Last sync failed</span>
        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />No log (manual or not yet run)</span>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />Loading…
        </div>
      )}

      {/* Source cards */}
      {data?.sources.map(src => (
        <Card key={src.id} className="p-5 space-y-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2 mb-1">
                <h2 className="font-semibold text-sm">{src.name}</h2>
                <BrandChip brand={src.brand} />
                <StatusBadge log={src.last_sync} />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{src.description}</p>
            </div>

            {/* Action */}
            <div className="shrink-0">
              {src.endpoint ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={triggering === src.id}
                  onClick={() => trigger(src)}
                  className="gap-1.5 whitespace-nowrap"
                >
                  {triggering === src.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync Now
                </Button>
              ) : src.manual_note ? (
                <Link href={src.manual_note}>
                  <Button size="sm" variant="outline" className="gap-1.5 whitespace-nowrap">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open settings
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>

          {/* Trigger result */}
          {triggerResult[src.id] && (
            <p className={`text-xs rounded px-2 py-1 ${
              triggerResult[src.id].startsWith("✓")
                ? "bg-emerald-50 text-emerald-700"
                : triggerResult[src.id].startsWith("✗")
                ? "bg-red-50 text-red-700"
                : "bg-blue-50 text-blue-700"
            }`}>
              {triggerResult[src.id]}
            </p>
          )}

          {/* Detail grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {/* Frequency */}
            <div>
              <p className="text-muted-foreground font-medium mb-0.5">Update frequency</p>
              <p className="text-foreground">{src.frequency}</p>
            </div>

            {/* Last sync */}
            <div>
              <p className="text-muted-foreground font-medium mb-0.5">Last sync</p>
              {src.last_sync ? (
                <>
                  <p className="text-foreground">{timeSince(src.last_sync.started_at)}</p>
                  <p className="text-muted-foreground">{new Date(src.last_sync.started_at).toLocaleString()}</p>
                  {src.last_sync.rows_upserted > 0 && (
                    <p className="text-muted-foreground">{src.last_sync.rows_upserted.toLocaleString()} rows</p>
                  )}
                  {src.last_sync.duration_sec && (
                    <p className="text-muted-foreground">{src.last_sync.duration_sec}s</p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">No log recorded</p>
              )}
              {src.last_sync?.error_message && (
                <p className="text-red-600 mt-1 break-words">{src.last_sync.error_message}</p>
              )}
            </div>

            {/* Coverage */}
            <div>
              <p className="text-muted-foreground font-medium mb-0.5">Data coverage</p>
              {src.coverage ? (
                <>
                  {src.coverage.from_date && src.coverage.to_date ? (
                    <p className="text-foreground">
                      {formatDate(src.coverage.from_date)} → {formatDate(src.coverage.to_date)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">—</p>
                  )}
                  <p className="text-muted-foreground">{src.coverage.rows.toLocaleString()} rows</p>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>

            {/* Tables */}
            <div>
              <p className="text-muted-foreground font-medium mb-0.5">Supabase tables</p>
              <div className="flex flex-wrap gap-1">
                {src.tables.map(t => (
                  <span key={t} className="inline-flex items-center gap-0.5 bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                    <Database className="h-2.5 w-2.5 shrink-0" />
                    <span className="font-mono text-[10px]">{t}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ))}

      {/* Footer */}
      {data && (
        <p className="text-xs text-muted-foreground text-center">
          Last fetched {timeSince(data.fetched_at)} ·
          Nightly cron runs at ~03:45 UTC via Vercel Cron, processing a rolling 3-month window with force=true.
        </p>
      )}
    </div>
  );
}
