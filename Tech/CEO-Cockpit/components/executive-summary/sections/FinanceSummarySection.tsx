"use client";

/**
 * Finance (EBITDA) section of the Executive Summary.
 *
 * Replicates the EBITDA-v2 dashboard's exact data path so the numbers match to
 * the cent. The dashboard (app/finance/ebitda-v2/page.tsx) does NOT use the
 * `useEbitdaAggregated` hook — it fetches `/api/finance/ebitda-v2` directly for
 * the current period plus the same period prior year (SPPY, the year in the
 * date strings decremented by one), then feeds `data.group` / `sppyData.group`
 * into `computeEbitdaCommentary` (via <StrategicCommentary/>). We mirror that
 * here exactly: same endpoint, same SPPY derivation, same `.group` mapping,
 * same commentary engine.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { SectionCard } from "@/components/executive-summary/SectionCard";
import {
  computeEbitdaCommentary,
  type PeriodData,
  type MetricResult,
} from "@/lib/commentary/engine";
import {
  normalizeRag,
  type SectionProps,
  type DeptSummary,
  type DeptHeadlineKpi,
} from "@/lib/types/executive-summary";

const META = { slug: "finance", label: "Finance", path: "/finance/ebitda-v2" } as const;

// ── Group shape returned by /api/finance/ebitda-v2 (the `group` field) ────────
// Mirrors VenueData in the EBITDA-v2 page — only the fields the commentary
// engine + our KPIs need.
interface GroupData {
  revenue: number;
  wages: number;
  advertising: number;
  sga: number;
  cogs: number;
  rent: number;
  utilities: number;
  ebitda: number;
}

interface V2Response {
  group?: GroupData;
  error?: string;
}

// Format a Date as YYYY-MM-DD using LOCAL components (matches the dashboard's
// `toIso` — never toISOString(), which would shift the date in UTC+ zones).
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Same period prior year: decrement the leading 4-digit year in the ISO string.
// (Replicates the SPPY query the dashboard builds inline.)
function priorYearIso(iso: string): string {
  return iso.replace(/^(\d{4})/, (y) => String(+y - 1));
}

function emptyGroup(): GroupData {
  return { revenue: 0, wages: 0, advertising: 0, sga: 0, cogs: 0, rent: 0, utilities: 0, ebitda: 0 };
}

function toPeriodData(g: GroupData): PeriodData {
  return {
    revenue: g.revenue,
    wages: g.wages,
    advertising: g.advertising,
    sga: g.sga,
    cogs: g.cogs,
    rent: g.rent,
    utilities: g.utilities,
    ebitda: g.ebitda,
  };
}

function fmtEur(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(1)}K`;
  return `${sign}€${abs.toFixed(0)}`;
}

// Percent change vs prior (for € KPIs). undefined when prior is non-positive.
function pctChange(curr: number, prior: number): number | undefined {
  if (!prior || prior === 0) return undefined;
  return ((curr - prior) / Math.abs(prior)) * 100;
}

function buildSummary(
  group: GroupData,
  priorGroup: GroupData | null,
): DeptSummary {
  const commentary = computeEbitdaCommentary(
    toPeriodData(group),
    priorGroup ? toPeriodData(priorGroup) : null,
  );

  const rev = group.revenue;
  const ebitdaMargin = rev > 0 ? (group.ebitda / rev) * 100 : 0;
  const priorRev = priorGroup?.revenue ?? 0;
  const priorMargin = priorRev > 0 ? (priorGroup!.ebitda / priorRev) * 100 : undefined;
  const wagesPct = rev > 0 ? (group.wages / rev) * 100 : 0;
  const priorWagesPct = priorRev > 0 ? (priorGroup!.wages / priorRev) * 100 : undefined;

  // kpis[0] = EBITDA margin % (pp change vs prior). Then Group EBITDA €,
  // Revenue €, and Wages % of revenue (a cost line — inverted delta).
  const kpis: DeptHeadlineKpi[] = [
    {
      label: "EBITDA Margin",
      value: `${ebitdaMargin.toFixed(1)}%`,
      deltaPct: priorMargin !== undefined ? ebitdaMargin - priorMargin : undefined,
      deltaLabel: "PoP",
      deltaIsPoints: true,
    },
    {
      label: "Group EBITDA",
      value: fmtEur(group.ebitda),
      deltaPct: pctChange(group.ebitda, priorGroup?.ebitda ?? 0),
      deltaLabel: "PoP",
    },
    {
      label: "Revenue",
      value: fmtEur(rev),
      deltaPct: pctChange(rev, priorRev),
      deltaLabel: "PoP",
    },
    {
      label: "Wages % Rev",
      value: `${wagesPct.toFixed(1)}%`,
      deltaPct: priorWagesPct !== undefined ? wagesPct - priorWagesPct : undefined,
      deltaLabel: "PoP",
      deltaIsPoints: true,
      invertDelta: true, // a rising wage ratio is bad
    },
  ];

  const toLine = (r: MetricResult) => `${r.label}: ${r.text}`;
  const insufficient = commentary.insufficientData || rev <= 0;

  return {
    ...META,
    rag: insufficient ? "NEUTRAL" : normalizeRag(commentary.overallRag),
    headline: insufficient
      ? "Not enough finance data for this period."
      : commentary.verdictText,
    kpis,
    focusAreas: commentary.focusAreas.map(toLine),
    wins: commentary.wins.map(toLine),
    loading: false,
  };
}

const LOADING_SUMMARY: DeptSummary = {
  ...META,
  rag: "NEUTRAL",
  headline: "Loading finance summary…",
  kpis: [],
  focusAreas: [],
  wins: [],
  loading: true,
};

export function FinanceSummarySection({ dateFrom, dateTo, onSummary }: SectionProps) {
  const dfIso = toIso(dateFrom);
  const dtIso = toIso(dateTo);
  const sppyDf = priorYearIso(dfIso);
  const sppyDt = priorYearIso(dtIso);

  // Current period — same endpoint the dashboard hits.
  const currentQ = useQuery<V2Response>({
    queryKey: ["ebitda-v2-group", dfIso, dtIso],
    queryFn: async () => {
      const res = await fetch(`/api/finance/ebitda-v2?date_from=${dfIso}&date_to=${dtIso}`, {
        cache: "no-store",
      });
      const d = (await res.json()) as V2Response;
      if (d.error) throw new Error(d.error);
      return d;
    },
    staleTime: 30_000,
  });

  // Same period prior year (SPPY) — the dashboard catches errors and treats a
  // failed/empty SPPY as "no prior". We mirror that (null on error/empty).
  const sppyQ = useQuery<V2Response | null>({
    queryKey: ["ebitda-v2-group-sppy", sppyDf, sppyDt],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/finance/ebitda-v2?date_from=${sppyDf}&date_to=${sppyDt}`, {
          cache: "no-store",
        });
        const d = (await res.json()) as V2Response;
        return d.error ? null : d;
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });

  // The dashboard's loading state is driven by the current-period fetch only.
  const loading = currentQ.isLoading || currentQ.isFetching;

  const summary: DeptSummary = useMemo(() => {
    if (loading) return LOADING_SUMMARY;
    const group = currentQ.data?.group ?? emptyGroup();
    const priorGroup = sppyQ.data?.group ?? null;
    return buildSummary(group, priorGroup);
  }, [loading, currentQ.data, sppyQ.data]);

  // Report up to the page — only inside an effect, never during render. The
  // page's `report` callback is useCallback-stable, so listing it is loop-safe.
  useEffect(() => {
    onSummary(summary);
  }, [summary, onSummary]);

  return <SectionCard {...summary} icon={TrendingUp} loading={summary.loading} />;
}
