"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AgentTeamBanner } from "@/components/crm/AgentTeamBanner";
import { AgentLeaderboardCards } from "@/components/crm/AgentLeaderboardCards";
import { AgentDetailTabs } from "@/components/crm/AgentDetailTabs";
import { AgentComparisonTable } from "@/components/crm/AgentComparisonTable";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { RefreshCw, AlertCircle } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";

function LastSyncedBadge() {
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/sync-status")
      .then((r) => r.json())
      .then(({ last_synced }: { last_synced: string | null }) => {
        setLastSynced(last_synced);
      })
      .catch(() => {});
  }, []);

  if (!lastSynced) return null;

  return (
    <span className="text-xs text-muted-foreground">
      Last synced {formatDistanceToNow(parseISO(lastSynced), { addSuffix: true })}
    </span>
  );
}

function IndividualKPIsContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError, error } = useCrmAgents(dateFrom, dateTo);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/etl/crm-agents", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setSyncError((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            Team Performance Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Carisma Wellness Group · Sales Team · {formatDateRangeLabel(dateFrom, dateTo)}
          </p>
          <div className="mt-1">
            <LastSyncedBadge />
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing || isLoading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing…" : "Re-Sync"}
        </button>
      </div>

      {/* Error states */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load agent data: {error}</span>
        </div>
      )}
      {syncError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Sync error: {syncError}</span>
        </div>
      )}

      {/* Section 1: Team Totals Banner */}
      {isLoading ? (
        <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
      ) : (
        <AgentTeamBanner agents={agents} />
      )}

      {/* Section 2: Agent Leaderboard Cards */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Agent Leaderboard
        </h2>
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentLeaderboardCards agents={agents} />
        )}
      </section>

      {/* Section 3: Team Performance Table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Team Performance
        </h2>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentComparisonTable agents={agents} />
        )}
      </section>

      {/* Section 4: Agent Detail Drill-Down */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Agent Detail
        </h2>
        {isLoading ? (
          <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentDetailTabs agents={agents} />
        )}
      </section>
    </>
  );
}

export default function CRMIndividualPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <IndividualKPIsContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
