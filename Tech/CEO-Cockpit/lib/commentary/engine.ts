/**
 * EBITDA Strategic Commentary Engine
 *
 * Pure computation module — no React, no side effects.
 * Reads from benchmarks.ts and returns structured commentary output
 * consumed by StrategicCommentary.tsx.
 *
 * Compatible with both ebitda-v2 (current period) and ebitda-longitudinal
 * (most recent full month) dashboards.
 */

import {
  EBITDA_COMMENTARY_CONFIG,
  MetricConfig,
  RagState,
  HR_METRIC_THRESHOLDS,
  HR_TEMPLATES,
  HR_FOCUS_PRIORITY,
  HR_WINS_PRIORITY,
  type HRThreshold,
} from "./benchmarks";

/* ── Public types ────────────────────────────────────────────────────────── */

export type { RagState, MetricConfig };

export interface MetricResult {
  key: string;
  label: string;
  rag: RagState;
  value: number;
  benchmark: number;
  deltaYoy?: number;
  text: string;
  priority: number;
}

export interface CommentaryOutput {
  overallRag: RagState;
  verdictText: string;
  wins: MetricResult[];       // green results, sorted by priority, max 3
  focusAreas: MetricResult[]; // red/yellow results, red first then yellow, max 3
  insufficientData: boolean;
}

/* ── Input shape ─────────────────────────────────────────────────────────── */

export interface PeriodData {
  revenue: number;
  wages: number;
  advertising: number;
  sga: number;
  cogs: number;
  rent: number;
  utilities: number;
  ebitda: number;
}

/* ── Internal helpers ────────────────────────────────────────────────────── */

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

function fillTemplate(
  template: string,
  value: number,
  benchmark: number
): string {
  return template
    .replace("{value}", fmt(value))
    .replace("{benchmark}", fmt(benchmark, 0));
}

function classifyRag(metric: MetricConfig, value: number): RagState {
  if (metric.direction === "higher_is_better") {
    if (value >= metric.greenMin) return "green";
    if (value >= metric.yellowMin) return "yellow";
    return "red";
  } else {
    // lower_is_better
    if (value <= metric.greenMin) return "green";
    if (value <= metric.yellowMin) return "yellow";
    return "red";
  }
}

function pickTemplate(metric: MetricConfig, rag: RagState): string {
  switch (rag) {
    case "green":  return metric.templateGreen;
    case "yellow": return metric.templateYellow;
    case "red":    return metric.templateRed;
  }
}

/* ── Metric value computation ────────────────────────────────────────────── */

interface RawMetricValues {
  ebitda_margin?: number;
  revenueYoy?: number;
  wages_pct?: number;
  marketing_pct?: number;
  sga_pct?: number;
  cogs_pct?: number;
  rent_util_pct?: number;
}

function computeMetricValues(
  current: PeriodData,
  prior: PeriodData | null
): RawMetricValues {
  const rev = current.revenue;
  const result: RawMetricValues = {};

  if (rev > 0) {
    result.ebitda_margin  = (current.ebitda     / rev) * 100;
    result.wages_pct      = (current.wages       / rev) * 100;
    result.marketing_pct  = (current.advertising / rev) * 100;
    result.sga_pct        = (current.sga         / rev) * 100;
    result.cogs_pct       = (current.cogs        / rev) * 100;
    result.rent_util_pct  = ((current.rent + current.utilities) / rev) * 100;
  }

  if (prior !== null && prior.revenue > 0) {
    result.revenueYoy = ((current.revenue - prior.revenue) / prior.revenue) * 100;
  }

  return result;
}

/* ── Verdict logic (encodes VERDICT_RULE from benchmarks.ts) ────────────── */
// RED  if ANY metric with priority <= 3 is red, OR if 2+ metrics are red total
// YELLOW if ANY metric with priority <= 2 is yellow, OR if 2+ metrics are yellow total
// GREEN otherwise

function computeOverallRag(results: MetricResult[]): RagState {
  const redResults = results.filter((r) => r.rag === "red");
  const yellowResults = results.filter((r) => r.rag === "yellow");

  const hasCriticalRed = redResults.some((r) => r.priority <= 3);
  const hasManyReds = redResults.length >= 2;
  if (hasCriticalRed || hasManyReds) return "red";

  const hasCriticalYellow = yellowResults.some((r) => r.priority <= 2);
  const hasManyYellows = yellowResults.length >= 2;
  if (hasCriticalYellow || hasManyYellows) return "yellow";

  return "green";
}

/* ── Verdict sentence ────────────────────────────────────────────────────── */

