"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesPerformance } from "@/components/crm/SalesPerformance";
import { MessageQueueHealth } from "@/components/crm/MessageQueueHealth";
import { LeadReconciliation } from "@/components/crm/LeadReconciliation";
import { LeadsPerHour } from "@/components/crm/LeadsPerHour";
import { PipelineFunnel } from "@/components/crm/PipelineFunnel";
import { SpeedToLeadSection } from "@/components/crm/SpeedToLeadSection";
import { GHLSyncBadge } from "@/components/crm/GHLSyncBadge";
import { CrmMasterCommentary } from "@/components/crm/CrmStrategicCommentary";
import { useGhlSnapshot } from "@/lib/hooks/useGhlSnapshot";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { CalendarRange } from "lucide-react";

function CRMContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { snapshot } = useGhlSnapshot();

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">CRM Master</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDateRangeLabel(dateFrom, dateTo)} · Cross-brand CRM performance
          </p>
        </div>
        <GHLSyncBadge />
      </div>

      {/* ── LIVE SNAPSHOT ZONE ────────────────────────────────────────────────
          This section is always current — it ignores the date filter above.
          Intentionally placed first and visually segregated to make that clear.
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 md:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {/* Pulsing live dot */}
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <h2 className="text-base font-semibold text-foreground">Message Queue Health</h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 uppercase tracking-wide">
              Live · Now
            </span>
          </div>
          <p className="text-xs text-muted-foreground sm:text-right leading-relaxed">
            Always reflects the current GHL state —{" "}
            <span className="font-semibold text-foreground">not affected by the date filter</span>
          </p>
        </div>
        <MessageQueueHealth dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
        {/* GHL Queue Strategic Commentary */}
        <CrmMasterCommentary snapshot={snapshot} />
      </div>

      {/* ── DATE-RANGE DIVIDER ───────────────────────────────────────────────
          Everything below here is scoped to the selected date range.
      ─────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 -my-1">
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium px-2">
          <CalendarRange className="h-3.5 w-3.5" />
          <span>Date-range metrics · {formatDateRangeLabel(dateFrom, dateTo)}</span>
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Sales Performance by Brand */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Sales Performance</h2>
        <SalesPerformance dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Lead Reconciliation */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Lead Reconciliation</h2>
        <LeadReconciliation dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Pipeline Funnel */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Pipeline Funnel</h2>
        <PipelineFunnel dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Speed to Lead */}
      <SpeedToLeadSection dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />

      {/* Daily Lead Volume */}
      <section>
        <LeadsPerHour dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>
    </>
  );
}

export default function CRMPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <CRMContent dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      )}
    </DashboardShell>
  );
}
