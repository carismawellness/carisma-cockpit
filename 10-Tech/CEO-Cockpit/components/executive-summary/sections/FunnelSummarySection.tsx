"use client";

/**
 * Funnel section of the Executive Summary.
 *
 * Reuses the SAME data source + benchmark logic as the Funnel dashboard's
 * Strategic Commentary (`components/funnel/FunnelStrategicCommentary.tsx`):
 *   • Data:  GET /api/funnel/constraint-heatmap  (current + prior range)
 *   • Logic: the build-time BENCHMARKS + ragOf() + the headline/win/focus
 *            selection from buildFunnelBullets(). That function is not exported,
 *            so the identical thresholds and ranking are replicated here verbatim
 *            to guarantee the verdict, focus areas and wins match the dashboard.
 *
 * The constraint-heatmap response is per-brand; the headline bullet's overall
 * read (count of "red" core metrics → healthy / single-red / under-stress) is
 * what determines this section's RAG and verdict, exactly as on the funnel page.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Filter } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import { normalizeRag } from "@/lib/types/executive-summary";
import type { RAG, SectionProps, DeptHeadlineKpi } from "@/lib/types/executive-summary";
import type {
  BrandHeatmapMetrics,
  ConstraintHeatmapResponse,
} from "@/app/api/funnel/constraint-heatmap/route";

const META = { slug: "funnel", label: "Funnel", path: "/funnel" } as const;

/* ── Build-time benchmarks — copied verbatim from FunnelStrategicCommentary ─── */

const BENCHMARKS = {
  blendedRoas:   { green: 15,  yellow: 8,   higherBetter: true  },
  cpl:           { green: 8,   yellow: 15,  higherBetter: false },
  leadConv:      { green: 15,  yellow: 10,  higherBetter: true  },
  dailyLeads:    { green: 50,  yellow: 30,  higherBetter: true  },
  leadsPerAgent: { green: 8,   yellow: 5,   higherBetter: true  },
  depositRate:   { green: 25,  yellow: 15,  higherBetter: true  },
  speedToLead:   { green: 5,   yellow: 15,  higherBetter: false },
  adRefresh:     { green: 14,  yellow: 21,  higherBetter: false },
} as const;

type RagState = "green" | "yellow" | "red";

function ragOf(v: number | null | undefined, key: keyof typeof BENCHMARKS): RagState | null {
  if (v === null || v === undefined) return null;
  const b = BENCHMARKS[key];
  if (b.higherBetter) {
    if (v >= b.green) return "green";
    if (v >= b.yellow) return "yellow";
    return "red";
  } else {
    if (v <= b.green) return "green";
    if (v <= b.yellow) return "yellow";
    return "red";
  }
}

const BRAND_LABEL: Record<string, string> = { spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming" };
const BRANDS = ["spa", "aesthetics", "slimming"] as const;

function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }
function fmtX(v: number):   string { return `${v.toFixed(1)}×`; }
function fmtEur(v: number): string { return `€${v.toFixed(1)}`; }

type BrandScore = { slug: string; value: number; rag: RagState };

function rank(
  current: Record<string, BrandHeatmapMetrics>,
  metricKey: keyof BrandHeatmapMetrics,
  benchmarkKey: keyof typeof BENCHMARKS,
): BrandScore[] {
  const out: BrandScore[] = [];
  for (const b of BRANDS) {
    const v = current[b]?.[metricKey];
    if (typeof v !== "number") continue;
    const r = ragOf(v, benchmarkKey);
    if (r) out.push({ slug: b, value: v, rag: r });
  }
  const dir = BENCHMARKS[benchmarkKey].higherBetter ? -1 : 1;
  return out.sort((a, b) => dir * (a.value - b.value));
}

/**
 * Replicates the verdict / RAG / win / focus derivation of buildFunnelBullets().
 * Returns plain strings (no leading emoji) for the Executive Summary card.
 */
