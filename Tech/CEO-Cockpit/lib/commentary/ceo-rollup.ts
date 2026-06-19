/**
 * CEO roll-up — deterministic synthesis of all 7 department summaries into a
 * single top-level verdict for the Executive Summary page. No LLM; pure rules,
 * consistent with the existing commentary engine style.
 */

import {
  type DeptSummary,
  type RAG,
  RAG_SEVERITY,
} from "@/lib/types/executive-summary";

export interface CeoRollup {
  /** Worst-case overall state across all reporting departments. */
  overallRag: RAG;
  /** One-line headline verdict for the whole business this period. */
  verdict: string;
  /** Highest-priority focus areas pulled from across all departments (≤3),
   *  each tagged with the department it came from. */
  priorities: { dept: string; text: string }[];
  /** Top wins across the business (≤3), each tagged with its department. */
  wins: { dept: string; text: string }[];
  /** Per-department RAG, ordered worst-first — drives the at-a-glance ribbon. */
  departments: { slug: string; label: string; rag: RAG }[];
  /** True until at least one department has reported real (non-loading) data. */
  loading: boolean;
}

function ragEmoji(rag: RAG): string {
  return rag === "GREEN" ? "🟢" : rag === "YELLOW" ? "🟡" : rag === "RED" ? "🔴" : "⚪";
}

/** Worst (highest-severity) RAG across the provided list. */
function worstRag(rags: RAG[]): RAG {
  if (rags.length === 0) return "NEUTRAL";
  return rags.reduce((worst, r) =>
    RAG_SEVERITY[r] > RAG_SEVERITY[worst] ? r : worst, "NEUTRAL" as RAG);
}

export function computeCeoRollup(summaries: DeptSummary[]): CeoRollup {
  // Only departments that have actually reported count toward the verdict.
  const reported = summaries.filter((s) => s.rag !== undefined);
  const ready = reported.filter((s) => !s.loading);

  // Order every department worst-first for the ribbon.
  const departments = [...reported]
    .sort((a, b) => RAG_SEVERITY[b.rag] - RAG_SEVERITY[a.rag])
    .map((s) => ({ slug: s.slug, label: s.label, rag: s.rag }));

  if (ready.length === 0) {
    return {
      overallRag: "NEUTRAL",
      verdict: "Compiling the executive summary across all dashboards…",
      priorities: [],
      wins: [],
      departments,
      loading: true,
    };
  }

  const overallRag = worstRag(ready.map((s) => s.rag));

  // Priorities: red departments first, then yellow. Take each department's
  // single top focus area so no one dashboard dominates the list.
  const bySeverity = [...ready].sort(
    (a, b) => RAG_SEVERITY[b.rag] - RAG_SEVERITY[a.rag],
  );
  const priorities = bySeverity
    .filter((s) => (s.rag === "RED" || s.rag === "YELLOW") && s.focusAreas.length > 0)
    .map((s) => ({ dept: s.label, text: s.focusAreas[0] }))
    .slice(0, 3);

  // Wins: prefer green departments, then anyone reporting a win.
  const wins = [...ready]
    .sort((a, b) => RAG_SEVERITY[a.rag] - RAG_SEVERITY[b.rag])
    .filter((s) => s.wins.length > 0)
    .map((s) => ({ dept: s.label, text: s.wins[0] }))
    .slice(0, 3);

  const reds = ready.filter((s) => s.rag === "RED").map((s) => s.label);
  const yellows = ready.filter((s) => s.rag === "YELLOW").map((s) => s.label);
  const greens = ready.filter((s) => s.rag === "GREEN").map((s) => s.label);
  const emoji = ragEmoji(overallRag);

  const list = (xs: string[]) =>
    xs.length === 0
      ? ""
      : xs.length === 1
        ? xs[0]
        : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

  let verdict: string;
  if (overallRag === "GREEN") {
    verdict = `${emoji} Business healthy this period — ${greens.length} of ${ready.length} dashboards at or above target with no critical flags. ${list(greens)} are performing well.`;
  } else if (overallRag === "YELLOW") {
    verdict = `${emoji} Business broadly on track, with watch-items — ${list(yellows)} ${yellows.length === 1 ? "needs" : "need"} attention${greens.length ? `, while ${list(greens)} ${greens.length === 1 ? "is" : "are"} on target` : ""}. Address the priorities below before they escalate.`;
  } else {
    verdict = `${emoji} Action required this period — ${list(reds)} ${reds.length === 1 ? "is" : "are"} in the red${yellows.length ? `; ${list(yellows)} also need monitoring` : ""}. Start with the priorities below.`;
  }

  return {
    overallRag,
    verdict,
    priorities,
    wins,
    departments,
    loading: false,
  };
}
