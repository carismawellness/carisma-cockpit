"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { useGscRankings, type GscKeywordRow } from "@/lib/hooks/useGscRankings";
import type { BrandSlug } from "@/lib/types/ads";

interface Props {
  brand: BrandSlug;
  brandColor?: string;
  /** Defaults to 28 days (matches GSC default reporting window). */
  defaultDays?: number;
}

function fmtPosition(p: number | null): string {
  if (p === null) return "—";
  return p.toFixed(1);
}

function positionBadge(pos: number | null): { color: string; bg: string; label: string } {
  if (pos === null) return { color: "text-gray-500", bg: "bg-gray-100", label: "n/a" };
  if (pos <= 3) return { color: "text-emerald-700", bg: "bg-emerald-50", label: "Top 3" };
  if (pos <= 10) return { color: "text-blue-700", bg: "bg-blue-50", label: "Page 1" };
  if (pos <= 20) return { color: "text-amber-700", bg: "bg-amber-50", label: "Page 2" };
  return { color: "text-gray-600", bg: "bg-gray-100", label: `p${Math.ceil(pos / 10)}` };
}

function changeBadge(change: number | null) {
  if (change === null) return <span className="text-gray-400 text-xs">—</span>;
  if (Math.abs(change) < 0.1) return <span className="text-gray-500 text-xs">no change</span>;
  // Lower position = better; positive change means improved
  if (change > 0)
    return (
      <span className="text-emerald-600 text-xs font-medium">
        ▲ {change.toFixed(1)}
      </span>
    );
  return (
    <span className="text-red-600 text-xs font-medium">
      ▼ {Math.abs(change).toFixed(1)}
    </span>
  );
}

function fmtCtr(c: number | null) {
  if (c === null) return "—";
  return `${(c * 100).toFixed(1)}%`;
}

export function KeywordRankingsTable({ brand, brandColor, defaultDays = 28 }: Props) {
  const [days, setDays] = useState(defaultDays);
  const { keywords, window: w, loading, error } = useGscRankings({ brand, days });

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
        <div className="h-9 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-gray-500 italic">
        Could not load Search Console rankings: {error}
      </p>
    );
  }

  // Sort: tracked keywords with data first (by impressions desc), then those without
  const sorted = [...keywords].sort((a, b) => {
    if (a.impressions === 0 && b.impressions > 0) return 1;
    if (a.impressions > 0 && b.impressions === 0) return -1;
    return b.impressions - a.impressions;
  });

  const noData = keywords.every((k) => k.impressions === 0);

  return (
    <div>
      {/* Window selector */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs text-gray-500">
          {w ? `${w.startDate} → ${w.endDate} (${w.days} days)` : ""}
        </div>
        <div className="inline-flex rounded-md border border-gray-200 bg-white text-xs overflow-hidden">
          {[7, 28, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={
                "px-3 py-1.5 transition-colors " +
                (days === d
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50")
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {noData ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium text-gray-600">
            No Search Console data for this period yet.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            The ETL syncs nightly. If this is a new deployment, trigger{" "}
            <code className="bg-gray-100 px-1 rounded">/api/etl/gsc-sync</code> manually.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto -mx-3 md:mx-0">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Keyword</th>
                <th className="px-3 py-2 text-right font-medium">Position</th>
                <th className="px-3 py-2 text-right font-medium">Δ vs prev</th>
                <th className="px-3 py-2 text-right font-medium">Impressions</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((k: GscKeywordRow) => {
                const badge = positionBadge(k.position);
                return (
                  <tr key={k.keyword} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900 truncate max-w-[280px]">
                      {k.keyword}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 ${badge.color}`}
                      >
                        <span
                          className={`inline-block rounded-full ${badge.bg} px-2 py-0.5 text-[10px] font-medium`}
                        >
                          {badge.label}
                        </span>
                        <span
                          className="tabular-nums font-semibold"
                          style={{ color: brandColor }}
                        >
                          {fmtPosition(k.position)}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {changeBadge(k.positionChange)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {k.impressions.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {k.clicks.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {fmtCtr(k.ctr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
