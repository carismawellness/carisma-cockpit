"use client";

/**
 * Sales Strategic Commentary — executive verdict panel for every Sales
 * dashboard (Group, Spa, Aesthetics, Slimming).
 *
 * UI-only: takes a SalesCommentaryResult from `computeSalesCommentary` and
 * renders the standard verdict + Working-well / Focus-areas layout used by
 * the other Cockpit commentary surfaces (Operations, HR, EBITDA).
 *
 * No data fetching, no benchmark logic — the engine is the single source of
 * truth. Pure presentational.
 */

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SalesCommentaryResult } from "@/lib/commentary/engine";

interface Props {
  result:  SalesCommentaryResult;
  loading?: boolean;
}

export function SalesStrategicCommentary({ result, loading = false }: Props) {
  if (loading) {
    return (
      <Card className="p-4 space-y-3 animate-pulse">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </Card>
    );
  }

  const borderColor =
    result.overallState === "green"  ? "#22C55E" :
    result.overallState === "yellow" ? "#F59E0B" :
                                       "#EF4444";

  const badgeCls =
    result.overallState === "green"
      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : result.overallState === "yellow"
      ? "bg-amber-50 text-amber-700 border border-amber-200"
      : "bg-red-50 text-red-700 border border-red-200";

  const badgeLabel =
    result.overallState === "green"  ? "🟢 On Track" :
    result.overallState === "yellow" ? "🟡 Watch"    :
                                       "🔴 Action Required";

  if (result.insufficientData) {
    return (
      <Card className="p-4" style={{ borderLeft: `4px solid #94A3B8` }}>
        <p className="text-sm text-muted-foreground">{result.verdict}</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-5" style={{ borderLeft: `4px solid ${borderColor}` }}>
      {/* Header row */}
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0", badgeCls)}>
          {badgeLabel}
        </span>
        <p className="text-sm font-semibold text-foreground leading-snug">{result.verdict}</p>
      </div>

      {(result.wins.length > 0 || result.focusAreas.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-border/50">
          {/* Focus areas — surface first because reds need attention */}
          {result.focusAreas.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-2.5">
                🎯 Focus areas
              </p>
              <ul className="space-y-2.5">
                {result.focusAreas.map((f) => (
                  <li key={f.key} className="flex gap-2 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 leading-none",
                        f.state === "red" ? "text-red-500" : "text-amber-500",
                      )}
                    >
                      •
                    </span>
                    <span className="text-foreground leading-snug">
                      <span className="font-medium">{f.label}:</span> {f.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Wins */}
          {result.wins.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2.5">
                ✅ Working well
              </p>
              <ul className="space-y-2.5">
                {result.wins.map((w) => (
                  <li key={w.key} className="flex gap-2 text-sm">
                    <span className="text-emerald-500 mt-0.5 shrink-0 leading-none">•</span>
                    <span className="text-foreground leading-snug">
                      <span className="font-medium">{w.label}:</span> {w.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
