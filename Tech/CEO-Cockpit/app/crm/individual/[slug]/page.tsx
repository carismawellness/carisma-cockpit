"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AgentDetailPanel } from "@/components/crm/AgentDetailPanel";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { ChevronLeft, ExternalLink } from "lucide-react";

const AGENT_NAMES: Record<string, string> = {
  adeel:    "Adeel",
  rana:     "Rana",
  abid:     "Abid",
  km:       "K&M",
  vj:       "VJ",
  dorianne: "Dorianne",
  juliana:  "Juliana",
  anni:     "Anni",
  nicci:    "Nicci",
  nathalia: "Nathalia",
  april:    "April",
  queenee:  "Queenee",
};

const CRM_MASTER_SHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI";

function AgentPageContent({
  slug,
  dateFrom,
  dateTo,
}: {
  slug: string;
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading, isError } = useCrmAgents(dateFrom, dateTo);

  const agentName = AGENT_NAMES[slug];
  if (!agentName) notFound();

  const agent = agents.find((a) => a.slug === slug);
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${CRM_MASTER_SHEET_ID}/edit`;

  return (
    <>
      {/* Breadcrumb + header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link
            href="/crm/individual"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Agent KPIs
          </Link>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            {agentName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRangeLabel(dateFrom, dateTo)} · CRM performance
          </p>
        </div>
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          CRM Master Sheet ↗
        </a>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load agent data. Try refreshing.
        </div>
      )}

      {/* No data for this agent */}
      {!isLoading && !isError && !agent && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-16 text-center text-sm text-muted-foreground">
          No data for {agentName} in the selected period.
        </div>
      )}

      {/* Agent detail */}
      {!isLoading && agent && (
        <AgentDetailPanel agent={agent} />
      )}
    </>
  );
}

export default function AgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <AgentPageContent
          slug={slug}
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
