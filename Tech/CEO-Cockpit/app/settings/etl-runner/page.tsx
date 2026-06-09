"use client";

import { useState, useRef, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ETLJob = "spa" | "aesthetics" | "both";
type MonthStatus = "pending" | "running" | "done" | "failed" | "timeout";

interface MonthRow {
  month: string;        // YYYY-MM-01
  label: string;        // "January 2026"
  status: MonthStatus;
  message: string;
  duration: number | null;  // seconds
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (job === "both") return ["/api/etl/zoho-spa-transactions", "/api/etl/zoho-aesthetics-transactions"];
  if (job === "aesthetics") return ["/api/etl/zoho-aesthetics-transactions"];
  return ["/api/etl/zoho-spa-transactions"];
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ETLRunner() {
  const [fromMonth, setFromMonth] = useState("2025-01-01");
  const [toMonth,   setToMonth]   = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [job, setJob] = useState<ETLJob>("spa");
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<boolean>(false);

  // Generate available month options
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
          const timeout = setTimeout(() => controller.abort(), 6 * 60 * 1000); // 6 min
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
          updateRow(row.month, {
            status: "done",
            message: lastLog,
            duration: Math.round((Date.now() - t0) / 1000),
          });
        } catch (e: unknown) {
          const duration = Math.round((Date.now() - t0) / 1000);
          const msg = e instanceof Error && e.name === "AbortError"
            ? "Timed out (6 min) — retry this month"
            : (e instanceof Error ? e.message : String(e));
          updateRow(row.month, { status: "timeout", message: msg, duration });
          break;
        }
      }

      // Pause between months to avoid Zoho rate limits
      if (!abortRef.current) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    setRunning(false);
  }, [fromMonth, toMonth, job, updateRow]);

  const retryFailed = useCallback(async () => {
    const failed = rows.filter(r => r.status === "failed" || r.status === "timeout");
    if (!failed.length) return;

    abortRef.current = false;
    setRunning(true);
    const endpoints = etlEndpoint(job);

    for (const row of failed) {
      if (abortRef.current) break;
      const dateTo = lastDayOfMonth(row.month);
      updateRow(row.month, { status: "running", message: "Retrying…" });
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
          if (!res.ok) {
            updateRow(row.month, { status: res.status === 504 ? "timeout" : "failed", message: `HTTP ${res.status}`, duration });
            break;
          }
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          const lastLog = (data.log as string[] | undefined)?.slice(-1)[0] ?? "done";
          updateRow(row.month, { status: "done", message: lastLog, duration });
        } catch (e: unknown) {
          const duration = Math.round((Date.now() - t0) / 1000);
          updateRow(row.month, { status: "timeout", message: e instanceof Error ? e.message : String(e), duration });
          break;
        }
      }
      if (!abortRef.current) await new Promise(r => setTimeout(r, 3000));
    }
    setRunning(false);
  }, [rows, job, updateRow]);

  const done   = rows.filter(r => r.status === "done").length;
  const failed = rows.filter(r => r.status === "failed" || r.status === "timeout").length;

  return (
    <DashboardShell hideDatePicker>
      {() => (
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Data Sync</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Re-pull Zoho transaction data into Supabase month by month. Runs sequentially with 3s gaps to respect Zoho rate limits.
            </p>
          </div>

          {/* Config */}
          <Card className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From month</label>
                <select
                  value={fromMonth}
                  onChange={e => setFromMonth(e.target.value)}
                  disabled={running}
                  className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-background text-foreground disabled:opacity-50"
                >
                  {[...months].reverse().map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
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
                  {months.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
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
                {running ? "Running…" : "Run ETL"}
              </button>

              {failed > 0 && !running && (
                <button
                  onClick={retryFailed}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted transition-colors"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Retry {failed} failed month{failed > 1 ? "s" : ""}
                </button>
              )}

              {running && (
                <button
                  onClick={() => { abortRef.current = true; }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </Card>

          {/* Progress */}
          {rows.length > 0 && (
            <Card className="overflow-hidden">
              {/* Summary bar */}
              <div className="flex items-center gap-6 px-4 py-3 border-b border-border bg-muted/20 text-sm">
                <span className="text-muted-foreground">{rows.length} months total</span>
                <span className="text-emerald-600 font-medium">{done} done</span>
                {failed > 0 && <span className="text-red-500 font-medium">{failed} failed/timeout</span>}
                <span className="text-muted-foreground">{rows.filter(r => r.status === "pending").length} pending</span>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Month</th>
                    <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Status</th>
                    <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Result</th>
                    <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.month} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="py-2 px-4 font-medium text-foreground">{row.label}</td>
                      <td className="py-2 px-4">
                        {row.status === "pending"  && <span className="text-muted-foreground">—</span>}
                        {row.status === "running"  && <span className="inline-flex items-center gap-1.5 text-blue-600"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Running</span>}
                        {row.status === "done"     && <span className="inline-flex items-center gap-1.5 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Done</span>}
                        {row.status === "failed"   && <span className="inline-flex items-center gap-1.5 text-red-500"><XCircle className="h-3.5 w-3.5" /> Failed</span>}
                        {row.status === "timeout"  && <span className="inline-flex items-center gap-1.5 text-amber-500"><Clock className="h-3.5 w-3.5" /> Timeout</span>}
                      </td>
                      <td className="py-2 px-4 text-muted-foreground text-xs max-w-md truncate" title={row.message}>{row.message || "—"}</td>
                      <td className="py-2 px-4 text-right text-muted-foreground tabular-nums">
                        {row.duration !== null ? `${row.duration}s` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