function buildVerdictText(
  overallRag: RagState,
  results: MetricResult[],
  ebitdaMargin: number | undefined
): string {
  const tone =
    overallRag === "green"
      ? "strong"
      : overallRag === "yellow"
      ? "steady"
      : "under pressure";

  const marginPart =
    ebitdaMargin !== undefined
      ? ` at ${fmt(ebitdaMargin)}%`
      : "";

  // Pick the top focus area or top win to anchor the sentence
  const focusAreas = results.filter((r) => r.rag !== "green").sort((a, b) => a.priority - b.priority);
  const wins = results.filter((r) => r.rag === "green").sort((a, b) => a.priority - b.priority);

  let tail = "";
  if (focusAreas.length > 0) {
    tail = ` — ${focusAreas[0].label} needs attention`;
  } else if (wins.length > 0) {
    tail = ` — ${wins[0].label} is a standout`;
  }

  return `Group EBITDA is ${tone}${marginPart}${tail}.`;
}

/* ── Main export ─────────────────────────────────────────────────────────── */

export function computeEbitdaCommentary(
  current: PeriodData,
  prior: PeriodData | null
): CommentaryOutput {
  // Insufficient data guard
  if (current.revenue === 0) {
    return {
      overallRag: "green",
      verdictText: "",
      wins: [],
      focusAreas: [],
      insufficientData: true,
    };
  }

  const rawValues = computeMetricValues(current, prior);
  const results: MetricResult[] = [];

  for (const metricCfg of EBITDA_COMMENTARY_CONFIG) {
    const value = rawValues[metricCfg.key as keyof RawMetricValues];

    // Skip metrics where data is unavailable (e.g. YoY when prior is null)
    if (value === undefined) continue;

    const rag = classifyRag(metricCfg, value);
    const template = pickTemplate(metricCfg, rag);
    const text = fillTemplate(template, value, metricCfg.benchmark);

    const result: MetricResult = {
      key: metricCfg.key,
      label: metricCfg.label,
      rag,
      value,
      benchmark: metricCfg.benchmark,
      text,
      priority: metricCfg.priority,
    };

    // Attach YoY delta if applicable
    if (metricCfg.key === "revenueYoy" && rawValues.revenueYoy !== undefined) {
      result.deltaYoy = rawValues.revenueYoy;
    }

    results.push(result);
  }

  // Insufficient data if fewer than 3 metrics were computable
  if (results.length < 3) {
    return {
      overallRag: "green",
      verdictText: "",
      wins: [],
      focusAreas: [],
      insufficientData: true,
    };
  }

  const overallRag = computeOverallRag(results);

  const wins = results
    .filter((r) => r.rag === "green")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const focusAreas = results
    .filter((r) => r.rag !== "green")
    .sort((a, b) => {
      // red before yellow, then by priority
      if (a.rag === "red" && b.rag !== "red") return -1;
      if (a.rag !== "red" && b.rag === "red") return 1;
      return a.priority - b.priority;
    })
    .slice(0, 3);

  const verdictText = buildVerdictText(overallRag, results, rawValues.ebitda_margin);

  return {
    overallRag,
    verdictText,
    wins,
    focusAreas,
    insufficientData: false,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   HR COMMENTARY ENGINE
   Pure function — no async, no side effects. Recomputes on every render.
   ══════════════════════════════════════════════════════════════════════════ */

export interface HRCommentaryInput {
  groupHcPct:             number | null;
  avgCostPerEmployee:     number | null;
  revenuePerEmployee:     number | null;
  revpahSpa:              number | null;
  revpahAesthetics:       number | null;
  revpahSlimming:         number | null;
  netMovement:            number | null;
  annualisedTurnoverRate: number | null;
  therapistRatioPct:      number | null;
  onTimePct:              number | null;
  avgActivityPct:         number | null;
}

export interface HRMetricResult {
  key:    string;
  label:  string;
  status: RagState;
  text:   string;
}

export interface HRCommentaryOutput {
  overallStatus: RagState;
  verdict:       string;
  wins:          HRMetricResult[];        // GREEN, max 3, ordered by priority
  focusAreas:    HRMetricResult[];        // RED first, then YELLOW, max 3
}

const HR_LABELS: Record<string, string> = {
  humanCapitalPct:    "Human Capital %",
  avgCostPerEmployee: "Avg Cost/Employee",
  revenuePerEmployee: "Revenue/Employee",
  revpahSpa:          "Spa RevPAH",
  revpahAesthetics:   "Aesthetics RevPAH",
  revpahSlimming:     "Slimming RevPAH",
  netMovement:        "Net Movement",
  turnoverRate:       "Turnover Rate",
  therapistRatio:     "Therapist Ratio",
  onTimePct:          "On-Time %",
  avgActivityPct:     "Team Activity",
};

const HR_KEY_MAP: Record<keyof HRCommentaryInput, string> = {
  groupHcPct:             "humanCapitalPct",
  avgCostPerEmployee:     "avgCostPerEmployee",
  revenuePerEmployee:     "revenuePerEmployee",
  revpahSpa:              "revpahSpa",
  revpahAesthetics:       "revpahAesthetics",
  revpahSlimming:         "revpahSlimming",
  netMovement:            "netMovement",
  annualisedTurnoverRate: "turnoverRate",
  therapistRatioPct:      "therapistRatio",
  onTimePct:              "onTimePct",
  avgActivityPct:         "avgActivityPct",
};

function fmtHR(n: number, unit: HRThreshold["unit"]): string {
  if (unit === "eur")   return `€${Math.round(n).toLocaleString("en-GB")}`;
  if (unit === "pct")   return `${Math.round(n)}%`;
  if (unit === "hrs")   return `${n.toFixed(1)} hrs`;
  if (n >= 0)           return `+${Math.round(n)}`;
  return String(Math.round(n));
}

function fillHRTemplate(template: string, val: number, t: HRThreshold): string {
  const delta = Math.abs(val - t.benchmark);
  return template
    .replace(/\{\{VAL\}\}/g,       fmtHR(val,          t.unit))
    .replace(/\{\{BENCHMARK\}\}/g, fmtHR(t.benchmark,  t.unit))
    .replace(/\{\{TARGET\}\}/g,    fmtHR(t.benchmark,  t.unit))
    .replace(/\{\{DELTA\}\}/g,     fmtHR(delta,        t.unit));
}

function evalHRMetric(key: string, value: number | null): HRMetricResult | null {
  if (value === null || isNaN(value)) return null;
  const t = HR_METRIC_THRESHOLDS[key];
  if (!t) return null;
  const tmpl = HR_TEMPLATES[key];
  if (!tmpl) return null;

  let status: RagState;
  const { direction, green, greenMax, yellow, yellowMax } = t;

  if (direction === "higher_better") {
    status = value >= green ? "green" : value >= yellow ? "yellow" : "red";
  } else if (direction === "lower_better") {
    status = value <= green ? "green" : value <= yellow ? "yellow" : "red";
  } else {
    const inGreen = value >= green && (greenMax == null || value <= greenMax);
    if (inGreen) {
      status = "green";
    } else {
      const yMax = yellowMax ?? (greenMax != null ? greenMax * 1.1 : green * 1.3);
      const inYellow =
        (value >= yellow && value < green) ||
        (greenMax != null && value > greenMax && value <= yMax);
      status = inYellow ? "yellow" : "red";
    }
  }

  return {
    key,
    label:  HR_LABELS[key] ?? key,
    status,
    text:   fillHRTemplate(tmpl[status] ?? "", value, t),
  };
}

export function computeHRCommentary(input: HRCommentaryInput): HRCommentaryOutput {
  const results: HRMetricResult[] = [];
  for (const [inputKey, threshKey] of Object.entries(HR_KEY_MAP)) {
    const value = input[inputKey as keyof HRCommentaryInput];
    const result = evalHRMetric(threshKey, value);
    if (result) results.push(result);
  }

  const hasRed    = results.some((r) => r.status === "red");
  const hasYellow = results.some((r) => r.status === "yellow");
  const overall: RagState = hasRed ? "red" : hasYellow ? "yellow" : "green";

  const byKey = new Map(results.map((r) => [r.key, r]));

  const wins = HR_WINS_PRIORITY
    .filter((k) => byKey.get(k)?.status === "green")
    .slice(0, 3)
    .map((k) => byKey.get(k)!);

  const focusAreas = HR_FOCUS_PRIORITY
    .filter((k) => {
      const s = byKey.get(k)?.status;
      return s === "red" || s === "yellow";
    })
    .map((k) => byKey.get(k)!)
    .sort((a, b) => {
      if (a.status === "red" && b.status !== "red") return -1;
      if (b.status === "red" && a.status !== "red") return 1;
      return 0;
    })
    .slice(0, 3);

  const redCount    = results.filter((r) => r.status === "red").length;
  const yellowCount = results.filter((r) => r.status === "yellow").length;
  const greenCount  = results.filter((r) => r.status === "green").length;
  const total       = results.length;
  const emoji       = overall === "green" ? "🟢" : overall === "yellow" ? "🟡" : "🔴";

  let verdict: string;
  if (overall === "green") {
    verdict = `${emoji} Workforce metrics are on track — ${greenCount} of ${total} indicators at or above target with no critical flags.`;
  } else if (overall === "yellow") {
    verdict = `${emoji} Workforce performance needs attention — ${yellowCount} indicator${yellowCount !== 1 ? "s" : ""} below target${redCount > 0 ? `, ${redCount} in critical range` : ""}.`;
  } else {
    verdict = `${emoji} Critical workforce issues detected — ${redCount} metric${redCount !== 1 ? "s" : ""} require immediate action${yellowCount > 0 ? `; ${yellowCount} additional area${yellowCount !== 1 ? "s" : ""} need monitoring` : ""}.`;
  }

  return { overallStatus: overall, verdict, wins, focusAreas };
}
