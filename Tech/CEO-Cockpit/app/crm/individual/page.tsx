"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AgentLeaderboardCards } from "@/components/crm/AgentLeaderboardCards";
import { AgentDetailTabs } from "@/components/crm/AgentDetailTabs";
import { AgentComparisonTable } from "@/components/crm/AgentComparisonTable";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";

// ── Inner content component (receives shell props) ─────────────────────────────

function IndividualKPIsContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError, error } = useCrmAgents(dateFrom, dateTo);

  return (
    <>
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-foreground md:text-2xl">
          Individual KPIs
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatDateRangeLabel(dateFrom, dateTo)} · Per-agent CRM performance
        </p>
      </div>

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load agent data: {error}
        </div>
      )}

      {/* Section 1: Agent Leaderboard Cards */}
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

      {/* Section 2: Agent Detail Drill-Down */}
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

      {/* Section 3: Cross-Agent Comparison Table */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-foreground">
          Cross-Agent Comparison
        </h2>
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <AgentComparisonTable agents={agents} />
        )}
      </section>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

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
