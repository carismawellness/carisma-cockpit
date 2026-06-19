"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

export function GHLSyncBadge() {
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/ghl-sync-status");
      if (res.ok) {
        const json = (await res.json()) as { last_synced: string | null };
        setLastSynced(json.last_synced);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/etl/ghl-crm", { method: "POST" });
      await fetchStatus();
    } finally {
      setSyncing(false);
    }
  };

  const syncedLabel = lastSynced
    ? `GHL synced ${new Date(lastSynced).toLocaleString("en-GB", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })}`
    : "GHL not yet synced";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        title="Re-sync GHL CRM data"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing…" : "Re-Sync GHL"}
      </button>
      <span className="text-[10px] text-muted-foreground">{syncedLabel}</span>
    </div>
  );
}
