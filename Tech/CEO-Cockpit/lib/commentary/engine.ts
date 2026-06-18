/**
 * Strategic Commentary Engine — Operations Dashboard
 *
 * Pure computation — no React, no side effects, no async.
 * Exports: computeOpsCommentary(inputs) → OpsCommentaryResult
 *
 * Also re-exports the EBITDA & HR engines for backwards-compatibility
 * with StrategicCommentary.tsx and the HR dashboard.
 */

import {
  RAGState,
  TrendState,
  OPS_RAG_THRESHOLDS,
  OPS_FACILITY_TREND_THRESHOLDS,
  OPS_MYSTERY_TREND_THRESHOLDS,
  OPS_TEMPLATES,
  OPS_TREND_TEMPLATES,
  OPS_ANOMALY_TEMPLATE_CALIBRATION_GAP,
  OPS_FOCUS_PRIORITY,
  OPS_WINS_PRIORITY,
  EBITDA_COMMENTARY_CONFIG,
  MetricConfig,
  RagState,
  HR_METRIC_THRESHOLDS,
  HR_TEMPLATES,
  HR_FOCUS_PRIORITY,
  HR_WINS_PRIORITY,
  type HRThreshold,
} from "./benchmarks";

export type { RAGState, TrendState, RagState, MetricConfig };

/* ══════════════════════════════════════════════════════════════════════════
   OPS COMMENTARY ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

export interface OpsCommentaryInputs {
  weightedAvg:              number;
  ratingDelta:              number | null;
  totalReviews:             number;
  criticalCount:            number;
  noteworthyCount:          number;
  lowestRatedLocation:      { name: string; rating: number } | null;
  complimentaryPct:         number;
  cashPct:                  number;
  discountedCashPct:        number;
  delCancelledPct:          number;
  unattended:               number;
  avgFacility:              number;
  lowestFacilityLocation:   { name: string; score: number } | null;
  facilityTrend:            TrendState;
  facilityTrendDelta:       number;
  avgMystery:               number;
  lowestMysteryLocation:    { name: string; score: number } | null;
  mysteryTrend:             TrendState;
  mysteryTrendDelta:        number;
  hasEnoughData:            boolean;
  periodLabel:              string;
}

export interface CommentaryInsight {
  metricKey: string;
  label:     string;
  state:     RAGState;
  text:      string;
}

export interface OpsCommentaryResult {
  overallState:    RAGState;
  verdict:         string;
  wins:            CommentaryInsight[];
  focusAreas:      CommentaryInsight[];
  insufficientData: boolean;
}

/* ── Trend classifiers ──────────────────────────────────────────────────── */

export function classifyFacilityTrend(delta: number): TrendState {
  const t = OPS_FACILITY_TREND_THRESHOLDS;
  if (delta >= t.improving)  return "improving";
  if (delta > t.flat_min)    return "flat";
  if (delta > t.declining)   return "declining";
  return "alarming";
}

export function classifyMysteryTrend(delta: number): TrendState {
  const t = OPS_MYSTERY_TREND_THRESHOLDS;
  if (delta >= t.improving)  return "improving";
  if (delta > t.flat_min)    return "flat";
  if (delta > t.declining)   return "declining";
  return "alarming";
}

/* ── Internal RAG classifiers ───────────────────────────────────────────── */

function classifyHigherBetter(value: number, key: string): RAGState {
  const th = OPS_RAG_THRESHOLDS[key];
  if (value >= th.green)  return "green";
  if (value >= th.yellow) return "yellow";
  return "red";
}

function classifyLowerBetter(value: number, key: string): RAGState {
  const th = OPS_RAG_THRESHOLDS[key];
  if (value <= th.green)  return "green";
  if (value <= th.yellow) return "yellow";
  return "red";
}

function classifyUnattended(value: number): RAGState {
  if (value === 0)  return "green";
  if (value <= 2)   return "yellow";
  return "red";
}

