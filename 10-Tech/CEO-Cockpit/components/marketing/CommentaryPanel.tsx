"use client";

import type { MktCommentaryResult } from "@/lib/commentary/marketing-engine";

interface Props {
  result: MktCommentaryResult;
  loading?: boolean;
  title?: string;
}

export function MktCommentaryPanel({ result, loading, title = "Marketing Snapshot" }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-4 md:p-5 animate-pulse">
        <div className="h-4 w-48 rounded bg-amber-200/60 mb-2" />
        <div className="h-3 w-full rounded bg-amber-200/40 mb-1.5" />
        <div className="h-3 w-5/6 rounded bg-amber-200/40" />
      </div>
    );
  }

  if (!result.hasData) return null;

  const { verdict, workingWell, focusAreas } = result;

  return (
    <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 shadow-sm">
      <div className="p-4 md:p-5">
        <p className="text-base font-semibold text-amber-900 mb-0.5">{title}</p>
        <p className="text-sm text-amber-700 mb-3 leading-snug">{verdict}</p>

        {(workingWell.length > 0 || focusAreas.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-amber-200">
            {workingWell.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  ✅ Working well
                </p>
                <ul className="space-y-2">
                  {workingWell.map((text, i) => (
                    <li key={i} className="text-sm leading-snug text-amber-900">
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {focusAreas.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 mb-2">
                  🎯 Focus areas
                </p>
                <ul className="space-y-2">
                  {focusAreas.map((text, i) => (
                    <li key={i} className="text-sm leading-snug text-amber-900">
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
