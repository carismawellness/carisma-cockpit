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
  type DiligenceRow,
  type StandardsLocationRow,
} from "@/lib/hooks/useOperationsData";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
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
  AlertTriangle,
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
  inter:               BRAND.spa.dark,
  hugos:               "#B8C9E0",
  ramla:               "#E5B8B0",
  hyatt:               "#E5C088",
  excelsior:           "#D5C0E5",
  novotel:             "#B5DCDC",
  labranda:            "#C7C4BD",
  odycy:               "#E5B5D0",
  "aesthetics-clinic": BRAND.aesthetics.dark,
  "slimming-clinic":   BRAND.slimming.dark,
};
const FALLBACK_COLOR = "#9CA3AF";

// Compact labels for the diligence heatmap column headers.
const SHORT_NAMES: Record<string, string> = {
  inter:               "Inter",
  hugos:               "Hugos",
  hyatt:               "Hyatt",
  ramla:               "Ramla",
  labranda:            "Labranda",
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
  const reviews   = useGoogleReviews(dateTo);
  const diligence = useDiligenceAudit(dateFrom, dateTo);
  const facility  = useStandardsScores("facility", dateFrom, dateTo);
  const mystery   = useStandardsScores("mystery_guest", dateFrom, dateTo);

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

  /* ── Collect all attention items ──────────────────────────────────── */
  const attentionItems: { type: "facility" | "mystery" | "diligence"; location: string; details: string[] }[] = [];

  // Cap per-card issue lists — full lists live in the section cards below.
  const capIssues = (details: string[], max = 4) =>
    details.length > max
      ? [...details.slice(0, max), `… +${details.length - max} more below`]
      : details;

  for (const loc of facility.rows) {
    if (loc.score < 85 && loc.issues.length > 0) {
      attentionItems.push({ type: "facility", location: loc.name, details: capIssues(loc.issues.map((i) => `[Facility ${loc.score}%] ${i.item}`)) });
    }
  }
  for (const loc of mystery.rows) {
    if (loc.score < 85 && loc.issues.length > 0) {
      attentionItems.push({ type: "mystery", location: loc.name, details: capIssues(loc.issues.map((i) => `[Mystery Guest ${loc.score}%] ${i.item}`)) });
    }
  }
  for (const d of diligence.rows) {
    const issues: string[] = [];
    const delCanPct = pctOf(d.deletedCancelled, d.totalSales);
    const cashPct = pctOf(d.cashSales, d.totalSales);
    const discCashPct = pctOf(d.discountedCash, d.totalSales);
    if (cashPct > DILIGENCE_THRESHOLDS.cashPct) issues.push(`Cash at ${cashPct}% (threshold: <${DILIGENCE_THRESHOLDS.cashPct}%)`);
    if (delCanPct > DILIGENCE_THRESHOLDS.deletedCancelledPct) issues.push(`Deleted & cancelled at ${delCanPct}% (threshold: <${DILIGENCE_THRESHOLDS.deletedCancelledPct}%)`);
    if (d.unattended > 10) issues.push(`${d.unattended} unattended bookings`);
    if (discCashPct > DILIGENCE_THRESHOLDS.discountedCashPct) issues.push(`Discounted cash at ${discCashPct}% (threshold: <${DILIGENCE_THRESHOLDS.discountedCashPct}%)`);
    if (issues.length > 0) attentionItems.push({ type: "diligence", location: d.name, details: issues.map((i) => `[Diligence] ${i}`) });
  }

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

      {/* ═══════ AREAS NEEDING ATTENTION ═════════════════════════════ */}
      {attentionItems.length > 0 && (
        <Card className="p-4 border-red-200 bg-gradient-to-r from-red-50/40 via-amber-50/20 to-transparent">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h2 className="text-base font-bold text-red-800">
              Areas Needing Attention — {attentionItems.length} Locations Flagged
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {attentionItems.map((item) => {
              const borderColor = item.type === "diligence" ? "border-red-300" : item.type === "facility" ? "border-amber-300" : "border-purple-300";
              const iconColor = item.type === "diligence" ? "text-red-500" : item.type === "facility" ? "text-amber-500" : "text-purple-500";
              const Icon = item.type === "diligence" ? ShieldAlert : item.type === "facility" ? ClipboardCheck : UserSearch;
              return (
                <div key={`${item.type}-${item.location}`} className={cn("rounded-lg border p-3 bg-white/80", borderColor)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className={cn("h-4 w-4", iconColor)} />
                    <span className="text-sm font-semibold text-foreground">{item.location}</span>
                  </div>
                  <ul className="space-y-0.5 ml-6">
                    {item.details.map((detail, i) => (
                      <li key={i} className="text-xs text-muted-foreground list-disc">{detail}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ═══════ REVIEWS — COMBINED CHART ════════════════════════════ */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center gap-2 mb-1">
          <Star className="h-5 w-5 text-[#B79E61]" />
          <h2 className="text-lg font-semibold text-foreground">Reviews by Location</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Total Google reviews per location with average rating — {totalReviews.toLocaleString()} company-wide
          {reviews.snapshotDate ? ` · snapshot ${format(parseISO(reviews.snapshotDate), "d MMM yyyy")}` : ""}
        </p>
        {reviewChartData.length === 0 ? (
          <EmptyState message="No review snapshots available — run the google-reviews ETL first." />
        ) : (
          <div className="h-[380px] md:h-[440px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={reviewChartData}
                layout="vertical"
                margin={{ top: 5, right: 90, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: unknown, name) => {
                    if (name === "Total Reviews") return [String(Number(value)), String(name ?? "")];
                    return [`${Number(value).toFixed(1)} ★`, String(name ?? "")];
                  }}
                />
                <Bar dataKey="totalReviews" name="Total Reviews" radius={[0, 4, 4, 0]} barSize={22}>
                  {reviewChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                  ))}
                  <LabelList
                    dataKey="totalReviews"
                    position="right"
                    content={(props) => {
                      const { x, y, width, height, index } = props as Record<string, unknown>;
                      if (!x || !width || !y || !height || index === undefined) return <></>;
                      const loc = reviewChartData[index as number];
                      const xPos = (x as number) + (width as number) + 8;
                      const yPos = (y as number) + (height as number) / 2 + 4;
                      return (
                        <g>
                          <text x={xPos} y={yPos} fontSize={12} fontWeight={600} fill="#374151">
                            {loc.totalReviews}
                          </text>
                          <text x={xPos + 38} y={yPos} fontSize={12} fontWeight={700} fill={scoreColor(loc.avgRating)}>
                            {loc.avgRating.toFixed(1)} ★
                          </text>
                        </g>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
  emptyMessage,
}: {
  title: string;
  icon: React.ReactNode;
  month: string | null;
  aggregate: number;
  barData: StandardsLocationRow[];
  barName: string;
  emptyMessage: string;
}) {
  return (
    <Card className="p-3 md:p-6">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-lg font-semibold text-foreground">{title} — {monthLabel(month)}</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Aggregate: {aggregate}% — green &ge;85%, amber 60-84%, red &lt;60%
      </p>
      {barData.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
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

          {barData.filter((l) => l.score < 85 && l.issues.length > 0).length > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Issues</h3>
              {barData
                .filter((l) => l.score < 85 && l.issues.length > 0)
                .map((loc) => (
                  <div key={loc.slug} className="rounded-lg border border-amber-200 bg-amber-50/30 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-bold", complianceBg(loc.score))}>{loc.score}%</span>
                      <span className="text-sm font-semibold text-foreground">{loc.name}</span>
                      <span className="text-xs text-muted-foreground">{loc.passed}/{loc.total} items passed</span>
                    </div>
                    <ul className="space-y-1 ml-4">
                      {loc.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-muted-foreground list-disc">
                          <span className="font-medium text-foreground/70">{issue.category}:</span> {issue.item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </>
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