function deriveFunnelSummary(
  current: Record<string, BrandHeatmapMetrics>,
  prior: Record<string, BrandHeatmapMetrics> | null,
): { rag: RAG; headline: string; wins: string[]; focusAreas: string[] } {
  const leadConvRanked = rank(current, "booking_efficiency", "leadConv");
  const cplRanked      = rank(current, "cpl", "cpl");
  const roasRanked     = rank(current, "roas", "blendedRoas");
  const depRanked      = rank(current, "deposit_rate", "depositRate");

  const allReds: { metric: string; slug: string; value: number; fmt: (n: number) => string }[] = [
    ...leadConvRanked.filter(r => r.rag === "red").map(r => ({ metric: "Lead Conv", slug: r.slug, value: r.value, fmt: fmtPct })),
    ...cplRanked.filter(r => r.rag === "red").map(r => ({ metric: "CPL", slug: r.slug, value: r.value, fmt: fmtEur })),
    ...roasRanked.filter(r => r.rag === "red").map(r => ({ metric: "Blended ROAS", slug: r.slug, value: r.value, fmt: fmtX })),
    ...depRanked.filter(r => r.rag === "red").map(r => ({ metric: "Deposit Rate", slug: r.slug, value: r.value, fmt: fmtPct })),
  ];

  const greenCount = [...leadConvRanked, ...cplRanked, ...roasRanked, ...depRanked].filter(r => r.rag === "green").length;
  const totalCount = leadConvRanked.length + cplRanked.length + roasRanked.length + depRanked.length;

  // ── Headline + RAG (mirrors bullet 1) ──────────────────────────────────────
  let rag: RAG;
  let headline: string;
  if (totalCount === 0) {
    rag = normalizeRag("insufficient"); // → NEUTRAL
    headline = "Insufficient funnel data for the selected range — pull a wider window or trigger an ETL sync.";
  } else if (allReds.length === 0) {
    rag = normalizeRag("green");
    headline = `Funnel healthy across all three brands — ${greenCount}/${totalCount} core metrics on target.`;
  } else if (allReds.length === 1) {
    const r = allReds[0];
    rag = normalizeRag("yellow");
    headline = `Top constraint: ${BRAND_LABEL[r.slug]} ${r.metric} at ${r.fmt(r.value)} — address before it spreads.`;
  } else {
    const reds = allReds.slice(0, 3).map(r => `${BRAND_LABEL[r.slug]} ${r.metric}`).join(", ");
    rag = normalizeRag("red");
    headline = `Funnel under stress — ${allReds.length} red metrics: ${reds}.`;
  }

  // ── Win (mirrors bullet 2) ─────────────────────────────────────────────────
  const wins: string[] = [];
  const bestRoas = roasRanked.find(r => r.rag === "green");
  const bestLeadConv = leadConvRanked.find(r => r.rag === "green");
  const bestCpl = cplRanked.find(r => r.rag === "green");

  if (bestRoas && bestRoas.value >= 20) {
    const prevRoas = prior?.[bestRoas.slug]?.roas;
    const delta = (typeof prevRoas === "number" && prevRoas > 0)
      ? ((bestRoas.value - prevRoas) / prevRoas) * 100
      : null;
    const deltaStr = delta !== null
      ? (delta >= 5 ? ` (up ${delta.toFixed(0)}% vs last period)` : delta <= -5 ? ` (down ${Math.abs(delta).toFixed(0)}%, still leading)` : "")
      : "";
    wins.push(`${BRAND_LABEL[bestRoas.slug]} Blended ROAS at ${fmtX(bestRoas.value)}${deltaStr} — strongest paid channel; scale spend.`);
  } else if (bestLeadConv) {
    wins.push(`${BRAND_LABEL[bestLeadConv.slug]} Lead Conv at ${fmtPct(bestLeadConv.value)} — above the 15% target.`);
  } else if (bestCpl) {
    wins.push(`${BRAND_LABEL[bestCpl.slug]} CPL at ${fmtEur(bestCpl.value)} — under the €8 ceiling.`);
  }

  // ── Focus (mirrors bullet 3) ───────────────────────────────────────────────
  const focusAreas: string[] = [];
  const worstLeadConv = leadConvRanked[leadConvRanked.length - 1];
  const worstCpl      = cplRanked[cplRanked.length - 1];
  const worstRoas     = roasRanked[roasRanked.length - 1];
  const worstDep      = depRanked[depRanked.length - 1];

  if (worstLeadConv?.rag === "red") {
    focusAreas.push(`${BRAND_LABEL[worstLeadConv.slug]} Lead Conv at ${fmtPct(worstLeadConv.value)} — pause weakest ad set and run a pipeline-stage audit.`);
  } else if (worstCpl?.rag === "red") {
    focusAreas.push(`${BRAND_LABEL[worstCpl.slug]} CPL at ${fmtEur(worstCpl.value)} — pause ad sets above €20 CPL and shift budget to top-2 by volume.`);
  } else if (worstRoas?.rag === "red") {
    focusAreas.push(`${BRAND_LABEL[worstRoas.slug]} Blended ROAS at ${fmtX(worstRoas.value)} — freeze new spend and pause campaigns below 5×.`);
  } else if (worstDep?.rag === "red") {
    focusAreas.push(`${BRAND_LABEL[worstDep.slug]} Deposit Rate at ${fmtPct(worstDep.value)} — mandate deposit-on-book for all SDRs.`);
  } else if (worstLeadConv?.rag === "yellow") {
    focusAreas.push(`${BRAND_LABEL[worstLeadConv.slug]} Lead Conv at ${fmtPct(worstLeadConv.value)} — audit speed-to-lead on the bottom 2 SDRs.`);
  } else if (worstCpl?.rag === "yellow") {
    focusAreas.push(`${BRAND_LABEL[worstCpl.slug]} CPL at ${fmtEur(worstCpl.value)} — refresh creative on the worst-CPL ad set.`);
  } else if (worstDep?.rag === "yellow") {
    focusAreas.push(`${BRAND_LABEL[worstDep.slug]} Deposit Rate at ${fmtPct(worstDep.value)} — tighten SDR deposit script.`);
  }

  return { rag, headline, wins, focusAreas };
}

