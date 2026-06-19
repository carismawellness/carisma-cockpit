"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

interface SyncButtonProps {
  onSync: () => Promise<void>;
  lastSynced?: string | null;
  isExternalBusy?: boolean;
  label?: string;
}

export function SyncButton({
  onSync,
  lastSynced,
  isExternalBusy = false,
  label = "Re-Sync",
}: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState(false);

  const handleClick = async () => {
    setSyncing(true);
    try {
      await onSync();
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } finally {
      setSyncing(false);
    }
  };

  const isBusy = syncing || isExternalBusy;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isBusy}
        className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
          done
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "hover:bg-muted"
        }`}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing…" : done ? "Updated ✓" : label}
      </button>
      {lastSynced && (
        <span className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(parseISO(lastSynced), { addSuffix: true })}
        </span>
      )}
    </div>
  );
}
