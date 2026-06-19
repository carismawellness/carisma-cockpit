"use client";

/**
 * CEO Verdict — the top card on the Executive Summary page. Renders the
 * deterministic roll-up of all department summaries: overall verdict, a
 * worst-first RAG ribbon, the cross-business priorities, and the top wins.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { CeoRollup } from "@/lib/commentary/ceo-rollup";
import type { RAG } from "@/lib/types/executive-summary";

const DOT: Record<RAG, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-red-500",
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
    <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">CEO Verdict</CardTitle>
        <p className="mt-0.5 text-xs text-amber-700">
          Cross-business roll-up of all dashboards for {periodLabel}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline verdict */}
        <p className="text-sm font-medium leading-snug text-amber-900">{rollup.verdict}</p>

        {/* Department RAG ribbon */}
        {rollup.departments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rollup.departments.map((d) => (
              <span
                key={d.slug}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200"
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
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                  Top priorities
                </p>
                <ul className="space-y-1.5">
                  {rollup.priorities.map((p, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-amber-900">
                      <span className="text-red-500">▸</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{p.dept}:</span> {p.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rollup.wins.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Wins to protect
                </p>
                <ul className="space-y-1.5">
                  {rollup.wins.map((w, i) => (
                    <li key={i} className="flex gap-1.5 text-xs leading-snug text-amber-900">
                      <span className="text-emerald-500">▸</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{w.dept}:</span> {w.text}
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
