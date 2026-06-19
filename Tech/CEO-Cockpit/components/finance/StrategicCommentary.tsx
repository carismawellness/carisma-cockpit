"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeEbitdaCommentary,
  CommentaryOutput,
  MetricResult,
  RagState,
} from "@/lib/commentary/engine";

interface VenueData {
  revenue: number;
  wages: number;
  advertising: number;
  sga: number;
  cogs: number;
  rent: number;
  utilities: number;
  ebitda: number;
}

interface StrategicCommentaryProps {
  current: VenueData | null;
  prior: VenueData | null;
  loading: boolean;
}

function ragEmoji(rag: RagState): string {
  if (rag === "green") return "✅";
  if (rag === "yellow") return "🟡";
  return "🔴";
}

function Skeleton() {
  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-amber-200 rounded w-40" />
          <div className="h-3 bg-amber-100 rounded w-full" />
          <div className="h-3 bg-amber-100 rounded w-4/5" />
        </div>
      </CardHeader>
    </Card>
  );
}

export function StrategicCommentary({
  current,
  prior,
  loading,
}: StrategicCommentaryProps) {
  const commentary: CommentaryOutput | null = useMemo(() => {
    if (!current) return null;
    return computeEbitdaCommentary(current, prior);
  }, [current, prior]);

  if (loading) return <Skeleton />;

  if (!commentary || commentary.insufficientData) {
    return (
      <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900">
            Strategic Summary
          </CardTitle>
          <p className="text-xs text-amber-700 mt-0.5">
            Not enough data for this period.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const { overallRag, verdictText, wins, focusAreas } = commentary;

  const topItems = [
    ...focusAreas.slice(0, 3),
    ...wins.slice(0, Math.max(0, 3 - focusAreas.length)),
  ];

  return (
    <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">
          Strategic Summary
        </CardTitle>
        <p className="text-xs text-amber-700 mt-0.5">
          {ragEmoji(overallRag)} {verdictText}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-2.5">
          {topItems.map((r) => (
            <li key={r.key} className="text-sm leading-snug text-amber-900">
              {ragEmoji(r.rag)}{" "}
              <span className="font-medium">{r.label}:</span> {r.text}
            </li>
          ))}
          {focusAreas.length === 0 && wins.length > 3 && (
            wins.slice(3).map((r) => (
              <li key={r.key} className="text-sm leading-snug text-amber-900">
                ✅ <span className="font-medium">{r.label}:</span> {r.text}
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
