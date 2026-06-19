"use client";

import type { MktCommentaryResult, MktRagState } from "@/lib/commentary/marketing-engine";

interface Props {
  result: MktCommentaryResult;
  loading?: boolean;
}

function RagDot({ rag }: { rag: MktRagState }) {
  const cls =
    rag === "green" ? "bg-emerald-500" :
    rag === "yellow" ? "bg-amber-400" :
    "bg-rose-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${cls}`} />;
}

export function MktCommentaryPanel({ result, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
        <div className="h-4 w-2/3 rounded bg-muted mb-3" />
        <div className="h-3 w-full rounded bg-muted mb-2" />
        <div className="h-3 w-5/6 rounded bg-muted" />
      </div>
    );
  }

  if (!result.hasData) return null;

  const { overallRag, verdict, workingWell, focusAreas } = result;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/30">
        <RagDot rag={overallRag} />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary">
          Strategic Commentary
        </span>
      </div>

      {/* Verdict */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-sm font-medium text-foreground leading-relaxed">{verdict}</p>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Working well */}
        {workingWell.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 mb-3">
              ✅ Working well
            </p>
            <ul className="space-y-2">
              {workingWell.map((text, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-text-secondary leading-relaxed">
                  <span className="text-emerald-500 shrink-0 mt-0.5">•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Focus areas */}
        {focusAreas.length > 0 && (
          <div className="px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-3">
              🎯 Focus areas
            </p>
            <ul className="space-y-2">
              {focusAreas.map((text, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-text-secondary leading-relaxed">
                  <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
