/**
 * Executive Summary — shared contract.
 *
 * Every department section on the Executive Summary page owns its own data
 * (reusing the exact hook + commentary engine its source dashboard uses) and
 * reports a normalized `DeptSummary` up to the page via `onSummary`. The page
 * aggregates these for the hero KPI strip and the CEO roll-up.
 *
 * This is the ONLY file the 7 section components share — keeping them otherwise
 * independent so they can be built/edited in parallel without contention.
 */

export type RAG = "GREEN" | "YELLOW" | "RED" | "NEUTRAL";

/** Normalize the various engine RAG strings ("green" | "GREEN" | "insufficient")
 *  into the canonical Executive-Summary RAG. */
export function normalizeRag(state: string | null | undefined): RAG {
  switch ((state ?? "").toLowerCase()) {
    case "green":
      return "GREEN";
    case "yellow":
      return "YELLOW";
    case "red":
      return "RED";
    default:
      return "NEUTRAL";
  }
}

/** Severity ordering — higher = more urgent. Used to rank departments. */
export const RAG_SEVERITY: Record<RAG, number> = {
  RED: 3,
  YELLOW: 2,
  GREEN: 1,
  NEUTRAL: 0,
};

/** Strip alarm emojis (🚨 🔴 🟡 🟢 ⚠️ 🔥 📈 …) and collapse whitespace, so the
 *  commentary engines' verdict/insight text reads calmly in the Executive
 *  Summary instead of shouting in red. Meaning is unchanged — colour is carried
 *  by the RAG badge, not by emoji. */
export function calmText(s: string): string {
  return s
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface DeptHeadlineKpi {
  label: string;
  /** Pre-formatted display string, e.g. "€1.2M", "18.4%", "4.6★". */
  value: string;
  /** Optional delta vs a baseline (YoY / PoP). Positive = up. */
  deltaPct?: number;
  /** Short label for the delta, e.g. "YoY", "PoP", "vs LY". */
  deltaLabel?: string;
  /** When true the delta is a percentage-point change (renders "pp" not "%"). */
  deltaIsPoints?: boolean;
  /** When true, a positive delta is BAD (e.g. cost, CPL) and renders red. */
  invertDelta?: boolean;
}

/** Normalized snapshot one department reports up to the Executive Summary page. */
export interface DeptSummary {
  /** Stable id, e.g. "sales", "finance". Used as the React key + roll-up id. */
  slug: string;
  /** Display name, e.g. "Sales". */
  label: string;
  /** Link into the full dashboard, e.g. "/sales". Date params are appended by the card. */
  path: string;
  /** Overall RAG state for the department this period. */
  rag: RAG;
  /** One-line verdict (the dashboard's existing commentary verdict). */
  headline: string;
  /** 3–5 headline KPIs. `kpis[0]` is treated as the department's hero KPI. */
  kpis: DeptHeadlineKpi[];
  /** Top focus areas (things needing attention) — plain strings. */
  focusAreas: string[];
  /** Top wins (things going well) — plain strings. */
  wins: string[];
  /** True while the underlying data is still loading. */
  loading: boolean;
}

export interface SectionProps {
  dateFrom: Date;
  dateTo: Date;
  /** Report this section's normalized summary up to the page. Call whenever
   *  the data (or loading state) changes — typically inside a useEffect. */
  onSummary: (summary: DeptSummary) => void;
}
