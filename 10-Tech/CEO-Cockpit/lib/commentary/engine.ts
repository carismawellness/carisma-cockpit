/**
 * EBITDA Strategic Commentary Engine
 *
 * Pure computation module — no React, no side effects.
 * Reads from benchmarks.ts and returns structured commentary output
 * consumed by StrategicCommentary.tsx.
 *
 * Compatible with both ebitda-v2 (current period) and ebitda-longitudinal
 * (most recent full month) dashboards.
 *
 * Also exports the CRM Agent Commentary Engine functions used by
 * CrmStrategicCommentary.tsx (computeTeamCommentary, computeAgentCommentary,
 * computeCrmMasterCommentary).
 */

import {
  EBITDA_COMMENTARY_CONFIG,
  MetricConfig,
  RagState,
  TrendState,
  MetricBenchmark,
  BENCHMARK_BY_KEY,
  CRITICAL_METRICS,
  CRM_AGENT_BENCHMARKS,
  OPS_RAG_THRESHOLDS,
  OPS_METRIC_SPECS,
  OPS_TEMPLATES,
  OPS_TREND_THRESHOLDS,
  OPS_TREND_TEMPLATES,
  OPS_FOCUS_PRIORITY,
  OPS_WINS_PRIORITY,
} from "./benchmarks";

import type { CrmAgent } from "@/lib/hooks/useCrmAgents";
import type { GhlSnapshotBrand } from "@/lib/hooks/useGhlSnapshot";

// Re-export so consumers that import CRM_AGENT_BENCHMARKS from engine.ts work too
export { CRM_AGENT_BENCHMARKS };

/* ── Public types ────────────────────────────────────────────────────────── */

export type { RagState, MetricConfig, MetricBenchmark };

// RAGState (capital G) — alias used by CrmStrategicCommentary
export type RAGState = "green" | "yellow" | "red" | "insufficient";

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

