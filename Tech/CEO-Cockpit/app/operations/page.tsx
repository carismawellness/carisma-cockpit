"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { Card } from "@/components/ui/card";
import { SkeletonKPIRow, ChartSkeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
} from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import {
  useGoogleReviews,
  useDiligenceAudit,
  useStandardsScores,
  useStandardsTrend,
  type DiligenceRow,
  type StandardsLocationRow,
  type WeeklyReviewSummary,
  type MonthlyStandardScore,
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
} from "lucide-react";

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
  const reviews       = useGoogleReviews(dateTo);
  const diligence     = useDiligenceAudit(dateTo);
  const facility      = useStandardsScores("facility", dateTo);
  const mystery       = useStandardsScores("mystery_guest", dateTo);
  const facilityTrend = useStandardsTrend("facility", dateTo, 12);
  const mysteryTrend  = useStandardsTrend("mystery_guest", dateTo, 12);

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

  /* ── KPI Cards (derived from live data) ───────────────────────────── */
  const kpis: KPIData[] = [
    { label: "Total Reviews", value: totalReviews.toLocaleString() },
    { label: "Avg Rating", value: `${weightedAvg} ★`, target: "4.5", targetValue: 4.5, currentValue: weightedAvg },
    ...(ratingDelta !== null
      ? [{ label: "Rating Change", value: `${ratingDelta > 0 ? "+" : ""}${ratingDelta}`, trend: ratingDelta >= 0 ? 1 : -1 } as KPIData]
      : []),
    { label: "Deleted & Cancelled", value: `${totPct(diligenceTotals.deletedCancelled)}%`, target: "<10%", targetValue: 10, currentValue: totPct(diligenceTotals.deletedCancelled) },
    { label: "Unattended (mo)", value: String(diligenceTotals.unattended), trend: diligenceTotals.unattended === 0 ? 1 : -1 },
    { label: "Facility Std %", value: `${avgFacility}%`, target: "85%", targetValue: 85, currentValue: avgFacility },
    { label: "Mystery Guest %", value: `${avgMystery}%`, target: "85%", targetValue: 85, currentValue: avgMystery },
  ];

  /* ── Review chart data — merged: bars = total reviews, label = rating ── */
  const reviewChartData = [...reviews.snapshots]
    .sort((a, b) => b.totalReviews - a.totalReviews)
    .map((l) => ({ ...l, color: LOCATION_COLORS[l.slug] ?? FALLBACK_COLOR }));

  /* ── Facility & Mystery bar data (worst first) ────────────────────── */
  const facilityBarData = [...facility.rows].sort((a, b) => a.score - b.score);
  const mysteryBarData = [...mystery.rows].sort((a, b) => a.score - b.score);

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
      <KPICardRow kpis={kpis} />

      {/* ═══════ REVIEWS — LONGITUDINAL TREND ════════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-5 w-5 text-[#B79E61]" />
          <h2 className="text-lg font-semibold text-foreground">Reviews Trend</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Weekly company-wide review count (bars) and avg rating (line) — {totalReviews.toLocaleString()} current total
          {reviews.snapshotDate ? ` · snapshot ${format(parseISO(reviews.snapshotDate), "d MMM yyyy")}` : ""}
        </p>

        {/* Trend chart — up to 10 weekly periods */}
        {reviews.weekly.length < 2 ? (
          <div className="flex flex-col items-center justify-center h-[200px] gap-2 text-muted-foreground">
            <span className="text-4xl">📈</span>
            <p className="text-sm font-medium">Building history&hellip;</p>
            <p className="text-xs max-w-xs text-center">
              Weekly snapshots are collected each time the Google Reviews ETL runs. Check back after a few days for longitudinal data.
            </p>
          </div>
        ) : (
          <div className="h-[260px] md:h-[300px] mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={reviews.weekly}
                margin={{ top: 10, right: 45, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Reviews", angle: -90, position: "insideLeft", fontSize: 10, dy: 40 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[4, 5]}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  tick={{ fontSize: 11 }}
                  label={{ value: "Rating", angle: 90, position: "insideRight", fontSize: 10, dy: -25 }}
                />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => {
                    if (name === "Avg Rating") return [`${Number(value).toFixed(2)} ★`, "Avg Rating"];
                    return [String(Number(value).toLocaleString()), "Total Reviews"];
                  }}
                />
                <Bar yAxisId="left" dataKey="totalReviews" name="Total Reviews" fill="#B79E61" fillOpacity={0.65} radius={[4, 4, 0, 0]} barSize={28} />
                <Line yAxisId="right" type="monotone" dataKey="avgRating" name="Avg Rating" stroke="#22C55E" strokeWidth={2.5} dot={{ r: 4, fill: "#22C55E" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per-location snapshot table */}
        {reviewChartData.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Latest snapshot by location
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-warm-border/50 text-left">
                    <th className="py-1.5 px-3 text-xs font-semibold text-muted-foreground">Location</th>
                    <th className="py-1.5 px-3 text-xs font-semibold text-muted-foreground text-right">Reviews</th>
                    <th className="py-1.5 px-3 text-xs font-semibold text-muted-foreground text-right">Rating</th>
                    <th className="py-1.5 px-3 text-xs font-semibold text-muted-foreground text-right">vs prev</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewChartData.map((loc) => {
                    const delta = loc.prevRating != null ? +(loc.avgRating - loc.prevRating).toFixed(2) : null;
                    return (
                      <tr key={loc.slug} className="border-b border-warm-border/30 hover:bg-muted/20">
                        <td className="py-1.5 px-3 font-medium text-foreground">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: loc.color }} />
                          {loc.name}
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{loc.totalReviews.toLocaleString()}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums font-semibold" style={{ color: scoreColor(loc.avgRating) }}>
                          {loc.avgRating.toFixed(2)} ★
                        </td>
                        <td className="py-1.5 px-3 text-right tabular-nums text-xs">
                          {delta != null
                            ? <span style={{ color: delta >= 0 ? "#22C55E" : "#EF4444" }}>{delta > 0 ? "+" : ""}{delta.toFixed(2)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

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
                {/* Deleted & Cancelled (combined in source report) */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-medium text-foreground sticky left-0 bg-white z-10">
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
                {/* Unattended */}
                <tr className="border-b border-warm-border/50">
                  <td className="py-2 px-3 font-medium text-foreground sticky left-0 bg-white z-10">
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
      />

    </>
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
}: {
  title: string;
  icon: React.ReactNode;
  month: string | null;
  aggregate: number;
  barData: StandardsLocationRow[];
  barName: string;
  trend: MonthlyStandardScore[];
  emptyMessage: string;
}) {
  const hasTrend = trend.length >= 2;

  return (
    <Card className="p-3 md:p-6">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Latest month ({monthLabel(month)}): {aggregate}% — green &ge;85%, amber 60-84%, red &lt;60%
      </p>

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
