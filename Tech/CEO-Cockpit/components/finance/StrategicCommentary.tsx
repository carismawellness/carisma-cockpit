"use client";

import { useMemo } from "react";
import {
  computeEbitdaCommentary,
  CommentaryOutput,
  MetricResult,
  RagState,
} from "@/lib/commentary/engine";

/* ── Types ────────────────────────────────────────────────────────────────── */

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

/* ── RAG dot ─────────────────────────────────────────────────────────────── */

function RagDot({ rag, size = "sm" }: { rag: RagState; size?: "sm" | "md" }) {
  const sizeClass = size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";
  const colorClass =
    rag === "green"
      ? "bg-emerald-500"
      : rag === "yellow"
      ? "bg-amber-400"
      : "bg-red-500";
  return (
    <span
      className={`inline-block rounded-full flex-shrink-0 ${sizeClass} ${colorClass}`}
      aria-hidden="true"
    />
  );
}

/* ── Metric row ──────────────────────────────────────────────────────────── */

function MetricRow({ result }: { result: MetricResult }) {
  const prefix =
    result.rag === "red" ? (
      <RagDot rag="red" />
    ) : result.rag === "yellow" ? (
      <RagDot rag="yellow" />
    ) : (
      <RagDot rag="green" />
    );

  return (
    <li className="flex items-start gap-2 text-sm leading-snug">
      <span className="mt-[3px]">{prefix}</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{result.label}:</span>{" "}
        {result.text}
      </span>
    </li>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */

function Skeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
      <div className="h-3 w-5/6 rounded bg-muted" />
      <div className="h-3 w-2/3 rounded bg-muted" />
      <div className="h-3 w-4/5 rounded bg-muted" />
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

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
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Insufficient data for this period.
        </p>
      </div>
    );
  }

  const { overallRag, verdictText, wins, focusAreas } = commentary;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* ── Verdict ── */}
      <div className="flex items-center gap-2">
        <RagDot rag={overallRag} size="md" />
        <p className="text-sm font-semibold leading-snug">{verdictText}</p>
      </div>

      {/* ── Focus areas (red/yellow first) ── */}
      {focusAreas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Focus areas
          </p>
          <ul className="space-y-1.5">
            {focusAreas.map((r) => (
              <MetricRow key={r.key} result={r} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Working well (green) ── */}
      {wins.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Working well
          </p>
          <ul className="space-y-1.5">
            {wins.map((r) => (
              <MetricRow key={r.key} result={r} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
