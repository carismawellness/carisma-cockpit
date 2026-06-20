"use client";

/**
 * HeroKpiStrip — a compact ribbon of one headline KPI per department (each
 * department's `kpis[0]`), with a RAG dot. Sits under the CEO verdict so the
 * single most important number from every dashboard is visible at a glance.
 */

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DeptSummary, RAG } from "@/lib/types/executive-summary";

const DOT: Record<RAG, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-400",
  RED: "bg-rose-400",
  NEUTRAL: "bg-slate-400",
};

/** Department display order for the strip (matches the section order below). */
const ORDER = ["sales", "finance", "marketing", "crm", "funnel", "operations", "hr"];

export function HeroKpiStrip({ summaries }: { summaries: Record<string, DeptSummary> }) {
  const items = ORDER.map((slug) => summaries[slug]).filter(Boolean) as DeptSummary[];

  if (items.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        {ORDER.map((slug) => (
          <Card key={slug} className="h-[4.75rem] animate-pulse px-3 py-2">
            <div className="h-2 w-2/3 rounded bg-muted" />
            <div className="mt-2 h-4 w-1/2 rounded bg-muted/60" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
      {items.map((s) => {
        const kpi = s.kpis[0];
        const hasDelta = kpi?.deltaPct !== undefined && isFinite(kpi.deltaPct);
        const up = hasDelta && (kpi!.deltaPct as number) >= 0;
        const good = hasDelta ? (kpi!.invertDelta ? !up : up) : true;
        const Arrow = up ? ArrowUpRight : ArrowDownRight;
        return (
          <Card key={s.slug} className="px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[s.rag])} />
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
            </div>
            <p className="mt-1 truncate text-lg font-bold leading-tight text-foreground">
              {s.loading ? "—" : (kpi?.value ?? "—")}
            </p>
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-[10px] text-muted-foreground">{kpi?.label ?? ""}</p>
              {!s.loading && hasDelta && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center text-[10px] font-semibold",
                    good ? "text-emerald-600" : "text-rose-500",
                  )}
                >
                  <Arrow className="h-2.5 w-2.5" />
                  {up ? "+" : ""}
                  {(kpi!.deltaPct as number).toFixed(0)}
                  {kpi!.deltaIsPoints ? "pp" : "%"}
                </span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