/* ── Group-level hero metrics (sums across brands) ───────────────────────────── */

function sumField(
  brands: Record<string, BrandHeatmapMetrics>,
  field: keyof BrandHeatmapMetrics,
): number {
  let s = 0;
  for (const b of BRANDS) {
    const v = brands[b]?.[field];
    if (typeof v === "number") s += v;
  }
  return s;
}

/* ── Date helpers (mirror FunnelStrategicCommentary) ──────────────────────────── */

function toIso(d: Date): string { return format(d, "yyyy-MM-dd"); }

function priorRange(from: Date, to: Date): { from: Date; to: Date } {
  const ms = to.getTime() - from.getTime() + 86_400_000;
  const pTo   = new Date(from.getTime() - 86_400_000);
  const pFrom = new Date(pTo.getTime() - ms + 86_400_000);
  return { from: pFrom, to: pTo };
}

/* ── Component ─────────────────────────────────────────────────────────────────*/

export function FunnelSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  const from = toIso(dateFrom);
  const to   = toIso(dateTo);

  const { data: current, isFetching: loadingCurrent } = useQuery<ConstraintHeatmapResponse>({
    queryKey: ["funnel-commentary-current", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/funnel/constraint-heatmap?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`constraint-heatmap ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const { from: pFrom, to: pTo } = priorRange(dateFrom, dateTo);
  const pFromIso = toIso(pFrom);
  const pToIso   = toIso(pTo);
  const { data: prior } = useQuery<ConstraintHeatmapResponse>({
    queryKey: ["funnel-commentary-prior", pFromIso, pToIso],
    queryFn: async () => {
      const res = await fetch(`/api/funnel/constraint-heatmap?from=${pFromIso}&to=${pToIso}`);
      if (!res.ok) throw new Error(`constraint-heatmap (prior) ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const loading = loadingCurrent && !current;

  const summary = useMemo(() => {
    if (!current) return null;

    const { rag, headline, wins, focusAreas } = deriveFunnelSummary(
      current.brands,
      prior?.brands ?? null,
    );

    // ── Group-level KPIs ──────────────────────────────────────────────────────
    const totalLeads    = sumField(current.brands, "total_leads");
    const totalBookings = sumField(current.brands, "total_bookings");
    const totalDeposits = (() => {
      // deposit count = deposit_rate% × bookings, summed per brand
      let s = 0;
      for (const b of BRANDS) {
        const dr = current.brands[b]?.deposit_rate;
        const bk = current.brands[b]?.total_bookings;
        if (typeof dr === "number" && typeof bk === "number") s += (dr / 100) * bk;
      }
      return s;
    })();

    // Hero: blended lead → booking conversion (awareness → conversion)
    const leadToBooking = totalLeads > 0 ? (totalBookings / totalLeads) * 100 : null;
    // Stage 2: booking → deposit (conversion stage of the funnel)
    const bookingToDeposit = totalBookings > 0 ? (totalDeposits / totalBookings) * 100 : null;

    // Prior-period blended lead→booking for the hero delta
    const pLeads    = prior ? sumField(prior.brands, "total_leads") : 0;
    const pBookings = prior ? sumField(prior.brands, "total_bookings") : 0;
    const pLeadToBooking = pLeads > 0 ? (pBookings / pLeads) * 100 : null;
    const leadToBookingDelta =
      leadToBooking !== null && pLeadToBooking !== null && pLeadToBooking !== 0
        ? leadToBooking - pLeadToBooking // percentage-point change
        : undefined;

    const kpis: DeptHeadlineKpi[] = [
      {
        label: "Lead → Booking",
        value: leadToBooking !== null ? `${leadToBooking.toFixed(1)}%` : "—",
        ...(leadToBookingDelta !== undefined
          ? { deltaPct: leadToBookingDelta, deltaLabel: "PoP", deltaIsPoints: true }
          : {}),
      },
      {
        label: "Booking → Deposit",
        value: bookingToDeposit !== null ? `${bookingToDeposit.toFixed(1)}%` : "—",
      },
      {
        label: "Total Leads",
        value: totalLeads > 0 ? Math.round(totalLeads).toLocaleString() : "—",
      },
      {
        label: "Total Bookings",
        value: totalBookings > 0 ? Math.round(totalBookings).toLocaleString() : "—",
      },
    ];

    return {
      ...META,
      rag,
      headline,
      kpis,
      focusAreas,
      wins,
      loading: false,
    };
  }, [current, prior]);

  useEffect(() => {
    if (loading || !summary) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading funnel summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
      return;
    }
    onSummary(summary);
  }, [loading, summary, onSummary]);

  if (loading || !summary) {
    return (
      <SectionCard
        {...META}
        icon={Filter}
        rag="NEUTRAL"
        headline=""
        kpis={[]}
        focusAreas={[]}
        wins={[]}
        loading
      />
    );
  }

  return <SectionCard {...summary} icon={Filter} loading={summary.loading} />;
}
