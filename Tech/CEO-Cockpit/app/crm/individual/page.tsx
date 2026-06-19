"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { AgentTeamBanner } from "@/components/crm/AgentTeamBanner";
import { AgentLeaderboardCards } from "@/components/crm/AgentLeaderboardCards";
import { AgentComparisonTable } from "@/components/crm/AgentComparisonTable";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { AlertCircle } from "lucide-react";

function IndividualKPIsContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError, error } = useCrmAgents(dateFrom, dateTo);
  const [syncError, setSyncError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSync = useCallback(async () => {
    setSyncError(null);
    const res = await fetch("/api/etl/crm-agents", { method: "POST" });
    const json = await res.json().catch(() => ({})) as {
      errors?: string[];
      error?: string;
    };
    if (!res.ok) {
      setSyncError(json.error ?? `HTTP ${res.status}`);
      return;
    }
    if (json.errors?.length) {
      setSyncError(`Partial sync — ${json.errors.length} agent(s) failed: ${json.errors[0]}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["crm-agents"] });
  }, [queryClient]);

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
        </div>
        <SyncButton onSync={handleSync} isExternalBusy={isLoading} />
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
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentLeaderboardCards agents={agents} />
        )}
      </section>

      {/* Section 3: Team Performance Table */}
      <section>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentComparisonTable agents={agents} />
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
