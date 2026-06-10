"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  RefreshCw, ExternalLink, CheckCircle2, XCircle,
  Clock, AlertTriangle, Database, Loader2, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

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

function DataSourcesContent() {
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

      {/* Advanced: Month-by-Month Backfill (was the standalone Data Sync page) */}
      <ZohoBackfillSection />

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

// ── Month-by-month Zoho backfill (moved from /settings/etl-runner) ────────────

type ETLJob       = "spa" | "aesthetics" | "both";
type MonthStatus  = "pending" | "running" | "done" | "failed" | "timeout";

interface MonthRow {
  month:    string;
  label:    string;
  status:   MonthStatus;
  message:  string;
  duration: number | null;
}

function buildMonths(from: string, to: string): MonthRow[] {
  const rows: MonthRow[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const label = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    rows.push({ month: `${y}-${String(m).padStart(2, "0")}-01`, label, status: "pending", message: "", duration: null });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return rows;
}

function lastDayOfMonth(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${last}`;
}

function etlEndpoint(job: ETLJob): string[] {
  if (job === "both")       return ["/api/etl/zoho-spa-transactions", "/api/etl/zoho-aesthetics-transactions"];
  if (job === "aesthetics") return ["/api/etl/zoho-aesthetics-transactions"];
  return ["/api/etl/zoho-spa-transactions"];
}

function ZohoBackfillSection() {
  const [expanded, setExpanded] = useState(false);
  const [fromMonth, setFromMonth] = useState("2025-01-01");
  const [toMonth,   setToMonth]   = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [job, setJob]           = useState<ETLJob>("spa");
  const [rows, setRows]         = useState<MonthRow[]>([]);
  const [running, setRunning]   = useState(false);
  const abortRef                = useRef<boolean>(false);

  const months: { value: string; label: string }[] = [];
  const start = new Date(2025, 0, 1);
  const end   = new Date();
  end.setMonth(end.getMonth() + 1);
  const d = new Date(start);
  while (d <= end) {
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const lbl = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    months.unshift({ value: val, label: lbl });
    d.setMonth(d.getMonth() + 1);
  }

  const updateRow = useCallback((month: string, patch: Partial<MonthRow>) => {
    setRows(prev => prev.map(r => r.month === month ? { ...r, ...patch } : r));
  }, []);

  const runETL = useCallback(async () => {
    abortRef.current = false;
    const monthRows = buildMonths(fromMonth, toMonth);
    setRows(monthRows);
    setRunning(true);
    const endpoints = etlEndpoint(job);

    for (const row of monthRows) {
      if (abortRef.current) break;
      const dateTo = lastDayOfMonth(row.month);
      updateRow(row.month, { status: "running", message: "Running…" });
      const t0 = Date.now();

      for (const endpoint of endpoints) {
        if (abortRef.current) break;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6 * 60 * 1000);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date_from: row.month, date_to: dateTo, force: true }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const duration = Math.round((Date.now() - t0) / 1000);
          if (res.status === 504) {
            updateRow(row.month, { status: "timeout", message: "Timed out (>5 min) — may still have written partial data. Retry this month.", duration });
            break;
          }
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            updateRow(row.month, { status: "failed", message: `HTTP ${res.status}: ${txt.slice(0, 100)}`, duration });
            break;
          }
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          const lastLog = (data.log as string[] | undefined)?.slice(-1)[0] ?? "done";
          updateRow(row.month, { status: "done", message: lastLog, duration: Math.round((Date.now() - t0) / 1000) });
        } catch (e: unknown) {
          const duration = Math.round((Date.now() - t0) / 1000);
          const msg = e instanceof Error && e.name === "AbortError"
            ? "Timed out (6 min) — retry this month"
            : (e instanceof Error ? e.message : String(e));
          updateRow(row.month, { status: "timeout", message: msg, duration });
          break;
        }
      }
      if (!abortRef.current) await new Promise(r => setTimeout(r, 3000));
    }
    setRunning(false);
  }, [fromMonth, toMonth, job, updateRow]);

  const done   = rows.filter(r => r.status === "done").length;
  const failed = rows.filter(r => r.status === "failed" || r.status === "timeout").length;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        {expanded
          ? <ChevronDown  className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <div className="flex-1">
          <h2 className="font-semibold text-sm">Advanced — Month-by-month Zoho backfill</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Re-pull Zoho transaction data month by month (SPA / Aesthetics). 3s gap between months to respect rate limits.
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-5 space-y-4 bg-muted/10">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From month</label>
              <select
                value={fromMonth}
                onChange={e => setFromMonth(e.target.value)}
                disabled={running}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground disabled:opacity-50"
              >
                {[...months].reverse().map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To month</label>
              <select
                value={toMonth}
                onChange={e => setToMonth(e.target.value)}
                disabled={running}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground disabled:opacity-50"
              >
                {months.map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ETL source</label>
              <select
                value={job}
                onChange={e => setJob(e.target.value as ETLJob)}
                disabled={running}
                className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground disabled:opacity-50"
              >
                <option value="spa">SPA only</option>
                <option value="aesthetics">Aesthetics only</option>
                <option value="both">Both SPA + Aesthetics</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={runETL}
              disabled={running}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "Running…" : "Run backfill"}
            </button>

            {running && (
              <button
                onClick={() => { abortRef.current = true; }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Stop
              </button>
            )}
          </div>

          {rows.length > 0 && (
            <div className="rounded-md border border-border bg-background overflow-hidden">
              <div className="flex items-center gap-6 px-4 py-2 border-b border-border bg-muted/30 text-xs">
                <span className="text-muted-foreground">{rows.length} months</span>
                <span className="text-emerald-600 font-medium">{done} done</span>
                {failed > 0 && <span className="text-red-500 font-medium">{failed} failed/timeout</span>}
                <span className="text-muted-foreground">{rows.filter(r => r.status === "pending").length} pending</span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-4 font-semibold text-muted-foreground">Month</th>
                    <th className="text-left py-1.5 px-4 font-semibold text-muted-foreground">Status</th>
                    <th className="text-left py-1.5 px-4 font-semibold text-muted-foreground">Result</th>
                    <th className="text-right py-1.5 px-4 font-semibold text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.month} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="py-1.5 px-4 font-medium text-foreground">{row.label}</td>
                      <td className="py-1.5 px-4">
                        {row.status === "pending"  && <span className="text-muted-foreground">—</span>}
                        {row.status === "running"  && <span className="inline-flex items-center gap-1.5 text-blue-600"><RefreshCw className="h-3 w-3 animate-spin" /> Running</span>}
                        {row.status === "done"     && <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Done</span>}
                        {row.status === "failed"   && <span className="inline-flex items-center gap-1.5 text-red-500"><XCircle className="h-3 w-3" /> Failed</span>}
                        {row.status === "timeout"  && <span className="inline-flex items-center gap-1.5 text-amber-500"><Clock className="h-3 w-3" /> Timeout</span>}
                      </td>
                      <td className="py-1.5 px-4 text-muted-foreground max-w-md truncate" title={row.message}>{row.message || "—"}</td>
                      <td className="py-1.5 px-4 text-right text-muted-foreground tabular-nums">
                        {row.duration !== null ? `${row.duration}s` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function DataSourcesPage() {
  return (
    <DashboardShell>
      {() => <DataSourcesContent />}
    </DashboardShell>
  );
}
