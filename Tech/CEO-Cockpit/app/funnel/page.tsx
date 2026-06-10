"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ConstraintHeatmap } from "@/components/funnel/ConstraintHeatmap";
import { CampaignFunnelPanel } from "@/components/funnel/CampaignFunnelPanel";
import { CIChat } from "@/components/ci/CIChat";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";

function FunnelContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  return (
    <>
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Funnel Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {formatDateRangeLabel(dateFrom, dateTo)} · Full-funnel constraint analysis
        </p>
      </div>

      {/* 1. Constraint Heatmap — conclusion first */}
      <section>
        <ConstraintHeatmap dateFrom={dateFrom} dateTo={dateTo} />
      </section>

      {/* 2. Campaign Drill-Down — per brand */}
      <section>
        <CampaignFunnelPanel dateFrom={dateFrom} dateTo={dateTo} />
      </section>

      <CIChat />
    </>
  );
}

export default function FunnelPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <FunnelContent dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      )}
    </DashboardShell>
  );
}
