// lib/commentary/engine.ts
// Strategic Commentary Engine — pure TypeScript, no React, no API calls.
// All computations are deterministic and side-effect-free.

import {
  CrmAgent,
  CrmAgentTotals,
} from "@/lib/hooks/useCrmAgents";
import { GhlSnapshotBrand } from "@/lib/hooks/useGhlSnapshot";
import {
  MetricBenchmark,
  BENCHMARK_BY_KEY,
  CRITICAL_METRICS,
  CRM_AGENT_BENCHMARKS,
} from "./benchmarks";

// ── Core types ────────────────────────────────────────────────────────────────

export type RAGState = "green" | "yellow" | "red" | "insufficient";

export interface MetricResult {
  key: string;
  label: string;
  value: number;
  ragState: RAGState;
  formattedValue: string;
  template: string;   // filled template string ready to render
  axis: "level" | "trend" | "vs_prior" | "anomaly";
  priority: number;
}

export interface CommentaryResult {
  overallRag: RAGState;
  verdict: string;
  wins: MetricResult[];        // GREEN metrics, max 3, sorted by priority
  focusAreas: MetricResult[];  // RED then YELLOW, max 3
  insufficient: boolean;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtValue(value: number, unit: string): string {
  switch (unit) {
    case "%":         return `${value.toFixed(1)}%`;
    case "EUR":       return `€${Math.round(value).toLocaleString()}`;
    case "EUR/day":   return `€${Math.round(value).toLocaleString()}`;
    case "min/day":   return `${Math.round(value)} min`;
    case "dials":     return `${Math.round(value)}`;
    case "bookings":  return `${Math.round(value)}`;
    case "deposits":  return `${Math.round(value)}`;
    case "bookings/day": return `${value.toFixed(1)}`;
    case "leads/week": return `${Math.round(value)}`;
    case "contacts":  return `${Math.round(value)}`;
    case "messages":  return `${Math.round(value)}`;
    case "agents":    return `${Math.round(value)}`;
    default:          return `${value.toFixed(1)}`;
  }
}

function fmtDelta(delta: number, unit: string): string {
  const abs = Math.abs(delta);
  switch (unit) {
    case "%":         return `${abs.toFixed(1)}`;
    case "EUR":       return `€${Math.round(abs).toLocaleString()}`;
    case "EUR/day":   return `€${Math.round(abs).toLocaleString()}`;
    case "min/day":   return `${Math.round(abs)}`;
    default:          return `${abs.toFixed(1)}`;
  }
}

// ── Core classification ───────────────────────────────────────────────────────

export function classifyMetric(value: number, m: MetricBenchmark): RAGState {
  if (m.higherIsBetter) {
    if (value >= m.green)  return "green";
    if (value >= m.yellow) return "yellow";
    return "red";
  } else {
    // lower is better — green = at or below green threshold
    if (value <= m.green)  return "green";
    if (value <= m.yellow) return "yellow";
    return "red";
  }
}

// ── Template filling ──────────────────────────────────────────────────────────

export function fillTemplate(
  template: string,
  value: number,
  benchmark: number,
  unit: string,
  delta?: number
): string {
  const formattedValue     = fmtValue(value, unit);
  const formattedBenchmark = fmtValue(benchmark, unit);
  const formattedDelta     = delta !== undefined ? fmtDelta(delta, unit) : "—";

  return template
    .replace(/\{value\}/g,     formattedValue)
    .replace(/\{benchmark\}/g, formattedBenchmark.replace(/[€%]/g, "").trim()) // benchmark usually just number
    .replace(/\{delta\}/g,     formattedDelta);
}

// ── Prior period helpers ──────────────────────────────────────────────────────

export function computePriorPeriodDelta(current: number, prior: number): number {
  if (prior === 0) return 0;
  return ((current - prior) / prior) * 100;
}

// ── Build a MetricResult from raw value + benchmark ──────────────────────────

function buildMetricResult(
  key: string,
  value: number,
  overrideLabel?: string,
  overrideBenchmark?: MetricBenchmark
): MetricResult | null {
  const m = overrideBenchmark ?? BENCHMARK_BY_KEY[key];
  if (!m) return null;

  const ragState = classifyMetric(value, m);
  const delta    = Math.abs(value - m.benchmark);
  // classifyMetric only returns green | yellow | red (never 'insufficient')
  const templateKey = ragState as "green" | "yellow" | "red";
  const template = fillTemplate(
    m.templates[templateKey],
    value,
    m.benchmark,
    m.unit,
    delta
  );

  return {
    key,
    label:          overrideLabel ?? m.label,
    value,
    ragState,
    formattedValue: fmtValue(value, m.unit),
    template,
    axis:           "level",
    priority:       m.priority,
  };
}

// ── Concentration risk analysis ───────────────────────────────────────────────

export function analyzeConcentrationRisk(agents: CrmAgent[]): MetricResult | null {
  const m = BENCHMARK_BY_KEY["team_concentration_risk"];
  if (!m) return null;

  const totalBookings = agents.reduce((s, a) => s + a.totals.total_bookings, 0);
  if (totalBookings === 0) return null;

  const sorted     = [...agents].sort((a, b) => b.totals.total_bookings - a.totals.total_bookings);
  const top2       = sorted.slice(0, 2);
  const top2Books  = top2.reduce((s, a) => s + a.totals.total_bookings, 0);
  const sharePct   = (top2Books / totalBookings) * 100;

  const ragState   = classifyMetric(sharePct, m);
  const delta      = Math.abs(sharePct - m.benchmark);
  const concTemplateKey = ragState as "green" | "yellow" | "red";
  const template   = fillTemplate(m.templates[concTemplateKey], sharePct, m.benchmark, m.unit, delta);

  return {
    key:            "team_concentration_risk",
    label:          m.label,
    value:          sharePct,
    ragState,
    formattedValue: fmtValue(sharePct, m.unit),
    template,
    axis:           "anomaly",
    priority:       m.priority,
  };
}

// ── Result aggregation helpers ────────────────────────────────────────────────

function deriveOverallRag(results: MetricResult[], criticalKeys: readonly string[]): RAGState {
  const criticals = results.filter((r) => criticalKeys.includes(r.key));
  if (criticals.some((r) => r.ragState === "red"))    return "red";
  if (criticals.some((r) => r.ragState === "yellow")) return "yellow";
  if (criticals.every((r) => r.ragState === "green")) return "green";
  return "insufficient";
}

function buildVerdict(overallRag: RAGState, context: string): string {
  switch (overallRag) {
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

function partitionResults(results: MetricResult[]): {
  wins: MetricResult[];
  focusAreas: MetricResult[];
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
  // SDR agents: those with any talk_time or booking_eff data (not chat-only)
  const sdrAgents    = agents.filter((a) => a.totals.total_talk_time > 0 || a.totals.avg_booking_eff > 0);

  const results: MetricResult[] = [];

  // a) avg_conv_pct — weighted avg over active agents
  const avgConv = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_conversion_rate, 0) / activeAgents.length
    : 0;
  const convResult = buildMetricResult("avg_conv_pct", avgConv);
  if (convResult) results.push(convResult);

  // b) avg_deposit_pct — weighted avg over active agents
  const avgDeposit = activeAgents.length
    ? activeAgents.reduce((s, a) => s + a.totals.avg_deposit_pct, 0) / activeAgents.length
    : 0;
  const depositResult = buildMetricResult("avg_deposit_pct", avgDeposit);
  if (depositResult) results.push(depositResult);

  // c) avg_booking_eff — avg of SDR agents
  const avgBkgEff = sdrAgents.length
    ? sdrAgents.reduce((s, a) => s + a.totals.avg_booking_eff, 0) / sdrAgents.length
    : 0;
  if (sdrAgents.length > 0) {
    const bkgEffResult = buildMetricResult("bkg_eff_pct", avgBkgEff);
    if (bkgEffResult) results.push(bkgEffResult);
  }

  // d) total_dials per agent per day
  if (periodDays > 0 && activeAgents.length > 0) {
    const totalMessages = agents.reduce((s, a) => s + a.totals.total_messages, 0);
    const dialsPerDay   = totalMessages / (activeAgents.length * periodDays);
    const dialsResult   = buildMetricResult("total_messages", dialsPerDay);
    if (dialsResult) results.push(dialsResult);
  }

  // e) total_talk_time per active day (SDR agents only)
  if (sdrAgents.length > 0 && periodDays > 0) {
    const totalTalkTime    = sdrAgents.reduce((s, a) => s + a.totals.total_talk_time, 0);
    const activeSdrDays    = sdrAgents.reduce((s, a) => s + a.totals.active_days, 0);
    const talkTimePerDay   = activeSdrDays > 0 ? totalTalkTime / activeSdrDays : 0;
    const talkTimeResult   = buildMetricResult("total_talk_time", talkTimePerDay);
    if (talkTimeResult) results.push(talkTimeResult);
  }

  // f) total_bookings
  const totalBookings  = agents.reduce((s, a) => s + a.totals.total_bookings, 0);
  const bookingsResult = buildMetricResult("total_bookings", totalBookings);
  if (bookingsResult) results.push(bookingsResult);

  // g) total_deposits
  const totalDeposits  = agents.reduce((s, a) => s + (a.totals.total_deposits ?? 0), 0);
  const depositsResult = buildMetricResult("total_deposits", totalDeposits);
  if (depositsResult) results.push(depositsResult);

  // h) concentration_risk
  const concentrationResult = analyzeConcentrationRisk(agents);
  if (concentrationResult) results.push(concentrationResult);

  // i) inactive agent count
  const inactiveCount  = agents.filter((a) => a.totals.active_days === 0 && a.totals.total_bookings === 0).length;
  const inactiveResult = buildMetricResult("inactive_agents_count", inactiveCount);
  if (inactiveResult) results.push(inactiveResult);

  const overallRag = deriveOverallRag(results, CRITICAL_METRICS.team);
  const verdict    = buildVerdict(overallRag, "Team");
  const { wins, focusAreas } = partitionResults(results);

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

  const results: MetricResult[] = [];

  // avg_conv_pct
  const convResult = buildMetricResult("avg_conv_pct", t.avg_conversion_rate);
  if (convResult) results.push(convResult);

  // avg_deposit_pct
  const depositResult = buildMetricResult("avg_deposit_pct", t.avg_deposit_pct);
  if (depositResult) results.push(depositResult);

  // active_days_ratio
  if (periodDays > 0) {
    const activeDaysRatio = (t.active_days / periodDays) * 100;
    const adResult = buildMetricResult("active_days_ratio", activeDaysRatio);
    if (adResult) results.push(adResult);
  }

  // dials per day (total_messages / active_days)
  if (t.active_days > 0) {
    const dialsPerDay = t.total_messages / t.active_days;
    const dialsResult = buildMetricResult("total_messages", dialsPerDay);
    if (dialsResult) results.push(dialsResult);
  }

  // talk time per active day (SDR agents only — skip if 0)
  if (t.total_talk_time > 0 && t.active_days > 0) {
    const talkTimePerDay   = t.total_talk_time / t.active_days;
    const talkTimeResult   = buildMetricResult("total_talk_time", talkTimePerDay);
    if (talkTimeResult) results.push(talkTimeResult);
  }

  // bookings per active day
  if (t.active_days > 0) {
    const bkgPerDay = t.total_bookings / t.active_days;
    const bkgResult = buildMetricResult("bookings_per_active_day", bkgPerDay);
    if (bkgResult) results.push(bkgResult);
  }

  // avg_booking_eff (SDR only)
  if (t.avg_booking_eff > 0) {
    const bkgEffResult = buildMetricResult("bkg_eff_pct", t.avg_booking_eff);
    if (bkgEffResult) results.push(bkgEffResult);
  }

  // revenue per active day
  if (t.active_days > 0) {
    const revPerDay = t.total_sales / t.active_days;
    const revResult = buildMetricResult("revenue_per_active_day", revPerDay);
    if (revResult) results.push(revResult);
  }

  const overallRag = deriveOverallRag(results, CRITICAL_METRICS.individual);
  const verdict    = buildVerdict(overallRag, agent.name);
  const { wins, focusAreas } = partitionResults(results);

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

  const results: MetricResult[] = [];

  for (const brand of brands) {
    const d = brand.data;

    // unreadWhatsapp per brand
    const waResult = buildMetricResult(
      "unreadWhatsapp",
      d.unreadWhatsapp,
      `${brand.label} — Unread WhatsApp`
    );
    if (waResult) results.push({ ...waResult, key: `${brand.key}_unreadWhatsapp` });

    // unreadCrm per brand
    const crmResult = buildMetricResult(
      "unreadCrm",
      d.unreadCrm,
      `${brand.label} — Unread CRM SMS`
    );
    if (crmResult) results.push({ ...crmResult, key: `${brand.key}_unreadCrm` });

    // unreadEmail per brand
    const emailResult = buildMetricResult(
      "unreadEmail",
      d.unreadEmail,
      `${brand.label} — Unread Email`
    );
    if (emailResult) results.push({ ...emailResult, key: `${brand.key}_unreadEmail` });

    // newLeads per brand
    const leadsResult = buildMetricResult(
      "newLeads",
      d.newLeads,
      `${brand.label} — New Leads`
    );
    if (leadsResult) results.push({ ...leadsResult, key: `${brand.key}_newLeads` });

    // todoCount per brand
    const todoResult = buildMetricResult(
      "todoCount",
      d.todoCount,
      `${brand.label} — Follow-up Backlog`
    );
    if (todoResult) results.push({ ...todoResult, key: `${brand.key}_todoCount` });
  }

  // For the overall RAG, we check the worst state across all unread + leads + todo
  const allRags = results.map((r) => r.ragState);
  let overallRag: RAGState = "green";
  if (allRags.includes("red"))    overallRag = "red";
  else if (allRags.includes("yellow")) overallRag = "yellow";

  const verdict = buildVerdict(overallRag, "GHL Live Queue");
  const { wins, focusAreas } = partitionResults(results);

  return { overallRag, verdict, wins, focusAreas, insufficient: false };
}
