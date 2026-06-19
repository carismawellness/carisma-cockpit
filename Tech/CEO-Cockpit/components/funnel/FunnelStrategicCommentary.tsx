"use client";

// Funnel Performance Snapshot — matches the warm amber style used across the
// Cockpit (Performance Snapshot, CRM Strategic Commentary). Reads the same
// constraint-heatmap data the rest of the funnel page uses, runs it through
// the build-time benchmarks below, and surfaces three contextual bullets.
//
// Benchmarks triangulated 2026-06-19 by a build-time expert panel:
//   • Paid-media analyst: Blended ROAS, CPL, Ad Refresh
//   • CRO analyst:        Lead Conv., Daily Leads, Leads/Day/Agent
//   • Revenue/ops:        Deposit Rate, Speed to Lead
// Every threshold + phrasing here is editable in one place. Pure function of
// (filtered data) → commentary; same inputs always produce the same output.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  BrandHeatmapMetrics,
  ConstraintHeatmapResponse,
} from "@/app/api/funnel/constraint-heatmap/route";

// ── Build-time benchmarks (editable in one place) ────────────────────────────

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

// ── Shared panel renderer (mirrors CRM SnapshotCard) ─────────────────────────

interface Bullet { text: string }

function SnapshotCard({
  title,
  subtitle,
  bullets,
  periodLabel,
}: {
  title: string;
  subtitle: string;
  bullets: Bullet[];
  periodLabel?: string;
}) {
  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">{title}</CardTitle>
        <p className="text-xs text-amber-700 mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm leading-snug text-amber-900">{b.text}</li>
          ))}
        </ul>
        {periodLabel && (
          <p className="mt-4 text-[11px] text-amber-600 font-medium">{periodLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bullet builder ────────────────────────────────────────────────────────────

const BRAND_LABEL: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

function fmtPct(v: number): string  { return `${v.toFixed(1)}%`; }
function fmtX(v: number):   string  { return `${v.toFixed(1)}×`; }
function fmtEur(v: number): string  { return `€${v.toFixed(1)}`; }

function buildFunnelBullets(
  current: Record<string, BrandHeatmapMetrics>,
  prior: Record<string, BrandHeatmapMetrics> | null,
): Bullet[] {
  const brands = ["spa", "aesthetics", "slimming"] as const;
  const bullets: Bullet[] = [];

  // ── Helpers to pick the best / worst brand for a metric ────────────────────
  type BrandScore = { slug: string; value: number; rag: RagState };
  function rank(
    metricKey: keyof BrandHeatmapMetrics,
    benchmarkKey: keyof typeof BENCHMARKS,
  ): BrandScore[] {
    const out: BrandScore[] = [];
    for (const b of brands) {
      const v = current[b]?.[metricKey];
      if (typeof v !== "number") continue;
      const rag = ragOf(v, benchmarkKey);
      if (rag) out.push({ slug: b, value: v, rag });
    }
    const dir = BENCHMARKS[benchmarkKey].higherBetter ? -1 : 1;
    return out.sort((a, b) => dir * (a.value - b.value));
  }

  // ── 1. Headline — overall funnel health based on the most critical metric ─
  // Priority: Lead Conv (1) → CPL (2) → ROAS (3) → Deposit Rate (4)
  const leadConvRanked = rank("booking_efficiency", "leadConv");
  const cplRanked      = rank("cpl", "cpl");
  const roasRanked     = rank("roas", "blendedRoas");
  const depRanked      = rank("deposit_rate", "depositRate");

  const allReds: { metric: string; slug: string; value: number; fmt: (n: number) => string }[] = [
    ...leadConvRanked.filter(r => r.rag === "red").map(r => ({ metric: "Lead Conv", slug: r.slug, value: r.value, fmt: fmtPct })),
    ...cplRanked.filter(r => r.rag === "red").map(r => ({ metric: "CPL", slug: r.slug, value: r.value, fmt: fmtEur })),
    ...roasRanked.filter(r => r.rag === "red").map(r => ({ metric: "Blended ROAS", slug: r.slug, value: r.value, fmt: fmtX })),
    ...depRanked.filter(r => r.rag === "red").map(r => ({ metric: "Deposit Rate", slug: r.slug, value: r.value, fmt: fmtPct })),
  ];

  const greenCount = [...leadConvRanked, ...cplRanked, ...roasRanked, ...depRanked].filter(r => r.rag === "green").length;
  const totalCount = leadConvRanked.length + cplRanked.length + roasRanked.length + depRanked.length;

  if (allReds.length === 0 && totalCount > 0) {
    bullets.push({
      text: `✅ Funnel is healthy across all three brands — ${greenCount}/${totalCount} core metrics on target. Protect what's working before chasing new optimisations.`,
    });
  } else if (allReds.length === 1) {
    const r = allReds[0];
    bullets.push({
      text: `⚠️ Funnel mostly healthy — single red: ${BRAND_LABEL[r.slug]} ${r.metric} at ${r.fmt(r.value)}. Address this before it spreads to adjacent metrics.`,
    });
  } else if (allReds.length >= 2) {
    const reds = allReds.slice(0, 3).map(r => `${BRAND_LABEL[r.slug]} ${r.metric}`).join(", ");
    bullets.push({
      text: `🔴 Funnel under stress — ${allReds.length} red metrics: ${reds}. Convene a funnel review this week; conversion + cost issues compound fast.`,
    });
  } else {
    bullets.push({
      text: `📊 Insufficient data for the selected range — pull a wider window or trigger an ETL sync to populate funnel commentary.`,
    });
  }

  // ── 2. Best win — biggest standout positive signal ────────────────────────
  const bestRoas = roasRanked.find(r => r.rag === "green");
  const bestLeadConv = leadConvRanked.find(r => r.rag === "green");
  const bestCpl = cplRanked.find(r => r.rag === "green");

  if (bestRoas && bestRoas.value >= 20) {
    const prevRoas = prior?.[bestRoas.slug]?.roas;
    const delta = (typeof prevRoas === "number" && prevRoas > 0)
      ? ((bestRoas.value - prevRoas) / prevRoas) * 100
      : null;
    const deltaStr = delta !== null
      ? (delta >= 5 ? ` — up ${delta.toFixed(0)}% vs last period` : delta <= -5 ? ` — down ${Math.abs(delta).toFixed(0)}% vs last period (still leading)` : "")
      : "";
    bullets.push({
      text: `🚀 ${BRAND_LABEL[bestRoas.slug]} Blended ROAS at ${fmtX(bestRoas.value)}${deltaStr} — strongest paid channel in the group. Lock in the winning campaigns and scale spend +20%.`,
    });
  } else if (bestLeadConv) {
    bullets.push({
      text: `✅ ${BRAND_LABEL[bestLeadConv.slug]} Lead Conv at ${fmtPct(bestLeadConv.value)} — above the 15% target. Document the SDR scripts driving this and brief the other brands' teams.`,
    });
  } else if (bestCpl) {
    bullets.push({
      text: `💰 ${BRAND_LABEL[bestCpl.slug]} CPL at ${fmtEur(bestCpl.value)} — under the €8 ceiling. Audience and creative are landing; consider duplicating top ad set into a second audience.`,
    });
  } else {
    bullets.push({
      text: `📊 No brand currently above-target across ROAS, Lead Conv. or CPL. Stabilise the basics before chasing growth.`,
    });
  }

  // ── 3. Most actionable focus — worst metric with concrete action ──────────
  const worstLeadConv = leadConvRanked[leadConvRanked.length - 1];
  const worstCpl      = cplRanked[cplRanked.length - 1];
  const worstRoas     = roasRanked[roasRanked.length - 1];
  const worstDep      = depRanked[depRanked.length - 1];

  // Pick whichever red is most leveraged. Priority: Lead Conv > CPL > ROAS > Deposit
  if (worstLeadConv?.rag === "red") {
    bullets.push({
      text: `🔴 ${BRAND_LABEL[worstLeadConv.slug]} Lead Conv at ${fmtPct(worstLeadConv.value)} — pause weakest ad set and run a pipeline-stage audit with the Sales Lead today.`,
    });
  } else if (worstCpl?.rag === "red") {
    bullets.push({
      text: `🔴 ${BRAND_LABEL[worstCpl.slug]} CPL at ${fmtEur(worstCpl.value)} — pause ad sets above €20 CPL today and shift budget to top-2 by lead volume.`,
    });
  } else if (worstRoas?.rag === "red") {
    bullets.push({
      text: `🔴 ${BRAND_LABEL[worstRoas.slug]} Blended ROAS at ${fmtX(worstRoas.value)} — freeze new spend, audit attribution, and pause all campaigns below 5× today.`,
    });
  } else if (worstDep?.rag === "red") {
    bullets.push({
      text: `🔴 ${BRAND_LABEL[worstDep.slug]} Deposit Rate at ${fmtPct(worstDep.value)} — mandate deposit-on-book for all SDRs; audit chat agents missing the ask within 48h.`,
    });
  } else if (worstLeadConv?.rag === "yellow") {
    bullets.push({
      text: `🟡 ${BRAND_LABEL[worstLeadConv.slug]} Lead Conv at ${fmtPct(worstLeadConv.value)} — audit speed-to-lead on the bottom 2 SDRs and pair with the top performer this week.`,
    });
  } else if (worstCpl?.rag === "yellow") {
    bullets.push({
      text: `🟡 ${BRAND_LABEL[worstCpl.slug]} CPL at ${fmtEur(worstCpl.value)} — refresh creative on the worst-CPL ad set and tighten audience to warm lookalikes.`,
    });
  } else if (worstDep?.rag === "yellow") {
    bullets.push({
      text: `🟡 ${BRAND_LABEL[worstDep.slug]} Deposit Rate at ${fmtPct(worstDep.value)} — tighten SDR deposit script and add same-day payment link this week.`,
    });
  } else {
    bullets.push({
      text: `🎯 No urgent focus area — keep monitoring CPL trends and refresh top creatives every 14 days to stay ahead of fatigue.`,
    });
  }

  return bullets;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toIso(d: Date): string { return format(d, "yyyy-MM-dd"); }
function fmtRange(from: Date, to: Date): string {
  return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
}

function priorRange(from: Date, to: Date): { from: Date; to: Date } {
  const ms = to.getTime() - from.getTime() + 86_400_000;
  const pTo   = new Date(from.getTime() - 86_400_000);
  const pFrom = new Date(pTo.getTime() - ms + 86_400_000);
  return { from: pFrom, to: pTo };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FunnelStrategicCommentary({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
}) {
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

  const bullets = useMemo(() => {
    if (!current) return [];
    return buildFunnelBullets(current.brands, prior?.brands ?? null);
  }, [current, prior]);

  if (loadingCurrent && !current) {
    return (
      <SnapshotCard
        title="Funnel Performance Snapshot"
        subtitle="Reading the funnel for this period…"
        bullets={[{ text: "📊 Computing commentary — hold on a moment." }]}
        periodLabel={fmtRange(dateFrom, dateTo)}
      />
    );
  }

  return (
    <SnapshotCard
      title="Funnel Performance Snapshot"
      subtitle="Here's what the funnel numbers are saying right now"
      bullets={bullets}
      periodLabel={fmtRange(dateFrom, dateTo)}
    />
  );
}
