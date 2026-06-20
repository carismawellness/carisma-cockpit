"use client";

/**
 * CEO Verdict — the top card on the Executive Summary page. Renders the
 * deterministic roll-up of all department summaries: overall verdict, a
 * worst-first RAG ribbon, the cross-business priorities, and the top wins.
 *
 * Visual tone is intentionally calm — a neutral card (not an amber alarm), soft
 * dots, and measured language. The RAG meaning is still legible via the dots,
 * but the page reads as a briefing rather than a warning.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CeoRollup } from "@/lib/commentary/ceo-rollup";
import { calmText, type RAG } from "@/lib/types/executive-summary";

const DOT: Record<RAG, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-400",
  RED: "bg-rose-400",
  NEUTRAL: "bg-slate-400",
};

export function CeoVerdictCard({
  rollup,
  periodLabel,
}: {
  rollup: CeoRollup;
  periodLabel: string;
}) {
  return (
    <Card className="border-slate-200 bg-card shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span className={cn("h-2.5 w-2.5 rounded-full", DOT[rollup.overallRag])} />
          CEO Verdict
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cross-business roll-up of all dashboards for {periodLabel}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline verdict */}
        <p className="text-sm font-medium leading-snug text-foreground">{calmText(rollup.verdict)}</p>

        {/* Department RAG ribbon */}
        {rollup.departments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rollup.departments.map((d) => (
              <span
                key={d.slug}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200"
              >
                <span className={cn("h-2 w-2 rounded-full", DOT[d.rag])} />
                {d.label}
              </span>
            ))}
          </div>
        )}

        {/* Priorities + wins */}
        {(rollup.priorities.length > 0 || rollup.wins.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {rollup.priorities.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Where to focus
                </p>
                <ul className="space-y-1.5">
                  {rollup.priorities.map((p, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
                      <span className="text-slate-400">▸</span>
                      <span className="min-w-0">
                        <span className="font-semibold text-foreground">{p.dept}:</span> {calmText(p.text)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rollup.wins.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-600">
                  Working well
                </p>
                <ul className="space-y-1.5">
                  {rollup.wins.map((w, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
                      <span className="text-emerald-400">▸</span>
                      <span className="min-w-0">
                        <span className="font-semibold text-foreground">{w.dept}:</span> {calmText(w.text)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
