// app/executive-summary/page.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CeoVerdictCard } from "@/components/executive-summary/CeoVerdictCard";
import { HeroKpiStrip } from "@/components/executive-summary/HeroKpiStrip";
import { SalesSummarySection } from "@/components/executive-summary/sections/SalesSummarySection";
import { FinanceSummarySection } from "@/components/executive-summary/sections/FinanceSummarySection";
import { MarketingSummarySection } from "@/components/executive-summary/sections/MarketingSummarySection";
import { CrmSummarySection } from "@/components/executive-summary/sections/CrmSummarySection";
import { FunnelSummarySection } from "@/components/executive-summary/sections/FunnelSummarySection";
import { OperationsSummarySection } from "@/components/executive-summary/sections/OperationsSummarySection";
import { HrSummarySection } from "@/components/executive-summary/sections/HrSummarySection";
import { PipelineFunnel } from "@/components/crm/PipelineFunnel";
import { computeCeoRollup } from "@/lib/commentary/ceo-rollup";
import type { DeptSummary } from "@/lib/types/executive-summary";

function fmtRange(from: Date, to: Date): string {
  const f = from.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const t = to.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${f} – ${t}`;
}

/** Cheap structural equality so a section re-reporting identical data doesn't
 *  trigger a redundant render (and can't cause an update loop). */
function sameSummary(a: DeptSummary | undefined, b: DeptSummary): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function ExecutiveSummaryContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const [summaries, setSummaries] = useState<Record<string, DeptSummary>>({});

  const report = useCallback((s: DeptSummary) => {
    setSummaries((prev) => (sameSummary(prev[s.slug], s) ? prev : { ...prev, [s.slug]: s }));
  }, []);

  const rollup = useMemo(() => computeCeoRollup(Object.values(summaries)), [summaries]);
  const periodLabel = useMemo(() => fmtRange(dateFrom, dateTo), [dateFrom, dateTo]);

  const sectionProps = { dateFrom, dateTo, onSummary: report };

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Executive Summary</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every dashboard, condensed · {periodLabel}
        </p>
      </div>

      <CeoVerdictCard rollup={rollup} periodLabel={periodLabel} />

      <HeroKpiStrip summaries={summaries} />

      <div className="space-y-3 md:space-y-4">
        <SalesSummarySection {...sectionProps} />
        <FinanceSummarySection {...sectionProps} />
        <MarketingSummarySection {...sectionProps} />
        <CrmSummarySection {...sectionProps} />
        <PipelineFunnel dateFrom={dateFrom} dateTo={dateTo} brandFilter={null} />
        <FunnelSummarySection {...sectionProps} />
        <OperationsSummarySection {...sectionProps} />
        <HrSummarySection {...sectionProps} />
      </div>
    </div>
  );
}

export default function ExecutiveSummaryPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => <ExecutiveSummaryContent dateFrom={dateFrom} dateTo={dateTo} />}
    </DashboardShell>
  );
}
