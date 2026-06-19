"use client";

/**
 * Sales section of the Executive Summary.
 *
 * Replicates the Group Sales dashboard (`app/sales/page.tsx`) exactly: it reuses
 * the same `useGroupRevenue` hook (current + prior-period) and the same
 * `computeSalesCommentary({ scope: "group", ... })` engine, building the engine
 * input from the identical `snapshotInput` logic on the source page. Numbers
 * therefore match the Group Sales dashboard to the cent for any date range.
 *
 * Renders nothing of its own beyond the shared `SectionCard`; all data flows up
 * to the page via `onSummary` (called only inside a `useEffect`).
 */

import { useEffect, useMemo } from "react";
import { DollarSign } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import { useGroupRevenue } from "@/lib/hooks/useGroupRevenue";
import { computeSalesCommentary } from "@/lib/commentary/engine";
import { normalizeRag } from "@/lib/types/executive-summary";
import type { SectionProps, DeptHeadlineKpi } from "@/lib/types/executive-summary";

const META = { slug: "sales", label: "Sales", path: "/sales" } as const;

/* €-formatter — identical to the Group Sales page `fmtK`. */
function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

/* YoY suppression — identical to the Group Sales page `calcYoY`. Suppresses the
 * badge when the LY baseline is too small to be meaningful (e.g. Slimming, which
 * opened Feb 2026 and has a handful of euros in its "LY" row). */
function calcYoY(curr: number, ly: number): number | undefined {
  if (!ly || ly < 0) return undefined;
  if (curr > 0 && ly / curr < 0.05) return undefined;
  if (ly < 500) return undefined;
  return ((curr - ly) / ly) * 100;
}

export function SalesSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  const { period, ly, isFetching } = useGroupRevenue(dateFrom, dateTo);

  // Prior-period (same-length immediately-preceding window) for the PoP signal —
  // identical window math to the source page.
  const { priorFrom, priorTo } = useMemo(() => {
    const spanDays = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000));
    const pTo = new Date(dateFrom.getTime() - 86_400_000);
    const pFrom = new Date(pTo.getTime() - spanDays * 86_400_000);
    return { priorFrom: pFrom, priorTo: pTo };
  }, [dateFrom, dateTo]);
  const { period: priorPeriod, isFetching: isPriorFetching } = useGroupRevenue(priorFrom, priorTo);

  const loading = isFetching || isPriorFetching;

  const yoy = useMemo(
    () => ({
      total: calcYoY(period.total, ly.total),
      spa: calcYoY(period.spa, ly.spa),
      spa_retail: calcYoY(period.spa_retail ?? 0, ly.spa_retail ?? 0),
      aesthetics: calcYoY(period.aesthetics, ly.aesthetics),
      slimming: calcYoY(period.slimming, ly.slimming),
    }),
    [period, ly],
  );

  // Engine input — replicates the source page's `snapshotInput` exactly.
  const commentaryInput = useMemo(() => {
    const periodLabel = `${dateFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${dateTo.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    const revenuePopPct =
      priorPeriod.total > 0 ? ((period.total - priorPeriod.total) / priorPeriod.total) * 100 : null;

    let topBrandSharePct: number | null = null;
    let topBrandName: string | null = null;
    if (period.total > 0) {
      const brands: Array<[string, number]> = [
        ["Spa", period.spa],
        ["Aesthetics", period.aesthetics],
        ["Slimming", period.slimming],
      ];
      const [name, value] = brands.reduce((best, cur) => (cur[1] > best[1] ? cur : best), brands[0]);
      topBrandSharePct = (value / period.total) * 100;
      topBrandName = name;
    }
    const spaRetailAttachPct =
      period.total > 0 && period.spa_retail !== undefined ? (period.spa_retail / period.total) * 100 : null;

    return {
      scope: "group" as const,
      periodLabel,
      periodRevenue: period.total,
      revenueYoyPct: yoy.total ?? null,
      revenuePopPct,
      spaRetailAttachPct,
      topBrandSharePct,
      topBrandName,
    };
  }, [dateFrom, dateTo, period, priorPeriod, yoy.total]);

  const result = useMemo(() => computeSalesCommentary(commentaryInput), [commentaryInput]);

  // Retail share of group — used for the Spa Retail subtitle context; the KPI
  // value itself mirrors the Group Sales "Spa Retail" card.
  const kpis: DeptHeadlineKpi[] = useMemo(() => {
    return [
      {
        label: "Group Revenue",
        value: fmtK(period.total),
        deltaPct: yoy.total,
        deltaLabel: "YoY",
      },
      {
        label: "Spa Revenue",
        value: fmtK(period.spa),
        deltaPct: yoy.spa,
        deltaLabel: "YoY",
      },
      {
        label: "Aesthetics",
        value: fmtK(period.aesthetics),
        deltaPct: yoy.aesthetics,
        deltaLabel: "YoY",
      },
      {
        label: "Slimming",
        value: fmtK(period.slimming),
        deltaPct: yoy.slimming,
        deltaLabel: "YoY",
      },
      {
        label: "Spa Retail",
        value: fmtK(period.spa_retail ?? 0),
        deltaPct: yoy.spa_retail,
        deltaLabel: "YoY",
      },
    ];
  }, [period, yoy]);

  const rag = normalizeRag(result.overallState);
  const headline = result.verdict;
  const focusAreas = useMemo(() => result.focusAreas.map((f) => f.text), [result]);
  const wins = useMemo(() => result.wins.map((f) => f.text), [result]);

  useEffect(() => {
    if (loading) {
      onSummary({
        ...META,
        rag: "NEUTRAL",
        headline: "Loading sales summary…",
        kpis: [],
        focusAreas: [],
        wins: [],
        loading: true,
      });
      return;
    }
    onSummary({
      ...META,
      rag,
      headline,
      kpis,
      focusAreas,
      wins,
      loading: false,
    });
  }, [loading, rag, headline, kpis, focusAreas, wins, dateFrom, dateTo, onSummary]);

  return (
    <SectionCard
      {...META}
      icon={DollarSign}
      rag={loading ? "NEUTRAL" : rag}
      headline={loading ? "" : headline}
      kpis={loading ? [] : kpis}
      focusAreas={loading ? [] : focusAreas}
      wins={loading ? [] : wins}
      loading={loading}
    />
  );
}
