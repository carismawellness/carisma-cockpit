"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmAgent, useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { GhlSnapshot } from "@/lib/hooks/useGhlSnapshot";
import {
  RAGState,
  MetricResult,
  CommentaryResult,
  computeTeamCommentary,
  computeAgentCommentary,
  computeCrmMasterCommentary,
} from "@/lib/commentary/engine";

// ── RAG helpers ───────────────────────────────────────────────────────────────

const RAG_COLORS: Record<RAGState, string> = {
  green:       "#10b981",   // emerald-500
  yellow:      "#f59e0b",   // amber-500
  red:         "#ef4444",   // red-500
  insufficient: "#6b7280",  // gray-500
};

const RAG_BG_CLASS: Record<RAGState, string> = {
  green:        "bg-emerald-50 border-emerald-200",
  yellow:       "bg-amber-50 border-amber-200",
  red:          "bg-red-50 border-red-200",
  insufficient: "bg-gray-50 border-gray-200",
};

const RAG_TEXT_CLASS: Record<RAGState, string> = {
  green:        "text-emerald-800",
  yellow:       "text-amber-800",
  red:          "text-red-800",
  insufficient: "text-gray-600",
};

function ragDot(state: RAGState): string {
  switch (state) {
    case "green":        return "🟢";
    case "yellow":       return "🟡";
    case "red":          return "🔴";
    case "insufficient": return "⚪";
  }
}

function overallRagDot(state: RAGState): string {
  switch (state) {
    case "green":        return "✅";
    case "yellow":       return "⚠️";
    case "red":          return "🚨";
    case "insufficient": return "ℹ️";
  }
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function CommentarySkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="h-4 w-40 bg-gray-200 rounded" />
      <div className="h-3 w-full bg-gray-100 rounded" />
      <div className="h-3 w-5/6 bg-gray-100 rounded" />
      <div className="h-3 w-4/6 bg-gray-100 rounded" />
    </div>
  );
}

// ── Shared panel renderer ─────────────────────────────────────────────────────

function CommentaryPanel({
  result,
  dateRangeLabel,
  title = "Strategic Commentary",
}: {
  result: CommentaryResult;
  dateRangeLabel: string;
  title?: string;
}) {
  const borderColor = RAG_COLORS[result.overallRag];

  if (result.insufficient) {
    return (
      <Card
        className={`border-l-4 ${RAG_BG_CLASS[result.overallRag]} border ${
          result.overallRag === "insufficient" ? "border-gray-200" : ""
        }`}
        style={{ borderLeftColor: borderColor }}
      >
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            ℹ️ {result.verdict}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-l-4 bg-white"
      style={{ borderLeftColor: borderColor }}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <span>{overallRagDot(result.overallRag)}</span>
          <span>{title}</span>
          <span className="text-xs font-normal normal-case text-muted-foreground/70">
            {dateRangeLabel}
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 pb-4">
        {/* Verdict */}
        <p className={`text-sm font-semibold ${RAG_TEXT_CLASS[result.overallRag]}`}>
          {result.verdict}
        </p>

        {/* Focus Areas */}
        {result.focusAreas.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              🎯 Focus Areas
            </p>
            <ul className="space-y-1.5">
              {result.focusAreas.map((m) => (
                <li key={m.key} className="text-xs flex gap-2 items-start">
                  <span className="shrink-0 mt-0.5">{ragDot(m.ragState)}</span>
                  <span className="text-foreground leading-relaxed">{m.template}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Wins */}
        {result.wins.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
              ✅ Working well
            </p>
            <ul className="space-y-1.5">
              {result.wins.map((m) => (
                <li key={m.key} className="text-xs flex gap-2 items-start">
                  <span className="shrink-0 mt-0.5">🟢</span>
                  <span className="text-foreground leading-relaxed">{m.template}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Utility: date range label ─────────────────────────────────────────────────

function dateRangeLabel(from: Date, to: Date): string {
  return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
}

// ── Team commentary component ─────────────────────────────────────────────────

interface TeamCommentaryProps {
  agents: CrmAgent[];
  dateFrom: Date;
  dateTo: Date;
}

export function TeamCrmCommentary({ agents, dateFrom, dateTo }: TeamCommentaryProps) {
  // Compute prior period dates
  const periodMs = dateTo.getTime() - dateFrom.getTime() + 86_400_000;
  const priorTo  = new Date(dateFrom.getTime() - 86_400_000);
  const priorFrom = new Date(priorTo.getTime() - periodMs + 86_400_000);

  const { agents: priorAgents, isLoading: priorLoading } = useCrmAgents(priorFrom, priorTo);

  const periodDays = Math.max(
    1,
    Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1
  );

  const result = useMemo(
    () => computeTeamCommentary(agents, priorAgents, periodDays),
    [agents, priorAgents, periodDays]
  );

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4 text-sm text-muted-foreground">
        ℹ️ Insufficient data — run the ETL sync first.
      </div>
    );
  }

  if (priorLoading) {
    return <CommentarySkeleton />;
  }

  return (
    <CommentaryPanel
      result={result}
      dateRangeLabel={dateRangeLabel(dateFrom, dateTo)}
    />
  );
}

// ── Individual agent commentary component ─────────────────────────────────────

interface AgentCommentaryProps {
  agent: CrmAgent | undefined;
  dateFrom: Date;
  dateTo: Date;
}

export function AgentCrmCommentary({ agent, dateFrom, dateTo }: AgentCommentaryProps) {
  const periodMs  = dateTo.getTime() - dateFrom.getTime() + 86_400_000;
  const priorTo   = new Date(dateFrom.getTime() - 86_400_000);
  const priorFrom = new Date(priorTo.getTime() - periodMs + 86_400_000);

  const { agents: priorAgents, isLoading: priorLoading } = useCrmAgents(priorFrom, priorTo);

  const periodDays = Math.max(
    1,
    Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1
  );

  const priorAgent = agent
    ? (priorAgents.find((a) => a.slug === agent.slug) ?? null)
    : null;

  const result = useMemo(() => {
    if (!agent) return null;
    return computeAgentCommentary(agent, priorAgent, periodDays);
  }, [agent, priorAgent, periodDays]);

  if (!agent) return null;

  if (priorLoading) {
    return <CommentarySkeleton />;
  }

  if (!result) return null;

  return (
    <CommentaryPanel
      result={result}
      dateRangeLabel={dateRangeLabel(dateFrom, dateTo)}
      title={`${agent.name} — Strategic Commentary`}
    />
  );
}

// ── CRM Master commentary component ──────────────────────────────────────────

interface CrmMasterCommentaryProps {
  snapshot: GhlSnapshot;
}

export function CrmMasterCommentary({ snapshot }: CrmMasterCommentaryProps) {
  const result = useMemo(
    () => computeCrmMasterCommentary(snapshot),
    [snapshot]
  );

  return (
    <CommentaryPanel
      result={result}
      dateRangeLabel="Live · Now"
      title="GHL Queue Commentary"
    />
  );
}
