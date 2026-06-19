"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  ChevronRight,
} from "lucide-react";

type SyncLog = {
  status:       "running" | "success" | "partial" | "failed";
  started_at:   string;
  completed_at: string | null;
};

type DataSource = {
  id:        string;
  name:      string;
  brand:     string;
  endpoint:  string | null;
  last_sync: SyncLog | null;
};

type ApiResponse = {
  sources:    DataSource[];
  fetched_at: string;
};

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  const h    = Math.floor(m / 60);
  const d    = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function mostRecent(sources: DataSource[]): { iso: string; name: string } | null {
  let best: { iso: string; name: string } | null = null;
  for (const s of sources) {
    if (!s.last_sync) continue;
    if (!best || s.last_sync.started_at > best.iso) {
      best = { iso: s.last_sync.started_at, name: s.name };
    }
  }
  return best;
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;  // 24 hours

/**
 * Overall health = freshness of the most-recent sync, not the worst per-source
 * status. The widget should reassure the user that data IS being refreshed
 * (green check) unless the freshest sync is now > 24h old.
 *
 * - "success" → most-recent sync ≤ 24h ago (any source)
 * - "stale"   → most-recent sync > 24h ago
 * - "unknown" → no source has ever logged a sync
 */
function overallHealth(
  sources: DataSource[],
  recent: { iso: string } | null,
): "success" | "stale" | "unknown" {
  if (sources.length === 0 || !recent) return "unknown";
  const ageMs = Date.now() - new Date(recent.iso).getTime();
  return ageMs <= STALE_AFTER_MS ? "success" : "stale";
}

export function SyncStatusWidget() {
  const [data, setData]               = useState<ApiResponse | null>(null);
  const [open, setOpen]               = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [syncProgress, setSyncProgress] = useState<string>("");
  const popoverRef                    = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/data-sources");
      const d   = await res.json();
      setData(d);
    } catch {
      // silent — widget stays in last-known state
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function syncAll() {
    if (!data || syncing) return;
    const triggerable = data.sources.filter((s) => s.endpoint);
    setSyncing(true);
    let done = 0;
    for (const src of triggerable) {
      setSyncProgress(`${done + 1}/${triggerable.length} · ${src.name}`);
      try {
        await fetch("/api/settings/data-sources", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ source_id: src.id }),
        });
      } catch {
        // continue with next source
      }
      done++;
    }
    setSyncProgress("");
    setSyncing(false);
    // Give the backend a moment, then refresh status
    setTimeout(load, 2000);
  }

  const recent = data ? mostRecent(data.sources) : null;
  const health = data ? overallHealth(data.sources, recent) : "unknown";

  const statusIcon =
    health === "success" ? <CheckCircle2  className="h-3.5 w-3.5 text-emerald-600" /> :
    health === "stale"   ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500"  /> :
                           <Clock         className="h-3.5 w-3.5 text-muted-foreground" />;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Data sync status"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white/70 hover:bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-all shadow-sm hover:shadow"
      >
        {syncing
          ? <RefreshCw className="h-3.5 w-3.5 text-gold animate-spin" />
          : statusIcon}
        <span className="hidden sm:inline tabular-nums">
          {syncing
            ? "Syncing…"
            : recent
              ? `Synced ${timeSince(recent.iso)}`
              : "Not synced"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[300px] rounded-xl border border-border bg-card shadow-lg z-40 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Data Sync</p>
            {recent ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Last sync {timeSince(recent.iso)} · {new Date(recent.iso).toLocaleString()}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5">No sync recorded yet</p>
            )}
          </div>

          {/* Per-source status (compact) */}
          {data && (
            <div className="max-h-[260px] overflow-y-auto py-1">
              {data.sources.map((s) => {
                const log = s.last_sync;
                const icon = !log ? <Clock className="h-3 w-3 text-muted-foreground" />
                  : log.status === "success" ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : log.status === "running" ? <Loader2 className="h-3 w-3 text-blue-600 animate-spin" />
                  : log.status === "partial" ? <AlertTriangle className="h-3 w-3 text-amber-500" />
                  : <XCircle className="h-3 w-3 text-red-500" />;
                return (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-muted/30">
                    {icon}
                    <span className="flex-1 truncate text-foreground">{s.name}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {log ? timeSince(log.started_at) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Progress bar while syncing */}
          {syncing && syncProgress && (
            <div className="px-3 py-2 border-t border-border bg-blue-50/50">
              <p className="text-[11px] text-blue-700 truncate">
                <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />
                {syncProgress}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/20">
            <button
              onClick={syncAll}
              disabled={syncing || !data}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold/90 hover:bg-gold text-white px-3 py-1.5 text-[11px] font-medium disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync All"}
            </button>
            <Link
              href="/settings/data-sources"
              onClick={() => setOpen(false)}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Details
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
