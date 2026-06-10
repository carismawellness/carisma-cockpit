"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesPerformance } from "@/components/crm/SalesPerformance";
import { SpeedToLeadSection } from "@/components/crm/SpeedToLeadSection";
import { MessageQueueHealth } from "@/components/crm/MessageQueueHealth";
import { BookingMix } from "@/components/crm/BookingMix";
import { RepLeaderboard } from "@/components/crm/RepLeaderboard";
import { LeadReconciliation } from "@/components/crm/LeadReconciliation";
import { LeadsPerHour } from "@/components/crm/LeadsPerHour";
import { CIChat } from "@/components/ci/CIChat";
import { GHLSyncBadge } from "@/components/crm/GHLSyncBadge";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";

function CRMContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
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

      {/* Sales Performance by Brand */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Sales Performance</h2>
        <SalesPerformance dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Message Queue Health */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Message Queue Health</h2>
        <MessageQueueHealth dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Leads per Hour Distribution */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Lead Volume by Hour</h2>
        <LeadsPerHour dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Lead Reconciliation */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Lead Reconciliation</h2>
        <LeadReconciliation dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Booking Mix */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Booking Mix</h2>
        <BookingMix dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Rep Leaderboard */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Rep Leaderboard</h2>
        <RepLeaderboard dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      {/* Speed to Lead — data not yet available */}
      <section>
        <SpeedToLeadSection dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      </section>

      <CIChat />
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