/* ═══════════════════════════════════════════════════════════════════════════
   CRM AGENT STRATEGIC COMMENTARY ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

// ── CRM Core types ────────────────────────────────────────────────────────────

export interface CrmMetricResult {
  key: string;
  label: string;
  value: number;
  ragState: RAGState;
  formattedValue: string;
  template: string;
  axis: "level" | "trend" | "vs_prior" | "anomaly";
  priority: number;
}

export interface CommentaryResult {
  overallRag: RAGState;
  verdict: string;
  wins: CrmMetricResult[];
  focusAreas: CrmMetricResult[];
  insufficient: boolean;
}

// ── CRM Formatting helpers ────────────────────────────────────────────────────

function crmFmtValue(value: number, unit: string): string {
  switch (unit) {
    case "%":              return `${value.toFixed(1)}%`;
    case "EUR":            return `€${Math.round(value).toLocaleString()}`;
    case "EUR/day":        return `€${Math.round(value).toLocaleString()}`;
    case "min/day":        return `${Math.round(value)} min`;
    case "dials":          return `${Math.round(value)}`;
    case "bookings":       return `${Math.round(value)}`;
    case "deposits":       return `${Math.round(value)}`;
    case "bookings/day":   return `${value.toFixed(1)}`;
    case "leads/week":     return `${Math.round(value)}`;
    case "contacts":       return `${Math.round(value)}`;
    case "messages":       return `${Math.round(value)}`;
    case "agents":         return `${Math.round(value)}`;
    default:               return `${value.toFixed(1)}`;
  }
}

function crmFmtDelta(delta: number, unit: string): string {
  const abs = Math.abs(delta);
  switch (unit) {
    case "%":     return `${abs.toFixed(1)}`;
    case "EUR":   return `€${Math.round(abs).toLocaleString()}`;
    case "EUR/day": return `€${Math.round(abs).toLocaleString()}`;
    case "min/day": return `${Math.round(abs)}`;
    default:      return `${abs.toFixed(1)}`;
  }
}

// ── CRM Core classification ───────────────────────────────────────────────────

export function classifyMetric(value: number, m: MetricBenchmark): RAGState {
  if (m.higherIsBetter) {
    if (value >= m.green)  return "green";
    if (value >= m.yellow) return "yellow";
    return "red";
  } else {
    if (value <= m.green)  return "green";
    if (value <= m.yellow) return "yellow";
    return "red";
  }
}

// ── CRM Template filling ──────────────────────────────────────────────────────

export function crmFillTemplate(
  template: string,
  value: number,
  benchmark: number,
  unit: string,
  delta?: number
): string {
  const formattedValue     = crmFmtValue(value, unit);
  const formattedBenchmark = crmFmtValue(benchmark, unit).replace(/[€%]/g, "").trim();
  const formattedDelta     = delta !== undefined ? crmFmtDelta(delta, unit) : "—";

  return template
    .replace(/\{value\}/g,     formattedValue)
    .replace(/\{benchmark\}/g, formattedBenchmark)
    .replace(/\{delta\}/g,     formattedDelta);
}

// ── Build a CrmMetricResult from raw value + benchmark ───────────────────────

function buildCrmMetricResult(
  key: string,
  value: number,
  overrideLabel?: string,
  overrideBenchmark?: MetricBenchmark
): CrmMetricResult | null {
  const m = overrideBenchmark ?? BENCHMARK_BY_KEY[key];
  if (!m) return null;

  const ragState = classifyMetric(value, m);
  const delta    = Math.abs(value - m.benchmark);
  const tmplKey  = ragState as "green" | "yellow" | "red";
  const template = crmFillTemplate(m.templates[tmplKey], value, m.benchmark, m.unit, delta);

  return {
    key,
    label:          overrideLabel ?? m.label,
    value,
    ragState,
    formattedValue: crmFmtValue(value, m.unit),
    template,
    axis:           "level",
    priority:       m.priority,
  };
}

// ── Concentration risk analysis ───────────────────────────────────────────────

export function analyzeConcentrationRisk(agents: CrmAgent[]): CrmMetricResult | null {
  const m = BENCHMARK_BY_KEY["team_concentration_risk"];
  if (!m) return null;

  const totalBookings = agents.reduce((s, a) => s + a.totals.total_bookings, 0);
  if (totalBookings === 0) return null;

  const sorted    = [...agents].sort((a, b) => b.totals.total_bookings - a.totals.total_bookings);
  const top2Books = sorted.slice(0, 2).reduce((s, a) => s + a.totals.total_bookings, 0);
  const sharePct  = (top2Books / totalBookings) * 100;

  const ragState  = classifyMetric(sharePct, m);
  const delta     = Math.abs(sharePct - m.benchmark);
  const tmplKey   = ragState as "green" | "yellow" | "red";
  const template  = crmFillTemplate(m.templates[tmplKey], sharePct, m.benchmark, m.unit, delta);

  return {
    key:            "team_concentration_risk",
    label:          m.label,
    value:          sharePct,
    ragState,
    formattedValue: crmFmtValue(sharePct, m.unit),
    template,
    axis:           "anomaly",
    priority:       m.priority,
  };
}

// ── Result aggregation helpers ────────────────────────────────────────────────

function crmDeriveOverallRag(results: CrmMetricResult[], criticalKeys: readonly string[]): RAGState {
  const criticals = results.filter((r) => criticalKeys.includes(r.key));
  if (criticals.some((r) => r.ragState === "red"))    return "red";
  if (criticals.some((r) => r.ragState === "yellow")) return "yellow";
  if (criticals.every((r) => r.ragState === "green")) return "green";
  return "insufficient";
}

function crmBuildVerdict(rag: RAGState, context: string): string {
  switch (rag) {
    case "green":
      return `${context} is performing above target — all critical metrics are in the green. Maintain momentum and continue coaching best practices across the team.`;
    case "yellow":
      return `${context} is below target on one or more critical metrics. Review the focus areas below and take corrective action before the next dial session.`;
    case "red":
      return `${context} has critical performance gaps. Immediate management action is required — do not wait until end of week to address the issues below.`;
    default:
      return `${context} — insufficient data for a full assessment. Run the ETL sync to populate metrics.`;
  }
}

function crmPartitionResults(results: CrmMetricResult[]): {
  wins: CrmMetricResult[];
  focusAreas: CrmMetricResult[];
} {
  const wins = results
    .filter((r) => r.ragState === "green")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const focusAreas = [
    ...results.filter((r) => r.ragState === "red").sort((a, b) => a.priority - b.priority),
    ...results.filter((r) => r.ragState === "yellow").sort((a, b) => a.priority - b.priority),
  ].slice(0, 3);

  return { wins, focusAreas };
}

// ── Team commentary (for /crm/individual) ────────────────────────────────────

export function computeTeamCommentary(
  agents: CrmAgent[],
  priorAgents: CrmAgent[],
  periodDays: number
): CommentaryResult {
  void priorAgents; // reserved for future trend analysis

  if (agents.length === 0) {
    return {
      overallRag:   "insufficient",
      verdict:      "Insufficient data — run the ETL sync first.",
      wins:         [],
      focusAreas:   [],
      insufficient: true,
    };
  }

  const activeAgents = agents.filter((a) => a.totals.active_days > 0);
  const sdrAgents    = agents.filter((a) => a.totals.total_talk_time > 0 || a.totals.avg_booking_eff > 0);

  const results: CrmMetricResult[] = [];

  // avg_conv_pct
  const avgConv = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_conversion_rate, 0) / activeAgents.length
    : 0;
  const convResult = buildCrmMetricResult("avg_conv_pct", avgConv);
  if (convResult) results.push(convResult);

  // avg_deposit_pct
  const avgDeposit = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_deposit_pct, 0) / activeAgents.length
    : 0;
  const depositResult = buildCrmMetricResult("avg_deposit_pct", avgDeposit);
  if (depositResult) results.push(depositResult);

  // bkg_eff_pct (SDR agents only)
  if (sdrAgents.length > 0) {
    const avgBkgEff = sdrAgents.reduce((s, a) => s + a.totals.avg_booking_eff, 0) / sdrAgents.length;
    const bkgEffResult = buildCrmMetricResult("bkg_eff_pct", avgBkgEff);
    if (bkgEffResult) results.push(bkgEffResult);
  }

  // messages per agent per day
  if (periodDays > 0 && activeAgents.length > 0) {
    const totalMessages = agents.reduce((s, a) => s + a.totals.total_messages, 0);
    const dialsPerDay   = totalMessages / (activeAgents.length * periodDays);
    const dialsResult   = buildCrmMetricResult("total_messages", dialsPerDay);
    if (dialsResult) results.push(dialsResult);
  }

  // talk time per active day (SDR only)
  if (sdrAgents.length > 0 && periodDays > 0) {
    const totalTalkTime  = sdrAgents.reduce((s, a) => s + a.totals.total_talk_time, 0);
    const activeSdrDays  = sdrAgents.reduce((s, a) => s + a.totals.active_days, 0);
    const talkTimePerDay = activeSdrDays > 0 ? totalTalkTime / activeSdrDays : 0;
    const talkTimeResult = buildCrmMetricResult("total_talk_time", talkTimePerDay);
    if (talkTimeResult) results.push(talkTimeResult);
  }

  // total_bookings
  const totalBookings  = agents.reduce((s, a) => s + a.totals.total_bookings, 0);
  const bookingsResult = buildCrmMetricResult("total_bookings", totalBookings);
  if (bookingsResult) results.push(bookingsResult);

  // total_deposits
  const totalDeposits  = agents.reduce((s, a) => s + (a.totals.total_deposits ?? 0), 0);
  const depositsResult = buildCrmMetricResult("total_deposits", totalDeposits);
  if (depositsResult) results.push(depositsResult);

  // concentration_risk
  const concentrationResult = analyzeConcentrationRisk(agents);
  if (concentrationResult) results.push(concentrationResult);

  // inactive_agents_count
  const inactiveCount  = agents.filter((a) => a.totals.active_days === 0 && a.totals.total_bookings === 0).length;
  const inactiveResult = buildCrmMetricResult("inactive_agents_count", inactiveCount);
  if (inactiveResult) results.push(inactiveResult);

  const overallRag = crmDeriveOverallRag(results, CRITICAL_METRICS.team);
  const verdict    = crmBuildVerdict(overallRag, "Team");
  const { wins, focusAreas } = crmPartitionResults(results);

  return { overallRag, verdict, wins, focusAreas, insufficient: false };
}

// ── Individual agent commentary (for /crm/individual/[slug]) ─────────────────

export function computeAgentCommentary(
  agent: CrmAgent,
  _priorAgent: CrmAgent | null,
  periodDays: number
): CommentaryResult {
  const t = agent.totals;

  if (t.active_days === 0 && t.total_bookings === 0) {
    return {
      overallRag:   "insufficient",
      verdict:      `No activity recorded for ${agent.name} in the selected period.`,
      wins:         [],
      focusAreas:   [],
      insufficient: true,
    };
  }

  const results: CrmMetricResult[] = [];

  const convResult = buildCrmMetricResult("avg_conv_pct", t.avg_conversion_rate);
  if (convResult) results.push(convResult);

  const depositResult = buildCrmMetricResult("avg_deposit_pct", t.avg_deposit_pct);
  if (depositResult) results.push(depositResult);

  if (periodDays > 0) {
    const activeDaysRatio = (t.active_days / periodDays) * 100;
    const adResult = buildCrmMetricResult("active_days_ratio", activeDaysRatio);
    if (adResult) results.push(adResult);
  }

  if (t.active_days > 0) {
    const dialsPerDay = t.total_messages / t.active_days;
    const dialsResult = buildCrmMetricResult("total_messages", dialsPerDay);
    if (dialsResult) results.push(dialsResult);
  }

  if (t.total_talk_time > 0 && t.active_days > 0) {
    const talkTimePerDay = t.total_talk_time / t.active_days;
    const talkTimeResult = buildCrmMetricResult("total_talk_time", talkTimePerDay);
    if (talkTimeResult) results.push(talkTimeResult);
  }

  if (t.active_days > 0) {
    const bkgPerDay = t.total_bookings / t.active_days;
    const bkgResult = buildCrmMetricResult("bookings_per_active_day", bkgPerDay);
    if (bkgResult) results.push(bkgResult);
  }

  if (t.avg_booking_eff > 0) {
    const bkgEffResult = buildCrmMetricResult("bkg_eff_pct", t.avg_booking_eff);
    if (bkgEffResult) results.push(bkgEffResult);
  }

  if (t.active_days > 0) {
    const revPerDay = t.total_sales / t.active_days;
    const revResult = buildCrmMetricResult("revenue_per_active_day", revPerDay);
    if (revResult) results.push(revResult);
  }

  const overallRag = crmDeriveOverallRag(results, CRITICAL_METRICS.individual);
  const verdict    = crmBuildVerdict(overallRag, agent.name);
  const { wins, focusAreas } = crmPartitionResults(results);

  return { overallRag, verdict, wins, focusAreas, insufficient: false };
}

// ── CRM Master commentary (for /crm — live GHL snapshot) ─────────────────────

export function computeCrmMasterCommentary(snapshot: {
  spa:        GhlSnapshotBrand;
  aesthetics: GhlSnapshotBrand;
  slimming:   GhlSnapshotBrand;
}): CommentaryResult {
  const brands = [
    { key: "spa",        label: "Spa",        data: snapshot.spa        },
    { key: "aesthetics", label: "Aesthetics",  data: snapshot.aesthetics },
    { key: "slimming",   label: "Slimming",    data: snapshot.slimming   },
  ];

  const results: CrmMetricResult[] = [];

  for (const brand of brands) {
    const d = brand.data;

    const waResult = buildCrmMetricResult("unreadWhatsapp", d.unreadWhatsapp, `${brand.label} — Unread WhatsApp`);
    if (waResult) results.push({ ...waResult, key: `${brand.key}_unreadWhatsapp` });

    const crmResult = buildCrmMetricResult("unreadCrm", d.unreadCrm, `${brand.label} — Unread CRM SMS`);
    if (crmResult) results.push({ ...crmResult, key: `${brand.key}_unreadCrm` });

    const emailResult = buildCrmMetricResult("unreadEmail", d.unreadEmail, `${brand.label} — Unread Email`);
    if (emailResult) results.push({ ...emailResult, key: `${brand.key}_unreadEmail` });

    const leadsResult = buildCrmMetricResult("newLeads", d.newLeads, `${brand.label} — New Leads`);
    if (leadsResult) results.push({ ...leadsResult, key: `${brand.key}_newLeads` });

    const todoResult = buildCrmMetricResult("todoCount", d.todoCount, `${brand.label} — Follow-up Backlog`);
    if (todoResult) results.push({ ...todoResult, key: `${brand.key}_todoCount` });
  }

  let overallRag: RAGState = "green";
  const allRags = results.map((r) => r.ragState);
  if (allRags.includes("red"))         overallRag = "red";
  else if (allRags.includes("yellow")) overallRag = "yellow";

  const verdict = crmBuildVerdict(overallRag, "GHL Live Queue");
  const { wins, focusAreas } = crmPartitionResults(results);

  return { overallRag, verdict, wins, focusAreas, insufficient: false };
}