/* ── Template slot filler ───────────────────────────────────────────────── */

function fill(
  template: string,
  slots: Record<string, string | number | null>
): string {
  let out = template;
  for (const [key, val] of Object.entries(slots)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(val ?? "—"));
  }
  return out;
}

/* ── Metric evaluation ──────────────────────────────────────────────────── */

interface MetricEval {
  key:   string;
  state: RAGState;
  text:  string;
}

function evalOpsMetrics(inp: OpsCommentaryInputs): MetricEval[] {
  const results: MetricEval[] = [];

  const push = (key: string, state: RAGState, text: string) =>
    results.push({ key, state, text });

  // weightedAvg
  {
    const state = classifyHigherBetter(inp.weightedAvg, "weightedAvg");
    const tmpl  = OPS_TEMPLATES.weightedAvg[state];
    push("weightedAvg", state, fill(tmpl, {
      VALUE:          inp.weightedAvg.toFixed(1),
      LOCATION:       inp.lowestRatedLocation?.name ?? "—",
      LOCATION_SCORE: inp.lowestRatedLocation?.rating.toFixed(1) ?? "—",
      DELTA:          inp.ratingDelta != null ? (inp.ratingDelta >= 0 ? `+${inp.ratingDelta.toFixed(2)}` : inp.ratingDelta.toFixed(2)) : "—",
    }));
  }

  // ratingDelta
  if (inp.ratingDelta !== null) {
    const state = classifyHigherBetter(inp.ratingDelta, "ratingDelta");
    const tmpl  = OPS_TEMPLATES.ratingDelta[state];
    push("ratingDelta", state, fill(tmpl, {
      VALUE: inp.ratingDelta >= 0
        ? `+${inp.ratingDelta.toFixed(2)}`
        : inp.ratingDelta.toFixed(2),
    }));
  }

  // criticalCount
  {
    const state = classifyLowerBetter(inp.criticalCount, "criticalCount");
    const tmpl  = OPS_TEMPLATES.criticalCount[state];
    push("criticalCount", state, fill(tmpl, { VALUE: inp.criticalCount }));
  }

  // noteworthyCount
  {
    const state = classifyLowerBetter(inp.noteworthyCount, "noteworthyCount");
    const tmpl  = OPS_TEMPLATES.noteworthyCount[state];
    push("noteworthyCount", state, fill(tmpl, { VALUE: inp.noteworthyCount }));
  }

  // complimentaryPct
  {
    const state = classifyLowerBetter(inp.complimentaryPct, "complimentaryPct");
    const tmpl  = OPS_TEMPLATES.complimentaryPct[state];
    push("complimentaryPct", state, fill(tmpl, {
      VALUE: `${inp.complimentaryPct.toFixed(1)}%`,
      DELTA: `${(inp.complimentaryPct - 2.0).toFixed(1)}pp`,
    }));
  }

  // cashPct
  {
    const state = classifyLowerBetter(inp.cashPct, "cashPct");
    const tmpl  = OPS_TEMPLATES.cashPct[state];
    push("cashPct", state, fill(tmpl, {
      VALUE: `${inp.cashPct.toFixed(1)}%`,
    }));
  }

  // discountedCashPct
  {
    const state = classifyLowerBetter(inp.discountedCashPct, "discountedCashPct");
    const tmpl  = OPS_TEMPLATES.discountedCashPct[state];
    push("discountedCashPct", state, fill(tmpl, {
      VALUE: `${inp.discountedCashPct.toFixed(1)}%`,
    }));
  }

  // delCancelledPct
  {
    const state = classifyLowerBetter(inp.delCancelledPct, "delCancelledPct");
    const tmpl  = OPS_TEMPLATES.delCancelledPct[state];
    push("delCancelledPct", state, fill(tmpl, {
      VALUE: `${inp.delCancelledPct.toFixed(1)}%`,
    }));
  }

  // unattended
  {
    const state = classifyUnattended(inp.unattended);
    const tmpl  = OPS_TEMPLATES.unattended[state];
    push("unattended", state, fill(tmpl, { VALUE: inp.unattended }));
  }

  // avgFacility
  if (inp.avgFacility > 0) {
    const state = classifyHigherBetter(inp.avgFacility, "avgFacility");
    const tmpl  = OPS_TEMPLATES.avgFacility[state];
    push("avgFacility", state, fill(tmpl, {
      VALUE:          `${inp.avgFacility.toFixed(0)}%`,
      LOCATION:       inp.lowestFacilityLocation?.name ?? "—",
      LOCATION_SCORE: inp.lowestFacilityLocation
        ? `${inp.lowestFacilityLocation.score.toFixed(0)}%`
        : "—",
    }));
  }

  // avgMystery
  if (inp.avgMystery > 0) {
    const state = classifyHigherBetter(inp.avgMystery, "avgMystery");
    const tmpl  = OPS_TEMPLATES.avgMystery[state];
    push("avgMystery", state, fill(tmpl, {
      VALUE: `${inp.avgMystery.toFixed(0)}%`,
    }));
  }

  // facilityTrend (only surfaces if declining/alarming)
  if (inp.avgFacility > 0 && (inp.facilityTrend === "declining" || inp.facilityTrend === "alarming")) {
    const tmplKey = `facilityTrend_${inp.facilityTrend}` as keyof typeof OPS_TREND_TEMPLATES;
    const tmpl    = OPS_TREND_TEMPLATES[tmplKey];
    if (tmpl) {
      const delta = inp.facilityTrendDelta;
      push("facilityTrend", "yellow", fill(tmpl, {
        DELTA: delta >= 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`,
      }));
    }
  }

  // mysteryTrend (only surfaces if declining/alarming)
  if (inp.avgMystery > 0 && (inp.mysteryTrend === "declining" || inp.mysteryTrend === "alarming")) {
    const tmplKey = `mysteryTrend_${inp.mysteryTrend}` as keyof typeof OPS_TREND_TEMPLATES;
    const tmpl    = OPS_TREND_TEMPLATES[tmplKey];
    if (tmpl) {
      const delta = inp.mysteryTrendDelta;
      push("mysteryTrend", "yellow", fill(tmpl, {
        DELTA: delta >= 0 ? `+${delta.toFixed(1)}pp` : `${delta.toFixed(1)}pp`,
      }));
    }
  }

  return results;
}

/* ── Anomaly detection ───────────────────────────────────────────────────── */

function detectAnomalies(inp: OpsCommentaryInputs, metrics: MetricEval[]): string[] {
  const anomalies: string[] = [];
  const byKey = new Map(metrics.map((m) => [m.key, m]));

  const facilityState = byKey.get("avgFacility")?.state;
  const mysteryState  = byKey.get("avgMystery")?.state;
  if (facilityState === "green" && mysteryState === "red") {
    anomalies.push(fill(OPS_ANOMALY_TEMPLATE_CALIBRATION_GAP, {
      FACILITY_VALUE: `${inp.avgFacility.toFixed(0)}%`,
      MYSTERY_VALUE:  `${inp.avgMystery.toFixed(0)}%`,
    }));
  }

  return anomalies;
}

/* ── Overall state ───────────────────────────────────────────────────────── */

function determineOverallState(inp: OpsCommentaryInputs, metrics: MetricEval[]): RAGState {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const s = (key: string) => byKey.get(key)?.state ?? "green";

  // Hard RED conditions
  if (
    inp.weightedAvg < 4.2               ||
    (inp.ratingDelta !== null && inp.ratingDelta < -0.05) ||
    inp.criticalCount > 5               ||
    inp.unattended >= 3                 ||
    inp.discountedCashPct > 7.0         ||
    inp.cashPct > 18.0                  ||
    inp.delCancelledPct > 15.0          ||
    inp.avgMystery > 0 && inp.avgMystery < 65 ||
    inp.facilityTrend === "alarming"    ||
    inp.mysteryTrend  === "alarming"    ||
    (inp.lowestFacilityLocation && inp.lowestFacilityLocation.score < 55)
  ) return "red";

  // Soft RED: unattended + any other metric non-green
  if (inp.unattended >= 1) {
    const anyNonGreen = metrics.some((m) => m.key !== "unattended" && m.state !== "green");
    if (anyNonGreen) return "red";
  }

  // YELLOW
  if (metrics.some((m) => m.state === "yellow" || m.state === "red")) return "yellow";

  return "green";
}

/* ── Verdict sentence ────────────────────────────────────────────────────── */

function buildVerdict(
  overallState: RAGState,
  metrics: MetricEval[],
  periodLabel: string
): string {
  const redCount    = metrics.filter((m) => m.state === "red").length;
  const yellowCount = metrics.filter((m) => m.state === "yellow").length;
  const greenCount  = metrics.filter((m) => m.state === "green").length;
  const total       = metrics.length;

  if (overallState === "green") {
    return `Operations are tracking well in ${periodLabel} — ${greenCount} of ${total} indicators at or above target with no critical flags.`;
  }
  if (overallState === "yellow") {
    return `Operations require attention in ${periodLabel} — ${yellowCount} indicator${yellowCount !== 1 ? "s" : ""} below target${redCount > 0 ? `, ${redCount} in critical range` : ""}.`;
  }
  return `Critical operational issues detected in ${periodLabel} — ${redCount} metric${redCount !== 1 ? "s" : ""} require immediate action${yellowCount > 0 ? `; ${yellowCount} additional area${yellowCount !== 1 ? "s" : ""} need monitoring` : ""}.`;
}

/* ── Main export ─────────────────────────────────────────────────────────── */

export function computeOpsCommentary(inputs: OpsCommentaryInputs): OpsCommentaryResult {
  if (!inputs.hasEnoughData || inputs.totalReviews === 0) {
    return {
      overallState: "green",
      verdict:      "",
      wins:         [],
      focusAreas:   [],
      insufficientData: true,
    };
  }

  const metrics     = evalOpsMetrics(inputs);
  const anomalies   = detectAnomalies(inputs, metrics);
  const overallState = determineOverallState(inputs, metrics);
  const verdict     = buildVerdict(overallState, metrics, inputs.periodLabel);

  const byKey = new Map(metrics.map((m) => [m.key, m]));

  const labelOf = (key: string) => {
    const spec = (OPS_TEMPLATES as Record<string, unknown>)[key];
    return spec ? (byKey.get(key)?.key ?? key) : key;
  };

  const METRIC_LABELS: Record<string, string> = {
    weightedAvg:       "Google Rating",
    ratingDelta:       "Rating Trend (MoM)",
    criticalCount:     "Critical Reviews (≤3★)",
    noteworthyCount:   "Noteworthy Reviews",
    complimentaryPct:  "Complimentary %",
    cashPct:           "Cash Sales %",
    discountedCashPct: "Discounted Cash %",
    delCancelledPct:   "Del. & Cancelled %",
    unattended:        "Unattended Sessions",
    avgFacility:       "Facility Standards",
    avgMystery:        "Mystery Guest Score",
    facilityTrend:     "Facility Trend",
    mysteryTrend:      "Mystery Trend",
  };

  const focusAreas: CommentaryInsight[] = OPS_FOCUS_PRIORITY
    .filter((k) => {
      const s = byKey.get(k)?.state;
      return s === "red" || s === "yellow";
    })
    .map((k) => ({
      metricKey: k,
      label:     METRIC_LABELS[k] ?? k,
      state:     byKey.get(k)!.state,
      text:      byKey.get(k)!.text,
    }))
    .sort((a, b) => {
      if (a.state === "red" && b.state !== "red") return -1;
      if (b.state === "red" && a.state !== "red") return 1;
      return 0;
    })
    .slice(0, 3);

  // Prepend anomaly texts to the first relevant focus area (or as a standalone note)
  if (anomalies.length > 0 && focusAreas.length > 0) {
    focusAreas[0].text = anomalies[0] + " " + focusAreas[0].text;
  }

  const wins: CommentaryInsight[] = OPS_WINS_PRIORITY
    .filter((k) => byKey.get(k)?.state === "green")
    .map((k) => ({
      metricKey: k,
      label:     METRIC_LABELS[k] ?? k,
      state:     "green" as RAGState,
      text:      byKey.get(k)!.text,
    }))
    .slice(0, 3);

  return { overallState, verdict, wins, focusAreas, insufficientData: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   EBITDA COMMENTARY ENGINE (backwards-compatible re-export)
   ══════════════════════════════════════════════════════════════════════════ */

export interface MetricResult {
  key:        string;
  label:      string;
  rag:        RagState;
  value:      number;
  benchmark:  number;
  deltaYoy?:  number;
  text:       string;
  priority:   number;
}

export interface CommentaryOutput {
  overallRag:       RagState;
  verdictText:      string;
  wins:             MetricResult[];
  focusAreas:       MetricResult[];
  insufficientData: boolean;
}

export interface PeriodData {
  revenue:     number;
  wages:       number;
  advertising: number;
  sga:         number;
  cogs:        number;
  rent:        number;
  utilities:   number;
  ebitda:      number;
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

function fillEbitdaTemplate(template: string, value: number, benchmark: number): string {
  return template
    .replace("{value}",     fmt(value))
    .replace("{benchmark}", fmt(benchmark, 0));
}

function classifyRag(metric: MetricConfig, value: number): RagState {
  if (metric.direction === "higher_is_better") {
    if (value >= metric.greenMin)  return "green";
    if (value >= metric.yellowMin) return "yellow";
    return "red";
  } else {
    if (value <= metric.greenMin)  return "green";
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

interface RawMetricValues {
  ebitda_margin?: number;
  revenueYoy?:    number;
  wages_pct?:     number;
  marketing_pct?: number;
  sga_pct?:       number;
  cogs_pct?:      number;
  rent_util_pct?: number;
}

function computeMetricValues(current: PeriodData, prior: PeriodData | null): RawMetricValues {
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

function computeOverallRag(results: MetricResult[]): RagState {
  const redResults    = results.filter((r) => r.rag === "red");
  const yellowResults = results.filter((r) => r.rag === "yellow");
  const hasCriticalRed    = redResults.some((r) => r.priority <= 3);
  const hasManyReds       = redResults.length >= 2;
  if (hasCriticalRed || hasManyReds) return "red";
  const hasCriticalYellow = yellowResults.some((r) => r.priority <= 2);
  const hasManyYellows    = yellowResults.length >= 2;
  if (hasCriticalYellow || hasManyYellows) return "yellow";
  return "green";
}

function buildEbitdaVerdictText(
  overallRag: RagState,
  results: MetricResult[],
  ebitdaMargin: number | undefined
): string {
  const tone    = overallRag === "green" ? "strong" : overallRag === "yellow" ? "steady" : "under pressure";
  const margin  = ebitdaMargin !== undefined ? ` at ${fmt(ebitdaMargin)}%` : "";
  const focuses = results.filter((r) => r.rag !== "green").sort((a, b) => a.priority - b.priority);
  const wins    = results.filter((r) => r.rag === "green").sort((a, b) => a.priority - b.priority);
  let tail = "";
  if (focuses.length > 0)      tail = ` — ${focuses[0].label} needs attention`;
  else if (wins.length > 0)    tail = ` — ${wins[0].label} is a standout`;
  return `Group EBITDA is ${tone}${margin}${tail}.`;
}

export function computeEbitdaCommentary(current: PeriodData, prior: PeriodData | null): CommentaryOutput {
  if (current.revenue === 0) {
    return { overallRag: "green", verdictText: "", wins: [], focusAreas: [], insufficientData: true };
  }

  const rawValues = computeMetricValues(current, prior);
  const results: MetricResult[] = [];

  for (const metricCfg of EBITDA_COMMENTARY_CONFIG) {
    const value = rawValues[metricCfg.key as keyof RawMetricValues];
    if (value === undefined) continue;
    const rag      = classifyRag(metricCfg, value);
    const template = pickTemplate(metricCfg, rag);
    const text     = fillEbitdaTemplate(template, value, metricCfg.benchmark);
    const result: MetricResult = { key: metricCfg.key, label: metricCfg.label, rag, value, benchmark: metricCfg.benchmark, text, priority: metricCfg.priority };
    if (metricCfg.key === "revenueYoy" && rawValues.revenueYoy !== undefined) {
      result.deltaYoy = rawValues.revenueYoy;
    }
    results.push(result);
  }

  if (results.length < 3) {
    return { overallRag: "green", verdictText: "", wins: [], focusAreas: [], insufficientData: true };
  }

  const overallRag = computeOverallRag(results);
  const wins = results.filter((r) => r.rag === "green").sort((a, b) => a.priority - b.priority).slice(0, 3);
  const focusAreas = results
    .filter((r) => r.rag !== "green")
    .sort((a, b) => {
      if (a.rag === "red" && b.rag !== "red") return -1;
      if (a.rag !== "red" && b.rag === "red") return 1;
      return a.priority - b.priority;
    })
    .slice(0, 3);
  const verdictText = buildEbitdaVerdictText(overallRag, results, rawValues.ebitda_margin);

  return { overallRag, verdictText, wins, focusAreas, insufficientData: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   HR COMMENTARY ENGINE (backwards-compatible re-export)
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
  wins:          HRMetricResult[];
  focusAreas:    HRMetricResult[];
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
  if (unit === "eur")  return `€${Math.round(n).toLocaleString("en-GB")}`;
  if (unit === "pct")  return `${Math.round(n)}%`;
  if (unit === "hrs")  return `${n.toFixed(1)} hrs`;
  if (n >= 0)          return `+${Math.round(n)}`;
  return String(Math.round(n));
}

function fillHRTemplate(template: string, val: number, t: HRThreshold): string {
  const delta = Math.abs(val - t.benchmark);
  return template
    .replace(/\{\{VAL\}\}/g,       fmtHR(val,         t.unit))
    .replace(/\{\{BENCHMARK\}\}/g, fmtHR(t.benchmark, t.unit))
    .replace(/\{\{TARGET\}\}/g,    fmtHR(t.benchmark, t.unit))
    .replace(/\{\{DELTA\}\}/g,     fmtHR(delta,       t.unit));
}

function evalHRMetric(key: string, value: number | null): HRMetricResult | null {
  if (value === null || isNaN(value)) return null;
  const t    = HR_METRIC_THRESHOLDS[key];
  const tmpl = HR_TEMPLATES[key];
  if (!t || !tmpl) return null;

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
      const yMax    = yellowMax ?? (greenMax != null ? greenMax * 1.1 : green * 1.3);
      const inYellow =
        (value >= yellow && value < green) ||
        (greenMax != null && value > greenMax && value <= yMax);
      status = inYellow ? "yellow" : "red";
    }
  }

  return { key, label: HR_LABELS[key] ?? key, status, text: fillHRTemplate(tmpl[status] ?? "", value, t) };
}

export function computeHRCommentary(input: HRCommentaryInput): HRCommentaryOutput {
  const results: HRMetricResult[] = [];
  for (const [inputKey, threshKey] of Object.entries(HR_KEY_MAP)) {
    const value  = input[inputKey as keyof HRCommentaryInput];
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
    .filter((k) => { const s = byKey.get(k)?.status; return s === "red" || s === "yellow"; })
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
