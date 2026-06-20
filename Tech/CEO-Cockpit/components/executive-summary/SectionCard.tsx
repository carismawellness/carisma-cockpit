"use client";

/**
 * SectionCard — the shared presentational card for every department section on
 * the Executive Summary page. Section components compute their own data and
 * pass a normalized shape here, so the look stays identical across all 7.
 */

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDateRange } from "@/lib/hooks/useDateRange";
import { toLocalDateStr } from "@/lib/utils/dates";
import { calmText, type RAG, type DeptHeadlineKpi } from "@/lib/types/executive-summary";

/* ── RAG styling ──────────────────────────────────────────────────────────────
 * Deliberately calm: soft, low-saturation tints (rose, not fire-engine red) and
 * a small dot rather than large red fills. The state is still legible, but the
 * page reads as a measured briefing, not an alarm. */

const RAG_BADGE: Record<RAG, string> = {
  GREEN: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  YELLOW: "bg-amber-50 text-amber-700 ring-amber-100",
  RED: "bg-rose-50 text-rose-600 ring-rose-100",
  NEUTRAL: "bg-slate-100 text-slate-500 ring-slate-200",
};

const RAG_ACCENT: Record<RAG, string> = {
  GREEN: "before:bg-emerald-300",
  YELLOW: "before:bg-amber-300",
  RED: "before:bg-rose-300",
  NEUTRAL: "before:bg-slate-200",
};

const RAG_DOT: Record<RAG, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-400",
  RED: "bg-rose-400",
  NEUTRAL: "bg-slate-400",
};

const RAG_LABEL: Record<RAG, string> = {
  GREEN: "On track",
  YELLOW: "Watch",
  RED: "Needs focus",
  NEUTRAL: "—",
};

export function RagBadge({ rag, className }: { rag: RAG; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        RAG_BADGE[rag],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", RAG_DOT[rag])} />
      {RAG_LABEL[rag]}
    </span>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────────────── */

function KpiTile({ kpi }: { kpi: DeptHeadlineKpi }) {
  const hasDelta = kpi.deltaPct !== undefined && isFinite(kpi.deltaPct);
  const up = hasDelta && (kpi.deltaPct as number) >= 0;
  // For inverted metrics (cost, CPL) an increase is bad.
  const good = hasDelta ? (kpi.invertDelta ? !up : up) : true;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const deltaStr = hasDelta
    ? `${up ? "+" : ""}${(kpi.deltaPct as number).toFixed(1)}${kpi.deltaIsPoints ? "pp" : "%"}`
    : "";

  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {kpi.label}
      </p>
      <p className="mt-0.5 text-base font-bold leading-tight text-foreground">{kpi.value}</p>
      {hasDelta && (
        <span
          className={cn(
            "mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold",
            good ? "text-emerald-600" : "text-rose-500",
          )}
        >
          <Arrow className="h-3 w-3" />
          {deltaStr}
          {kpi.deltaLabel && <span className="font-normal text-muted-foreground"> {kpi.deltaLabel}</span>}
        </span>
      )}
    </div>
  );
}

/* ── Section card ─────────────────────────────────────────────────────────── */

export interface SectionCardProps {
  slug: string;
  label: string;
  path: string;
  icon?: React.ComponentType<{ className?: string }>;
  rag: RAG;
  headline: string;
  kpis: DeptHeadlineKpi[];
  focusAreas: string[];
  wins: string[];
  loading?: boolean;
}

export function SectionCard({
  label,
  path,
  icon: Icon,
  rag,
  headline,
  kpis,
  focusAreas,
  wins,
  loading = false,
}: SectionCardProps) {
  const { from, to } = useDateRange();
  const href = `${path}?from=${toLocalDateStr(from)}&to=${toLocalDateStr(to)}`;

  if (loading) {
    return (
      <Card className="relative animate-pulse pl-4 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-slate-200">
        <div className="px-4 space-y-3">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-muted/60" />
            ))}
          </div>
          <div className="h-3 w-5/6 rounded bg-muted/60" />
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "relative pl-4 before:absolute before:left-0 before:top-0 before:h-full before:w-1",
        RAG_ACCENT[rag],
      )}
    >
      <div className="space-y-3 px-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />}
            <h2 className="truncate text-sm font-bold uppercase tracking-wide text-foreground">{label}</h2>
            <RagBadge rag={rag} />
          </div>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Verdict */}
        <p className="text-sm leading-snug text-foreground">{calmText(headline)}</p>

        {/* KPI strip */}
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
            {kpis.slice(0, 5).map((k, i) => (
              <KpiTile key={`${k.label}-${i}`} kpi={k} />
            ))}
          </div>
        )}

        {/* Focus areas + wins */}
        {(focusAreas.length > 0 || wins.length > 0) && (
          <div className="grid gap-3 pt-1 md:grid-cols-2">
            {focusAreas.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Focus areas</p>
                <ul className="space-y-1">
                  {focusAreas.slice(0, 2).map((t, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
                      <span className="text-slate-400">▸</span>
                      <span className="min-w-0">{calmText(t)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {wins.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-emerald-600">Working well</p>
                <ul className="space-y-1">
                  {wins.slice(0, 2).map((t, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
                      <span className="text-emerald-400">▸</span>
                      <span className="min-w-0">{calmText(t)}</span>
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
