"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { SkeletonKPIRow, ChartSkeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
} from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import {
  useGoogleReviews,
  useNegativeReviews,
  useDiligenceAudit,
  useStandardsScores,
  useStandardsTrend,
  type DiligenceRow,
  type StandardsLocationRow,
  type WeeklyReviewSummary,
  type MonthlyStandardScore,
  type NegativeReview,
} from "@/lib/hooks/useOperationsData";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/constants/design-tokens";
import {
  ShieldAlert,
  Star,
  ClipboardCheck,
  UserSearch,
  AlertTriangle,
  MessageSquareX,
} from "lucide-react";
import {
  computeOpsCommentary,
  classifyFacilityTrend,
  classifyMysteryTrend,
  type OpsCommentaryInputs,
  type OpsCommentaryResult,
} from "@/lib/commentary/engine";

/* ═══════════════════════════════════════════════════════════════════════
   LOCATION DISPLAY CONSTANTS (data itself is live from Supabase)
   ═══════════════════════════════════════════════════════════════════════ */

// Spa-hotel locations use a categorical palette (not brand colors).
// Carisma Aesthetics + Slimming use their canonical BRAND.x.dark.
const LOCATION_COLORS: Record<string, string> = {
  inter:               BRAND.spa.soft,
  hugos:               "#B8C9E0",
  ramla:               "#E5B8B0",
  hyatt:               "#E5C088",
  excelsior:           "#D5C0E5",
  novotel:             "#B5DCDC",
  labranda:            "#C7C4BD",
  odycy:               "#E5B5D0",
  "aesthetics-clinic": BRAND.aesthetics.soft,
  "slimming-clinic":   BRAND.slimming.soft,
};
const FALLBACK_COLOR = "#9CA3AF";

// Compact labels for the diligence heatmap column headers.
const SHORT_NAMES: Record<string, string> = {
  inter:               "Inter",
  hugos:               "Hugos",
  hyatt:               "Hyatt",
  ramla:               "Ramla",
  labranda:            "Riviera",
  odycy:               "Sunny",
  excelsior:           "Excelsior",
  novotel:             "Novotel",
  "aesthetics-clinic": "C. Aesthetics",
  "slimming-clinic":   "C. Slimming",
};

const DILIGENCE_THRESHOLDS = {
  // Source report combines deleted + cancelled into one figure (<10% of sales).
  deletedCancelledPct: 10,
  complimentaryPct: 2,
  cashPct: 12,
  discountedCashPct: 5,
  unattended: 0,
};

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function scoreColor(score: number): string {
  if (score >= 4.8) return "#22C55E";
  if (score >= 4.5) return "#F59E0B";
  return "#EF4444";
}

