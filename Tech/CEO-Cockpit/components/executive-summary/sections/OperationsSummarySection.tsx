"use client";

/**
 * Operations section of the Executive Summary.
 *
 * Replicates the Operations dashboard (`app/operations/page.tsx`) exactly:
 * same hooks (useGoogleReviews / useNegativeReviews / useDiligenceAudit /
 * useStandardsScores / useStandardsTrend), same OpsCommentaryInputs assembly,
 * and the same computeOpsCommentary engine — so the numbers + verdict match
 * the full dashboard for the selected date range.
 */

import { useEffect, useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import type {
  SectionProps,
  DeptSummary,
  DeptHeadlineKpi,
} from "@/lib/types/executive-summary";
import { normalizeRag } from "@/lib/types/executive-summary";
import {
  useGoogleReviews,
  useNegativeReviews,
  useDiligenceAudit,
  useStandardsScores,
  useStandardsTrend,
} from "@/lib/hooks/useOperationsData";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import {
  computeOpsCommentary,
  classifyFacilityTrend,
  classifyMysteryTrend,
  type OpsCommentaryInputs,
} from "@/lib/commentary/engine";

const META = { slug: "operations", label: "Operations", path: "/operations" } as const;

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Percentage of total sales, rounded — 0 when there are no sales. (matches page) */
function pctOf(amount: number, totalSales: number): number {
  return totalSales > 0 ? Math.round((amount / totalSales) * 100) : 0;
}

export function OperationsSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  /* ── Live data — identical hook calls to OperationsContent ───────────── */
  const reviews         = useGoogleReviews(dateTo);
  const negativeReviews = useNegativeReviews(dateFrom, dateTo);
  const diligence       = useDiligenceAudit(dateTo);
  const facility        = useStandardsScores("facility", dateFrom, dateTo);
  const mystery         = useStandardsScores("mystery_guest", dateFrom, dateTo);
  const facilityTrend   = useStandardsTrend("facility", dateTo, 12);
  const mysteryTrend    = useStandardsTrend("mystery_guest", dateTo, 12);

  const loading =
    reviews.loading || diligence.loading || facility.loading || mystery.loading;

  /* ── Computed Review KPIs (same math as page) ────────────────────────── */
  const totalReviews = reviews.snapshots.reduce((s, l) => s + l.totalReviews, 0);
  const weightedAvg = totalReviews > 0
    ? +(
        reviews.snapshots.reduce((s, l) => s + l.avgRating * l.totalReviews, 0) /
        totalReviews
      ).toFixed(1)
    : 0;
  const withPrev = reviews.snapshots.filter((l) => l.prevRating !== null);
  const prevWeight = withPrev.reduce((s, l) => s + l.totalReviews, 0);
  const ratingDelta = prevWeight > 0
    ? +(
        weightedAvg -
        withPrev.reduce((s, l) => s + (l.prevRating ?? 0) * l.totalReviews, 0) /
          prevWeight
      ).toFixed(1)
    : null;

  /* ── Facility & Mystery Guest aggregates ─────────────────────────────── */
  const avgFacility = Math.round(avg(facility.rows.map((s) => s.score)));
  const avgMystery = Math.round(avg(mystery.rows.map((s) => s.score)));

  /* ── Diligence totals (latest month shown) ───────────────────────────── */
  const diligenceTotals = {
    totalSales:       diligence.rows.reduce((s, d) => s + d.totalSales, 0),
    deletedCancelled: diligence.rows.reduce((s, d) => s + d.deletedCancelled, 0),
    complimentary:    diligence.rows.reduce((s, d) => s + d.complimentary, 0),
    cashSales:        diligence.rows.reduce((s, d) => s + d.cashSales, 0),
    discountedCash:   diligence.rows.reduce((s, d) => s + d.discountedCash, 0),
    unattended:       diligence.rows.reduce((s, d) => s + d.unattended, 0),
  };
  const totPct = (n: number) => pctOf(n, diligenceTotals.totalSales);

  /* ── Trend deltas ────────────────────────────────────────────────────── */
  const facilityTrendArr = facilityTrend.data ?? [];
  const mysteryTrendArr  = mysteryTrend.data ?? [];
  const facilityTrendDelta = facilityTrendArr.length >= 2
    ? facilityTrendArr[facilityTrendArr.length - 1].avgScore -
      facilityTrendArr[facilityTrendArr.length - 2].avgScore
    : 0;
  const mysteryTrendDelta = mysteryTrendArr.length >= 2
    ? mysteryTrendArr[mysteryTrendArr.length - 1].avgScore -
      mysteryTrendArr[mysteryTrendArr.length - 2].avgScore
    : 0;

  /* ── Lowest performers (same reducers as page) ───────────────────────── */
  const negReviews     = negativeReviews.data ?? [];
  const lowestRated    = reviews.snapshots.length > 0
    ? reviews.snapshots.reduce((min, s) => s.avgRating < min.avgRating ? s : min)
    : null;
  const lowestFacility = facility.rows.length > 0
    ? facility.rows.reduce((min, s) => s.score < min.score ? s : min)
    : null;
  const lowestMystery  = mystery.rows.length > 0
    ? mystery.rows.reduce((min, s) => s.score < min.score ? s : min)
    : null;

  const criticalCount   = negReviews.filter((r) => r.rating <= 3).length;
  const noteworthyCount = negReviews.filter((r) => r.rating === 4 && r.text.trim().length > 0).length;
  const negativeCount   = criticalCount + noteworthyCount;

  /* ── Commentary engine — identical input assembly to the page ────────── */
  const commentary = useMemo(() => {
    const inputs: OpsCommentaryInputs = {
      weightedAvg,
      ratingDelta,
      totalReviews,
      criticalCount,
      noteworthyCount,
      lowestRatedLocation:    lowestRated ? { name: lowestRated.name, rating: lowestRated.avgRating } : null,
      complimentaryPct:       totPct(diligenceTotals.complimentary),
      cashPct:                totPct(diligenceTotals.cashSales),
      discountedCashPct:      totPct(diligenceTotals.discountedCash),
      delCancelledPct:        totPct(diligenceTotals.deletedCancelled),
      unattended:             diligenceTotals.unattended,
      avgFacility,
      lowestFacilityLocation: lowestFacility ? { name: lowestFacility.name, score: lowestFacility.score } : null,
      facilityTrend:          classifyFacilityTrend(facilityTrendDelta),
      facilityTrendDelta,
      avgMystery,
      lowestMysteryLocation:  lowestMystery ? { name: lowestMystery.name, score: lowestMystery.score } : null,
      mysteryTrend:           classifyMysteryTrend(mysteryTrendDelta),
      mysteryTrendDelta,
      hasEnoughData:          reviews.snapshots.length > 0 || facility.rows.length > 0 || mystery.rows.length > 0,
      periodLabel:            formatDateRangeLabel(dateFrom, dateTo),
    };
    return computeOpsCommentary(inputs);
  }, [
    weightedAvg, ratingDelta, totalReviews, criticalCount, noteworthyCount,
    lowestRated, lowestFacility, lowestMystery, avgFacility, avgMystery,
    facilityTrendDelta, mysteryTrendDelta, diligenceTotals.complimentary,
    diligenceTotals.cashSales, diligenceTotals.discountedCash,
    diligenceTotals.deletedCancelled, diligenceTotals.unattended,
    diligenceTotals.totalSales, reviews.snapshots.length, facility.rows.length,
    mystery.rows.length, dateFrom, dateTo,
  ]);

  /* ── KPIs (pre-formatted) ────────────────────────────────────────────── */
  const kpis: DeptHeadlineKpi[] = useMemo(() => {
    const out: DeptHeadlineKpi[] = [];

    // Hero: Google review rating (delta is a rating-point change vs ~1mo earlier)
    out.push({
      label: "Google Rating",
      value: weightedAvg > 0 ? `${weightedAvg.toFixed(1)}★` : "—",
      ...(ratingDelta != null && ratingDelta !== 0
        ? { deltaPct: ratingDelta, deltaLabel: "vs prev", deltaIsPoints: true }
        : {}),
    });

    // Facility / diligence audit score (compliance %)
    out.push({
      label: "Facility Std",
      value: `${avgFacility}%`,
      ...(facilityTrendDelta !== 0
        ? { deltaPct: facilityTrendDelta, deltaLabel: "MoM", deltaIsPoints: true }
        : {}),
    });

    // Mystery shopper score
    out.push({
      label: "Mystery Guest",
      value: `${avgMystery}%`,
      ...(mysteryTrendDelta !== 0
        ? { deltaPct: mysteryTrendDelta, deltaLabel: "MoM", deltaIsPoints: true }
        : {}),
    });

    // Deleted & Cancelled compliance — lower is better
    out.push({
      label: "Del & Cancel",
      value: `${totPct(diligenceTotals.deletedCancelled)}%`,
    });

    // Negative-review count — more is worse
    out.push({
      label: "Neg. Reviews",
      value: negativeCount.toLocaleString(),
    });

    return out;
  }, [
    weightedAvg, ratingDelta, avgFacility, avgMystery, facilityTrendDelta,
    mysteryTrendDelta, diligenceTotals.deletedCancelled, diligenceTotals.totalSales,
    negativeCount,
  ]);

  /* ── Report up to the page ───────────────────────────────────────────── */
  useEffect(() => {
    if (loading) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading operations summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
      return;
    }

    const summary: DeptSummary = {
      ...META,
      rag: commentary.insufficientData ? "NEUTRAL" : normalizeRag(commentary.overallState),
      headline: commentary.insufficientData
        ? "Not enough operations data for this period."
        : commentary.verdict,
      kpis,
      focusAreas: commentary.focusAreas.map((f) => f.text),
      wins: commentary.wins.map((w) => w.text),
      loading: false,
    };
    onSummary(summary);
  }, [loading, commentary, kpis, onSummary]);

  return (
    <SectionCard
      {...META}
      icon={ClipboardList}
      rag={loading || commentary.insufficientData ? "NEUTRAL" : normalizeRag(commentary.overallState)}
      headline={
        loading
          ? ""
          : commentary.insufficientData
          ? "Not enough operations data for this period."
          : commentary.verdict
      }
      kpis={loading ? [] : kpis}
      focusAreas={loading ? [] : commentary.focusAreas.map((f) => f.text)}
      wins={loading ? [] : commentary.wins.map((w) => w.text)}
      loading={loading}
    />
  );
}
