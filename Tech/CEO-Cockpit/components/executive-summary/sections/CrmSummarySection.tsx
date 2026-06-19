"use client";

/**
 * CRM section of the Executive Summary.
 *
 * Replicates the CRM Master dashboard (`app/crm/page.tsx`):
 *  - RAG / verdict / focus areas / wins come from `computeCrmMasterCommentary`
 *    over the LIVE GHL message-queue snapshot (`useGhlSnapshot`), exactly as the
 *    page's <CrmMasterCommentary> does.
 *  - Period-sensitive KPIs reuse the same date-ranged hooks the page uses:
 *      • Speed-to-Lead   → useSpeedToLead    (group median, weighted by responded)
 *      • Lead Recon      → useKPIData(crm_lead_reconciliation) (sum leads_crm)
 *      • Pipeline Funnel → useGhlFunnel (cohort): Bookings Won + Lead-conversion %
 *  - The hero KPI [0] is the group Speed-to-Lead median (the core CRM health
 *    number). The live unanswered-messages count is surfaced last and is the
 *    only live-snapshot (NOT date-ranged) KPI.
 *
 * Data caveats honoured (cockpit AGENTS.md): we never surface
 * `crm_agent_daily.total_sales` as revenue, nor agent self-reported bookings —
 * all booking/conversion figures here come from the GHL pipeline funnel.
 */

import { useEffect, useMemo } from "react";
import { Headphones } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import {
  normalizeRag,
  type SectionProps,
  type DeptSummary,
  type DeptHeadlineKpi,
} from "@/lib/types/executive-summary";
import { computeCrmMasterCommentary } from "@/lib/commentary/engine";
import { useGhlSnapshot } from "@/lib/hooks/useGhlSnapshot";
import { useSpeedToLead } from "@/lib/hooks/useSpeedToLead";
import { useGhlFunnel } from "@/lib/hooks/useGhlFunnel";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { formatMinutes } from "@/lib/charts/config";
import { isExcludedCrmDate } from "@/lib/constants/excluded-dates";
import type { LeadReconRow } from "@/lib/types/crm";

const META = { slug: "crm", label: "CRM", path: "/crm" } as const;

const BRANDS = ["spa", "aesthetics", "slimming"] as const;

// Pipeline stage names — mirror PipelineFunnel.tsx exactly.
const ALL_LEAD_STAGES = [
  "New Leads",
  "Call Back",
  "Contacted",
  "Booking Won",
  "Active Member",
  "Booking Lost",
  "No Show",
  "Nurturing",
];

export function CrmSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  // ── Live snapshot (NOT date-ranged) → drives RAG/verdict/focus/wins ──────────
  const { snapshot, isLoading: snapLoading } = useGhlSnapshot();

  // ── Date-ranged hooks (no brand filter — group-wide roll-up) ─────────────────
  const { data: stl, isLoading: stlLoading } = useSpeedToLead(dateFrom, dateTo, null);
  const { data: funnel, isLoading: funnelLoading } = useGhlFunnel(dateFrom, dateTo, "cohort");
  const { brandMap } = useLookups();
  const { data: reconRows, loading: reconLoading } = useKPIData<LeadReconRow>({
    table: "crm_lead_reconciliation",
    dateFrom,
    dateTo,
    brandFilter: null,
  });

  const loading = snapLoading || stlLoading || funnelLoading || reconLoading;

  // ── Commentary (replicates <CrmMasterCommentary snapshot={snapshot} />) ──────
  const result = useMemo(() => computeCrmMasterCommentary(snapshot), [snapshot]);

  // ── KPI computation ──────────────────────────────────────────────────────────
  const summary = useMemo<DeptSummary>(() => {
    // [0] Speed-to-Lead — group median, responded-weighted (date-ranged).
    let respondedSum = 0;
    let medianWeighted = 0;
    for (const slug of BRANDS) {
      const s = stl?.brands[slug];
      if (!s) continue;
      respondedSum += s.responded;
      medianWeighted += (s.median_min ?? 0) * s.responded;
    }
    const groupMedian = respondedSum > 0 ? medianWeighted / respondedSum : 0;

    // Lead reconciliation — CRM leads created in period (date-ranged).
    const brandIds = new Set(BRANDS.map((b) => brandMap[b]).filter(Boolean));
    let crmLeads = 0;
    for (const row of reconRows) {
      if (isExcludedCrmDate(row.date)) continue;
      if (brandIds.size > 0 && !brandIds.has(row.brand_id)) continue;
      crmLeads += row.leads_crm;
    }

    // Pipeline funnel — Bookings Won + Lead-conversion % (date-ranged, cohort).
    const sumStage = (stage: string) =>
      BRANDS.reduce((acc, b) => acc + (funnel?.brands[b]?.[stage] ?? 0), 0);
    const won = sumStage("Booking Won");
    const totalAllLeads = ALL_LEAD_STAGES.reduce((acc, s) => acc + sumStage(s), 0);
    const leadConvPct = totalAllLeads > 0 ? (won / totalAllLeads) * 100 : null;

    // Live snapshot — unanswered messages across brands (NOT date-ranged).
    const unanswered =
      [snapshot.spa, snapshot.aesthetics, snapshot.slimming].reduce(
        (acc, b) => acc + b.unreadWhatsapp + b.unreadCrm + b.unreadEmail,
        0,
      );

    const kpis: DeptHeadlineKpi[] = [
      {
        label: "Speed-to-Lead (median)",
        value: respondedSum > 0 ? formatMinutes(groupMedian) : "—",
      },
      {
        label: "CRM Leads",
        value: crmLeads.toLocaleString("en-GB"),
      },
      {
        label: "Lead Conversion",
        value: leadConvPct !== null ? `${leadConvPct.toFixed(1)}%` : "—",
      },
      {
        label: "Bookings Won",
        value: won.toLocaleString("en-GB"),
      },
      {
        label: "Unanswered · live",
        value: unanswered.toLocaleString("en-GB"),
      },
    ];

    return {
      ...META,
      rag: normalizeRag(result.overallRag),
      headline: result.verdict,
      kpis,
      focusAreas: result.focusAreas.map((f) => f.template),
      wins: result.wins.map((w) => w.template),
      loading,
    };
  }, [stl, funnel, reconRows, brandMap, snapshot, result, loading]);

  // ── Report up (effect only — never during render) ────────────────────────────
  useEffect(() => {
    if (loading) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading CRM summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
    } else {
      onSummary(summary);
    }
  }, [loading, summary, onSummary]);

  return (
    <SectionCard
      {...META}
      icon={Headphones}
      rag={summary.rag}
      headline={summary.headline}
      kpis={summary.kpis}
      focusAreas={summary.focusAreas}
      wins={summary.wins}
      loading={loading}
    />
  );
}