function complianceColor(score: number): string {
  if (score >= 85) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

function complianceBg(score: number): string {
  if (score >= 85) return "bg-emerald-50 text-emerald-800";
  if (score >= 60) return "bg-amber-50 text-amber-800";
  return "bg-red-50 text-red-800";
}

/** Heatmap cell background: green = within threshold, amber = slightly over, red = well over */
function heatBg(value: number, threshold: number): string {
  if (value <= threshold) return "bg-emerald-100 text-emerald-900";
  if (value <= threshold * 1.5) return "bg-amber-100 text-amber-900";
  return "bg-red-100 text-red-900";
}

/** Inverse heatmap for unattended: 0 = green, 1-5 = amber, >5 = red */
function unattendedBg(value: number): string {
  if (value === 0) return "bg-emerald-100 text-emerald-900";
  if (value <= 5) return "bg-amber-100 text-amber-900";
  return "bg-red-100 text-red-900";
}

/** Percentage of total sales, rounded — 0 when there are no sales. */
function pctOf(amount: number, totalSales: number): number {
  return totalSales > 0 ? Math.round((amount / totalSales) * 100) : 0;
}

function monthLabel(month: string | null): string {
  return month ? format(parseISO(month), "MMMM yyyy") : "—";
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted-foreground py-6 text-center">{message}</p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OPS SCORECARD — 3-group KPI banner replacing the generic KPICardRow
   ═══════════════════════════════════════════════════════════════════════ */

function OpsScorecard({
  totalReviews,
  weightedAvg,
  ratingDelta,
  delCancelPct,
  unattended,
  avgFacility,
  avgMystery,
}: {
  totalReviews: number;
  weightedAvg: number;
  ratingDelta: number | null;
  delCancelPct: number;
  unattended: number;
  avgFacility: number;
  avgMystery: number;
}) {
  const statusCol = (v: number, good: number, warn: number, invert = false) => {
    const ok = invert ? v <= good : v >= good;
    const at = invert ? v <= warn : v >= warn;
    return ok ? "#22C55E" : at ? "#F59E0B" : "#EF4444";
  };
  const statusLabel = (v: number, good: number, warn: number, invert = false) => {
    const ok = invert ? v <= good : v >= good;
    const at = invert ? v <= warn : v >= warn;
    return ok ? "On track" : at ? "At risk" : "Critical";
  };
  const statusBadgeCls = (v: number, good: number, warn: number, invert = false) => {
    const ok = invert ? v <= good : v >= good;
    const at = invert ? v <= warn : v >= warn;
    return ok
      ? "bg-emerald-50 text-emerald-700"
      : at
      ? "bg-amber-50 text-amber-700"
      : "bg-red-50 text-red-700";
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* ── Group 1: Google Reviews ──────────────────────────────────── */}
      <Card className="p-5 border-l-[3px] border-l-[#B79E61]">
        <div className="flex items-center gap-2 mb-4">
          <Star className="h-4 w-4 text-[#B79E61]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Google Reviews</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Total</div>
            <div className="text-2xl font-bold text-foreground">{totalReviews.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Avg Rating</div>
            <div className="text-2xl font-bold" style={{ color: statusCol(weightedAvg, 4.8, 4.5) }}>
              {weightedAvg} ★
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Δ Rating</div>
            <div className="text-2xl font-bold" style={{
              color: ratingDelta == null || ratingDelta === 0 ? "#9CA3AF" : ratingDelta > 0 ? "#22C55E" : "#EF4444"
            }}>
              {ratingDelta == null ? "—" : ratingDelta > 0 ? `+${ratingDelta}` : String(ratingDelta)}
            </div>
          </div>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
          <div className="h-full rounded-full transition-all" style={{
            width: `${Math.min((weightedAvg / 5) * 100, 100)}%`,
            background: statusCol(weightedAvg, 4.8, 4.5),
          }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Target ≥ 4.5</span>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", statusBadgeCls(weightedAvg, 4.8, 4.5))}>
            {statusLabel(weightedAvg, 4.8, 4.5)}
          </span>
        </div>
      </Card>

      {/* ── Group 2: Compliance ──────────────────────────────────────── */}
      <Card className="p-5 border-l-[3px] border-l-[#1B3A4B]">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-4 w-4 text-[#1B3A4B]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Compliance</span>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Del &amp; Cancelled</div>
            <div className="text-2xl font-bold" style={{ color: statusCol(delCancelPct, 5, 10, true) }}>
              {delCancelPct}%
            </div>
            <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${Math.min((delCancelPct / 20) * 100, 100)}%`,
                background: statusCol(delCancelPct, 5, 10, true),
              }} />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Unattended</div>
            <div className="text-2xl font-bold" style={{ color: unattended === 0 ? "#22C55E" : "#EF4444" }}>
              {unattended.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">Must be 0</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Target &lt; 10%</span>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", statusBadgeCls(delCancelPct, 5, 10, true))}>
            {statusLabel(delCancelPct, 5, 10, true)}
          </span>
        </div>
      </Card>

      {/* ── Group 3: Standards ──────────────────────────────────────── */}
      <Card className="p-5 border-l-[3px] border-l-[#22C55E]">
        <div className="flex items-center gap-2 mb-4">
          <ClipboardCheck className="h-4 w-4 text-[#22C55E]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Standards</span>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Facility Std</div>
            <div className="text-2xl font-bold" style={{ color: statusCol(avgFacility, 85, 60) }}>
              {avgFacility}%
            </div>
            <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${avgFacility}%`,
                background: statusCol(avgFacility, 85, 60),
              }} />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">Mystery Guest</div>
            <div className="text-2xl font-bold" style={{ color: statusCol(avgMystery, 85, 60) }}>
              {avgMystery}%
            </div>
            <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${avgMystery}%`,
                background: statusCol(avgMystery, 85, 60),
              }} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Target ≥ 85%</span>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
            statusBadgeCls(Math.min(avgFacility, avgMystery), 85, 60))}>
            {statusLabel(Math.min(avgFacility, avgMystery), 85, 60)}
          </span>
        </div>
      </Card>

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OPERATIONS COMMENTARY — Strategic verdict card
   ═══════════════════════════════════════════════════════════════════════ */

function OperationsCommentary({ result }: { result: OpsCommentaryResult }) {
  if (result.insufficientData) return null;

  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <div className="p-4 md:p-5">
        <p className="text-base font-semibold text-amber-900 mb-0.5">Operations Snapshot</p>
        <p className="text-xs text-amber-700 mb-3">{result.verdict}</p>
        {(result.wins.length > 0 || result.focusAreas.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-amber-200">
            {result.wins.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  ✅ Working well
                </p>
                <ul className="space-y-2">
                  {result.wins.map((w) => (
                    <li key={w.metricKey} className="text-sm leading-snug text-amber-900">
                      <span className="font-medium">{w.label}:</span> {w.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.focusAreas.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  🎯 Focus areas
                </p>
                <ul className="space-y-2">
                  {result.focusAreas.map((f) => (
                    <li key={f.metricKey} className="text-sm leading-snug text-amber-900">
                      <span className="font-medium">{f.label}:</span> {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ═══════════════════════════════════════════════════════════════════════ */

function OperationsContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
}) {
  /* ── Live data ─────────────────────────────────────────────────────── */
  const reviews         = useGoogleReviews(dateTo);
  const negativeReviews = useNegativeReviews(dateFrom, dateTo);
  const diligence       = useDiligenceAudit(dateTo);
  const facility        = useStandardsScores("facility", dateFrom, dateTo);
  const mystery         = useStandardsScores("mystery_guest", dateFrom, dateTo);
  const facilityTrend   = useStandardsTrend("facility", dateTo, 12);
  const mysteryTrend    = useStandardsTrend("mystery_guest", dateTo, 12);

  const loading =
    reviews.loading || diligence.loading || facility.loading || mystery.loading;

  /* ── Computed Review KPIs ─────────────────────────────────────────── */
  const totalReviews = reviews.snapshots.reduce((s, l) => s + l.totalReviews, 0);
  const weightedAvg = totalReviews > 0
    ? +(
        reviews.snapshots.reduce((s, l) => s + l.avgRating * l.totalReviews, 0) /
        totalReviews
      ).toFixed(1)
    : 0;
  // Trend vs ~1-month-earlier snapshots — only across locations that have one.
  const withPrev = reviews.snapshots.filter((l) => l.prevRating !== null);
  const prevWeight = withPrev.reduce((s, l) => s + l.totalReviews, 0);
  const ratingDelta = prevWeight > 0
    ? +(
        weightedAvg -
        withPrev.reduce((s, l) => s + (l.prevRating ?? 0) * l.totalReviews, 0) /
          prevWeight
      ).toFixed(1)
    : null;

  /* ── Facility & Mystery Guest Aggregates ──────────────────────────── */
  const avgFacility = Math.round(avg(facility.rows.map((s) => s.score)));
  const avgMystery = Math.round(avg(mystery.rows.map((s) => s.score)));

  /* ── Diligence totals (latest month shown) ────────────────────────── */
  const diligenceTotals = {
    totalSales:       diligence.rows.reduce((s, d) => s + d.totalSales, 0),
    deletedCancelled: diligence.rows.reduce((s, d) => s + d.deletedCancelled, 0),
    complimentary:    diligence.rows.reduce((s, d) => s + d.complimentary, 0),
    cashSales:        diligence.rows.reduce((s, d) => s + d.cashSales, 0),
    discountedCash:   diligence.rows.reduce((s, d) => s + d.discountedCash, 0),
    unattended:       diligence.rows.reduce((s, d) => s + d.unattended, 0),
  };
  const totPct = (n: number) => pctOf(n, diligenceTotals.totalSales);

  // All location slugs from the snapshot (not just the last week's active set),
  // so every location always has a <Bar> registered in the chart.
  const allLocationSlugs = reviews.snapshots.map((s) => s.slug);

  const weeklyStackedData = reviews.weekly.slice(-10).map((w) => {
    const row: Record<string, number | string> = {
      weekLabel: w.weekLabel,
      avgRating: w.avgRating,
      totalReviews: w.totalReviews,
    };
    for (const loc of w.locations) {
      row[loc.slug] = loc.totalCount;                     // cumulative — bar height
      row[`${loc.slug}_delta`] = loc.newReviews > 0 ? loc.newReviews : 0; // delta — label
    }
    return row;
  });

  /* ── Facility & Mystery bar data (worst first) ────────────────────── */
  const facilityBarData = [...facility.rows].sort((a, b) => a.score - b.score);
  const mysteryBarData = [...mystery.rows].sort((a, b) => a.score - b.score);

  /* ── Strategic Commentary Engine ─────────────────────────────────── */
  const facilityTrendArr   = facilityTrend.data ?? [];
  const mysteryTrendArr    = mysteryTrend.data ?? [];
  const facilityTrendDelta = facilityTrendArr.length >= 2
    ? facilityTrendArr[facilityTrendArr.length - 1].avgScore -
      facilityTrendArr[facilityTrendArr.length - 2].avgScore
    : 0;
  const mysteryTrendDelta  = mysteryTrendArr.length >= 2
    ? mysteryTrendArr[mysteryTrendArr.length - 1].avgScore -
      mysteryTrendArr[mysteryTrendArr.length - 2].avgScore
    : 0;

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

  const commentaryInputs: OpsCommentaryInputs = {
    weightedAvg,
    ratingDelta,
    totalReviews,
    criticalCount:          negReviews.filter((r) => r.rating <= 3).length,
    noteworthyCount:        negReviews.filter((r) => r.rating === 4 && r.text.trim().length > 0).length,
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
  const commentary = computeOpsCommentary(commentaryInputs);

  const shortName = (d: DiligenceRow) => SHORT_NAMES[d.slug] ?? d.name;

  /* ── Loading state ────────────────────────────────────────────────── */
  if (loading) {
    return (
      <>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDateRangeLabel(dateFrom, dateTo)} · Facility standards, compliance &amp; reviews
          </p>
        </div>
        <SkeletonKPIRow count={7} />
        <ChartSkeleton height={380} />
        <ChartSkeleton height={300} />
        <ChartSkeleton height={360} />
        <ChartSkeleton height={360} />
      </>
    );
  }

  return (
    <>
      {/* ═══════ HEADER ═══════════════════════════════════════════════ */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {formatDateRangeLabel(dateFrom, dateTo)} · Facility standards, compliance &amp; reviews
        </p>
      </div>
      <OpsScorecard
        totalReviews={totalReviews}
        weightedAvg={weightedAvg}
        ratingDelta={ratingDelta}
        delCancelPct={totPct(diligenceTotals.deletedCancelled)}
        unattended={diligenceTotals.unattended}
        avgFacility={avgFacility}
        avgMystery={avgMystery}
      />
      <OperationsCommentary result={commentary} />

      {/* ═══════ REVIEWS — LONGITUDINAL TREND ════════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-5 w-5 text-[#B79E61]" />
          <h2 className="text-lg font-semibold text-foreground">Reviews Trend</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Weekly net new reviews per location (last 10 periods) — {totalReviews.toLocaleString()} current total
          {reviews.snapshotDate ? ` · snapshot ${format(parseISO(reviews.snapshotDate), "d MMM yyyy")}` : ""}
        </p>

        {reviews.weekly.length < 2 ? (
          <div className="flex flex-col items-center justify-center h-[200px] gap-2 text-muted-foreground">
            <span className="text-4xl">📈</span>
            <p className="text-sm font-medium">Building history&hellip;</p>
            <p className="text-xs max-w-xs text-center">
              Weekly snapshots are collected each time the Google Reviews ETL runs. Check back after a few days for longitudinal data.
            </p>
          </div>
        ) : (
          <div className="flex gap-4 items-start">
            {/* Stacked bar chart */}
            <div className="flex-1 h-[280px] md:h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={weeklyStackedData}
                  margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    label={{ value: "New Reviews", angle: -90, position: "insideLeft", fontSize: 10, dy: 50 }}
                  />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => {
                      const slug = String(name);
                      return [Number(value).toLocaleString(), slug];
                    }}
                  />
                  {allLocationSlugs.map((slug) => (
                    <Bar
                      key={slug}
                      yAxisId="left"
                      dataKey={slug}
                      stackId="reviews"
                      fill={LOCATION_COLORS[slug] ?? FALLBACK_COLOR}
                      fillOpacity={0.85}
                    >
                      <LabelList
                        dataKey={`${slug}_delta`}
                        position="inside"
                        content={(props: unknown) => {
                          const p = props as { x?: number; y?: number; width?: number; height?: number; value?: unknown };
                          const v = Number(p.value ?? 0);
                          if (!v || v <= 0 || !p.height || (p.height as number) < 8) return <g />;
                          return (
                            <text
                              x={(p.x ?? 0) + (p.width ?? 0) / 2}
                              y={(p.y ?? 0) + (p.height ?? 0) / 2 + 4}
                              textAnchor="middle"
                              fontSize={8}
                              fontWeight={700}
                              fill="#fff"
                            >
                              +{v}
                            </text>
                          );
                        }}
                      />
                    </Bar>
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Current totals panel — replaces the snapshot table */}
            <div className="w-44 flex-shrink-0 h-[280px] md:h-[320px] flex flex-col justify-center gap-2.5 border-l border-warm-border/30 pl-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                Current totals
              </p>
              {[...reviews.snapshots]
                .sort((a, b) => b.totalReviews - a.totalReviews)
                .map((loc) => (
                  <div key={loc.slug} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: LOCATION_COLORS[loc.slug] ?? FALLBACK_COLOR }}
                    />
                    <span className="text-xs text-foreground flex-1 truncate">{loc.name}</span>
                    <span className="text-xs font-bold tabular-nums text-foreground">
                      {loc.totalReviews.toLocaleString()}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

      </Card>

      {/* ═══════ NEGATIVE REVIEWS ═══════════════════════════════════ */}
      <NegativeReviewsCard
        reviews={negativeReviews.data ?? []}
        loading={negativeReviews.isLoading}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* ═══════ DILIGENCE AUDIT TABLE (Heatmap) ═════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-5 w-5 text-[#B79E61]" />
          <h2 className="text-lg font-semibold text-foreground">Diligence Audit — {monthLabel(diligence.month)}</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          Financial compliance by location — heatmap: <span className="inline-block w-3 h-3 rounded bg-emerald-100 align-middle mx-0.5" /> within threshold <span className="inline-block w-3 h-3 rounded bg-amber-100 align-middle mx-0.5" /> above threshold <span className="inline-block w-3 h-3 rounded bg-red-100 align-middle mx-0.5" /> breach
        </p>
        {diligence.rows.length === 0 ? (
          <EmptyState message="No diligence audit data for the selected period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-warm-border bg-muted/30">
                  <th className="text-left py-2.5 px-3 font-semibold text-foreground sticky left-0 bg-muted/30 z-10 min-w-[155px]">Metric</th>
                  {diligence.rows.map((d) => (
                    <th key={d.slug} className="text-center py-2.5 px-1.5 font-semibold text-foreground min-w-[85px] text-xs">
                      {shortName(d)}
                    </th>
                  ))}
                  <th className="text-center py-2.5 px-3 font-bold text-foreground bg-muted/50 min-w-[90px] text-xs">Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Total Sales — no heatmap, just numbers */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-semibold text-foreground sticky left-0 bg-white z-10">Total Sales</td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className="text-center py-2 px-1.5 font-medium text-foreground text-xs tabular-nums">
                      {formatCurrency(d.totalSales)}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3 font-bold text-foreground bg-muted/20 text-xs tabular-nums">
                    {formatCurrency(diligenceTotals.totalSales)}
                  </td>
                </tr>
                {/* Complimentary */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-medium text-foreground sticky left-0 bg-white z-10">
                    Complimentary <span className="text-xs text-muted-foreground">(~2%)</span>
                  </td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className={cn("text-center py-1.5 px-1", heatBg(pctOf(d.complimentary, d.totalSales), DILIGENCE_THRESHOLDS.complimentaryPct))}>
                      <div className="text-xs font-semibold">{Math.round(d.complimentary).toLocaleString()}</div>
                      <div className="text-[10px] font-bold">{pctOf(d.complimentary, d.totalSales)}%</div>
                    </td>
                  ))}
                  <td className={cn("text-center py-1.5 px-2", heatBg(totPct(diligenceTotals.complimentary), DILIGENCE_THRESHOLDS.complimentaryPct))}>
                    <div className="text-xs font-semibold">{Math.round(diligenceTotals.complimentary).toLocaleString()}</div>
                    <div className="text-[10px] font-bold">{totPct(diligenceTotals.complimentary)}%</div>
                  </td>
                </tr>
                {/* Cash Sales */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-medium text-foreground sticky left-0 bg-white z-10">
                    Cash Sales <span className="text-xs text-muted-foreground">(&lt;12%)</span>
                  </td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className={cn("text-center py-1.5 px-1", heatBg(pctOf(d.cashSales, d.totalSales), DILIGENCE_THRESHOLDS.cashPct))}>
                      <div className="text-xs font-semibold">{Math.round(d.cashSales).toLocaleString()}</div>
                      <div className="text-[10px] font-bold">{pctOf(d.cashSales, d.totalSales)}%</div>
                    </td>
                  ))}
                  <td className={cn("text-center py-1.5 px-2", heatBg(totPct(diligenceTotals.cashSales), DILIGENCE_THRESHOLDS.cashPct))}>
                    <div className="text-xs font-semibold">{Math.round(diligenceTotals.cashSales).toLocaleString()}</div>
                    <div className="text-[10px] font-bold">{totPct(diligenceTotals.cashSales)}%</div>
                  </td>
                </tr>
                {/* Discounted Cash */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-medium text-foreground sticky left-0 bg-white z-10">
                    Disc. Cash <span className="text-xs text-muted-foreground">(&lt;5%)</span>
                  </td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className={cn("text-center py-1.5 px-1", heatBg(pctOf(d.discountedCash, d.totalSales), DILIGENCE_THRESHOLDS.discountedCashPct))}>
                      <div className="text-xs font-semibold">{Math.round(d.discountedCash).toLocaleString()}</div>
                      <div className="text-[10px] font-bold">{pctOf(d.discountedCash, d.totalSales)}%</div>
                    </td>
                  ))}
                  <td className={cn("text-center py-1.5 px-2", heatBg(totPct(diligenceTotals.discountedCash), DILIGENCE_THRESHOLDS.discountedCashPct))}>
                    <div className="text-xs font-semibold">{Math.round(diligenceTotals.discountedCash).toLocaleString()}</div>
                    <div className="text-[10px] font-bold">{totPct(diligenceTotals.discountedCash)}%</div>
                  </td>
                </tr>
                {/* Sample data separator */}
                <tr>
                  <td colSpan={diligence.rows.length + 2} className="py-1 px-3 bg-amber-50 border-y border-amber-200">
                    <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Sample data — manual entry required</span>
                  </td>
                </tr>
                {/* Deleted & Cancelled (combined in source report) */}
                <tr className="border-b border-warm-border/50 bg-amber-50/30">
                  <td className="py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-amber-50/30 z-10">
                    Deleted &amp; Cancelled <span className="text-xs text-muted-foreground">(&lt;10%)</span>
                  </td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className={cn("text-center py-1.5 px-1", heatBg(pctOf(d.deletedCancelled, d.totalSales), DILIGENCE_THRESHOLDS.deletedCancelledPct))}>
                      <div className="text-xs font-semibold">{Math.round(d.deletedCancelled).toLocaleString()}</div>
                      <div className="text-[10px] font-bold">{pctOf(d.deletedCancelled, d.totalSales)}%</div>
                    </td>
                  ))}
                  <td className={cn("text-center py-1.5 px-2", heatBg(totPct(diligenceTotals.deletedCancelled), DILIGENCE_THRESHOLDS.deletedCancelledPct))}>
                    <div className="text-xs font-semibold">{Math.round(diligenceTotals.deletedCancelled).toLocaleString()}</div>
                    <div className="text-[10px] font-bold">{totPct(diligenceTotals.deletedCancelled)}%</div>
                  </td>
                </tr>
                {/* Unattended */}
                <tr className="bg-amber-50/30">
                  <td className="py-2 px-3 font-medium text-muted-foreground sticky left-0 bg-amber-50/30 z-10">
                    Unattended <span className="text-xs text-muted-foreground">(must be 0)</span>
                  </td>
                  {diligence.rows.map((d) => (
                    <td key={d.slug} className={cn("text-center py-1.5 px-1", unattendedBg(d.unattended))}>
                      <div className="text-xs font-bold">{d.unattended}</div>
                    </td>
                  ))}
                  <td className={cn("text-center py-1.5 px-2", unattendedBg(diligenceTotals.unattended))}>
                    <div className="text-xs font-bold">{diligenceTotals.unattended}</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ═══════ FACILITY STANDARDS BY LOCATION ══════════════════════ */}
      <StandardsCard
        title="Facility Standards by Location"
        icon={<ClipboardCheck className="h-5 w-5 text-[#22C55E]" />}
        month={facility.month}
        aggregate={avgFacility}
        barData={facilityBarData}
        barName="Facility %"
        trend={facilityTrend.data ?? []}
        emptyMessage="No facility standards data for the selected period."
        dateFrom={dateFrom}
      />

      {/* ═══════ MYSTERY GUEST STANDARDS BY LOCATION ═════════════════ */}
      <StandardsCard
        title="Mystery Guest Standards by Location"
        icon={<UserSearch className="h-5 w-5 text-[#7C3AED]" />}
        month={mystery.month}
        aggregate={avgMystery}
        barData={mysteryBarData}
        barName="Mystery Guest %"
        trend={mysteryTrend.data ?? []}
        emptyMessage="No mystery guest data for the selected period."
        dateFrom={dateFrom}
      />

    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   NEGATIVE REVIEWS CARD
   Shows individual reviews rated ≤3 stars, or 4 stars with text.
   Data comes from google_review_texts (populated nightly by the
   google-reviews ETL from Places API).
   ═══════════════════════════════════════════════════════════════════════ */

const LOCATION_BADGE_COLORS: Record<string, string> = {
  inter:               "bg-blue-100 text-blue-800",
  hugos:               "bg-indigo-100 text-indigo-800",
  hyatt:               "bg-amber-100 text-amber-800",
  ramla:               "bg-rose-100 text-rose-800",
  labranda:            "bg-stone-100 text-stone-800",
  odycy:               "bg-pink-100 text-pink-800",
  excelsior:           "bg-purple-100 text-purple-800",
  novotel:             "bg-teal-100 text-teal-800",
  "aesthetics-clinic": "bg-emerald-100 text-emerald-800",
  "slimming-clinic":   "bg-cyan-100 text-cyan-800",
};

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3 w-3",
            i < rating ? "fill-amber-400 text-amber-400" : "fill-transparent text-gray-300",
          )}
        />
      ))}
    </span>
  );
}

function NegativeReviewsCard({
  reviews,
  loading,
  dateFrom,
  dateTo,
}: {
  reviews: NegativeReview[];
  loading: boolean;
  dateFrom: Date;
  dateTo: Date;
}) {
  const periodLabel = `${format(dateFrom, "d MMM")}–${format(dateTo, "d MMM yyyy")}`;
  const critical    = reviews.filter((r) => r.rating <= 3);
  const noteworthy  = reviews.filter((r) => r.rating === 4 && r.text.trim().length > 0);

  return (
    <Card className="p-3 md:p-6">
      <div className="flex items-center gap-2 mb-1">
        <MessageSquareX className="h-5 w-5 text-[#EF4444]" />
        <h2 className="text-lg font-semibold text-foreground">Negative Reviews</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {periodLabel} — reviews ≤3 stars + 4-star reviews with written feedback
      </p>

      {loading && <ChartSkeleton />}

      {!loading && reviews.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No qualifying negative reviews found for this period.{" "}
          <span className="text-xs">(Data populates nightly via Google Places API)</span>
        </div>
      )}

      {!loading && reviews.length > 0 && (
        <div className="space-y-6">

          {/* Critical: ≤3 stars */}
          {critical.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-3">
                Critical — ≤ 3 Stars ({critical.length})
              </p>
              <div className="space-y-3">
                {critical.map((r) => (
                  <ReviewBlurb key={r.reviewName} review={r} />
                ))}
              </div>
            </div>
          )}

          {/* Noteworthy: 4-star with text */}
          {noteworthy.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">
                Noteworthy — 4 Stars with Feedback ({noteworthy.length})
              </p>
              <div className="space-y-3">
                {noteworthy.map((r) => (
                  <ReviewBlurb key={r.reviewName} review={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReviewBlurb({ review }: { review: NegativeReview }) {
  const badgeClass = LOCATION_BADGE_COLORS[review.locationSlug] ?? "bg-gray-100 text-gray-700";
  const dateStr = review.publishedAt
    ? format(new Date(review.publishedAt), "d MMM yyyy")
    : null;
  // Truncate long reviews at 400 chars with an ellipsis
  const blurb = review.text.length > 400
    ? review.text.slice(0, 400).trimEnd() + "…"
    : review.text;

  return (
    <div className="border border-border rounded-lg p-3 bg-background">
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <div className="flex items-center gap-2">
          <StarRow rating={review.rating} />
          <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", badgeClass)}>
            {review.locationName}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {review.authorName && <span>{review.authorName}</span>}
          {dateStr && <span>· {dateStr}</span>}
        </div>
      </div>
      {blurb && (
        <p className="text-sm text-foreground leading-relaxed">{blurb}</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   STANDARDS CARD (Facility / Mystery Guest — identical layout)
   ═══════════════════════════════════════════════════════════════════════ */

function StandardsCard({
  title,
  icon,
  month,
  aggregate,
  barData,
  barName,
  trend,
  emptyMessage,
  dateFrom,
}: {
  title: string;
  icon: React.ReactNode;
  month: string | null;
  aggregate: number;
  barData: StandardsLocationRow[];
  barName: string;
  trend: MonthlyStandardScore[];
  emptyMessage: string;
  dateFrom?: Date;
}) {
  const hasTrend = trend.length >= 2;

  // Detect fallback: shown month is older than the selected period start,
  // meaning no data existed in range and we fell back to the latest available.
  const selectedFromMonth = dateFrom
    ? `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}-01`
    : null;
  const isFallback = !!(selectedFromMonth && month && month < selectedFromMonth);

  return (
    <Card className="p-3 md:p-6">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        {monthLabel(month)} · {aggregate}% — green &ge;85%, amber 60-84%, red &lt;60%
      </p>
      {isFallback && (
        <div className="flex items-center gap-1.5 mb-4 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-md">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-700">
            Latest available data — no assessments recorded for the selected period.
          </p>
        </div>
      )}

      {/* Trend line — monthly aggregate */}
      {hasTrend && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Monthly trend — company avg
          </p>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} width={32} />
                <Tooltip formatter={(v: unknown) => [`${Number(v)}%`, "Avg Score"]} />
                <ReferenceLine y={85} stroke="#D97706" strokeDasharray="5 3" strokeWidth={1.5} />
                <Line type="monotone" dataKey="avgScore" stroke="#22C55E" strokeWidth={2.5} dot={{ r: 3, fill: "#22C55E" }} name="Avg Score" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Latest-month per-location bars */}
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        By location — {monthLabel(month)}
      </p>
      {barData.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="h-[360px] md:h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 5, right: 50, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: unknown, name) => [`${Number(v)}%`, String(name ?? "")]} />
              <Bar dataKey="score" name={barName} radius={[0, 4, 4, 0]} barSize={22}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={complianceColor(entry.score)} fillOpacity={0.85} />
                ))}
                <LabelList
                  dataKey="score"
                  position="right"
                  content={(props) => {
                    const { x, y, width, height, value } = props as Record<string, unknown>;
                    if (!x || !width || !y || !height) return <></>;
                    return (
                      <text
                        x={(x as number) + (width as number) + 6}
                        y={(y as number) + (height as number) / 2 + 4}
                        fontSize={12}
                        fontWeight={700}
                        fill={complianceColor(value as number)}
                      >
                        {String(value)}%
                      </text>
                    );
                  }}
                />
              </Bar>
              <ReferenceLine x={85} stroke="#D97706" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: "Target 85%", position: "top", fill: "#D97706", fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PAGE EXPORT
   ═══════════════════════════════════════════════════════════════════════ */

export default function OperationsPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <OperationsContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
