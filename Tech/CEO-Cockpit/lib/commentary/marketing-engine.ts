/**
 * Marketing Commentary Engine
 * /marketing  /marketing/spa  /marketing/aesthetics  /marketing/slimming
 *
 * Pure deterministic function — no runtime LLM/API calls.
 * Recomputes on every date filter change.
 * Thresholds live in benchmarks.ts (MKT_* exports).
 */

import type { MktRagState } from "./benchmarks";
export type { MktRagState };
import {
  MKT_RAG_THRESHOLDS,
  MKT_KILL_THRESHOLDS,
  MKT_TEMPLATES,
  MKT_FOCUS_PRIORITY,
  MKT_WINS_PRIORITY,
} from "./benchmarks";

/* ── Input types ─────────────────────────────────────────────────────────── */

export interface MktFatigueStats {
  healthy: number;
  watch: number;
  fatigued: number;
}

export interface MktPaidChannelInput {
  totalSpend: number;
  totalLeads: number;           // Meta = leads; Google = conversions
  attributedRevenue: number;
  fatigueStats: MktFatigueStats;
}

export interface MktEmailInput {
  openRate: number;             // 0–1 decimal (0.27 = 27%)
  clickRate: number;            // 0–1 decimal
  hasData: boolean;
}

export interface BrandMarketingInput {
  brand: "spa" | "aesthetics" | "slimming";
  meta: MktPaidChannelInput;
  google: MktPaidChannelInput;
  email: MktEmailInput;
}

export interface MasterMarketingInput {
  spa: BrandMarketingInput;
  aesthetics: BrandMarketingInput;
  slimming: BrandMarketingInput;
}

/* ── Output types ─────────────────────────────────────────────────────────── */

export interface MktCommentarySignal {
  key: string;
  metric: string;
  rag: MktRagState;
  value: string;
  insight: string;
}

export interface MktCommentaryResult {
  overallRag: MktRagState;
  verdict: string;
  workingWell: string[];
  focusAreas: string[];
  signals: MktCommentarySignal[];
  hasData: boolean;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function mktClassify(
  value: number,
  threshold: { green: number; yellow: number; direction: "higher_better" | "lower_better" },
): MktRagState {
  if (threshold.direction === "higher_better") {
    if (value >= threshold.green) return "green";
    if (value >= threshold.yellow) return "yellow";
    return "red";
  }
  if (value <= threshold.green) return "green";
  if (value <= threshold.yellow) return "yellow";
  return "red";
}

function mktFill(template: string, slots: Record<string, string>): string {
  return Object.entries(slots).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(v), template);
}

function mktFmtEur(v: number): string { return `€${v < 10 ? v.toFixed(1) : v.toFixed(0)}`; }
function mktFmtPct(v: number): string { return `${v.toFixed(1)}%`; }
function mktFmtX(v: number): string   { return `${v.toFixed(1)}x`; }

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ── Signal builders ─────────────────────────────────────────────────────── */

function mktRoasSignal(roas: number): MktCommentarySignal {
  const rag = mktClassify(roas, MKT_RAG_THRESHOLDS.roas);
  const value = mktFmtX(roas);
  const insight = mktFill(MKT_TEMPLATES.roas[rag], {
    VALUE: value,
    BENCHMARK: mktFmtX(MKT_RAG_THRESHOLDS.roas.green),
    KILL: mktFmtX(MKT_KILL_THRESHOLDS.roasMin),
  });
  return { key: "roas", metric: "Blended ROAS", rag, value, insight };
}

function mktCplSignal(cpl: number, brand?: "spa" | "aesthetics" | "slimming"): MktCommentarySignal {
  type CplKey = "cplSpa" | "cplAesthetics" | "cplSlimming" | "cplBlended";
  const thKey: CplKey = brand ? (`cpl${cap(brand)}`) as CplKey : "cplBlended";
  const threshold = MKT_RAG_THRESHOLDS[thKey];
  type KillKey = "cplSpa" | "cplAesthetics" | "cplSlimming";
  const killKey = brand ? (`cpl${cap(brand)}`) as KillKey : null;
  const kill = killKey && killKey in MKT_KILL_THRESHOLDS ? MKT_KILL_THRESHOLDS[killKey] : 18;
  const rag = mktClassify(cpl, threshold);
  const value = mktFmtEur(cpl);
  const insight = mktFill(MKT_TEMPLATES.cpl[rag], {
    VALUE: value,
    BENCHMARK: mktFmtEur(threshold.green),
    BRAND: brand ? cap(brand) : "Blended",
    KILL: mktFmtEur(kill),
  });
  return { key: "cpl", metric: "Meta CPL", rag, value, insight };
}

function mktCpcSignal(cpc: number): MktCommentarySignal {
  const rag = mktClassify(cpc, MKT_RAG_THRESHOLDS.cpc);
  const value = mktFmtEur(cpc);
  const insight = mktFill(MKT_TEMPLATES.cpc[rag], {
    VALUE: value,
    BENCHMARK: mktFmtEur(MKT_RAG_THRESHOLDS.cpc.green),
    IMPLIED_CPL: (cpc / 0.04).toFixed(0),
  });
  return { key: "cpc", metric: "Google CPC", rag, value, insight };
}

function mktFatigueSignal(stats: MktFatigueStats): MktCommentarySignal {
  const total = stats.healthy + stats.watch + stats.fatigued;
  if (total === 0) {
    return { key: "fatigueHealthyPct", metric: "Creative Health", rag: "green", value: "—", insight: "No campaigns tracked." };
  }
  const pct = (stats.healthy / total) * 100;
  const rag = mktClassify(pct, MKT_RAG_THRESHOLDS.fatigueHealthyPct);
  const value = `${stats.healthy}/${total} (${mktFmtPct(pct)})`;
  const insight = mktFill(MKT_TEMPLATES.fatigueHealthyPct[rag], { VALUE: mktFmtPct(pct) });
  return { key: "fatigueHealthyPct", metric: "Creative Health", rag, value, insight };
}

function mktEmailOpenSignal(openRate: number): MktCommentarySignal {
  const pct = openRate * 100;
  const rag = mktClassify(pct, MKT_RAG_THRESHOLDS.emailOpenRate);
  const value = mktFmtPct(pct);
  const insight = mktFill(MKT_TEMPLATES.emailOpenRate[rag], {
    VALUE: value,
    BENCHMARK: String(MKT_RAG_THRESHOLDS.emailOpenRate.yellow),
  });
  return { key: "emailOpenRate", metric: "Email Open Rate", rag, value, insight };
}

function mktEmailClickSignal(clickRate: number): MktCommentarySignal {
  const pct = clickRate * 100;
  const rag = mktClassify(pct, MKT_RAG_THRESHOLDS.emailClickRate);
  const value = mktFmtPct(pct);
  const insight = mktFill(MKT_TEMPLATES.emailClickRate[rag], {
    VALUE: value,
    BENCHMARK: String(MKT_RAG_THRESHOLDS.emailClickRate.yellow),
  });
  return { key: "emailClickRate", metric: "Email Click Rate", rag, value, insight };
}

function combineFatigue(a: MktFatigueStats, b: MktFatigueStats): MktFatigueStats {
  return { healthy: a.healthy + b.healthy, watch: a.watch + b.watch, fatigued: a.fatigued + b.fatigued };
}

/* ── Result builder ──────────────────────────────────────────────────────── */

function buildResult(signals: MktCommentarySignal[], roasValue: number, hasData: boolean): MktCommentaryResult {
  if (!hasData || signals.length === 0) {
    return { overallRag: "green", verdict: "No campaign data available for the selected period.", workingWell: [], focusAreas: [], signals: [], hasData: false };
  }

  const sorted = [...signals].sort((a, b) => {
    const w = (r: MktRagState) => (r === "red" ? 3 : r === "yellow" ? 2 : 1);
    const d = w(b.rag) - w(a.rag);
    if (d !== 0) return d;
    const ai = MKT_FOCUS_PRIORITY.indexOf(a.key);
    const bi = MKT_FOCUS_PRIORITY.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const overallRag: MktRagState =
    sorted.some(s => s.rag === "red") ? "red" :
    sorted.some(s => s.rag === "yellow") ? "yellow" : "green";

  const roasStr = roasValue > 0 ? mktFmtX(roasValue) : "—";
  const redSignals = sorted.filter(s => s.rag === "red");

  let verdict: string;
  if (overallRag === "green") {
    verdict = `Paid marketing is performing above target — blended ROAS at ${roasStr}. No immediate actions required.`;
  } else if (overallRag === "yellow") {
    const flags = sorted.filter(s => s.rag !== "green").map(s => s.metric).slice(0, 2).join(" and ");
    verdict = `Marketing performance is mixed — ${flags} need attention before they deteriorate further.`;
  } else {
    const redMetrics = redSignals.map(s => s.metric).slice(0, 2).join(" and ");
    verdict = `${redMetrics} ${redSignals.length > 1 ? "are" : "is"} below target — immediate review required to protect lead cost and ROI.`;
  }

  const winOrder = [...sorted]
    .filter(s => s.rag === "green")
    .sort((a, b) => {
      const ai = MKT_WINS_PRIORITY.indexOf(a.key);
      const bi = MKT_WINS_PRIORITY.indexOf(b.key);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  const workingWell = winOrder.slice(0, 3).map(s => s.insight);
  const focusAreas  = sorted.filter(s => s.rag !== "green").slice(0, 3).map(s => s.insight);

  return { overallRag, verdict, workingWell, focusAreas, signals: sorted, hasData: true };
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Commentary for a single brand page (/marketing/spa|aesthetics|slimming) */
export function computeBrandCommentary(input: BrandMarketingInput): MktCommentaryResult {
  const { brand, meta, google, email } = input;

  const totalSpend   = meta.totalSpend + google.totalSpend;
  const totalRevenue = meta.attributedRevenue + google.attributedRevenue;
  const blendedRoas  = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const metaCpl      = meta.totalLeads  > 0 ? meta.totalSpend  / meta.totalLeads  : 0;
  const googleCpc    = google.totalLeads > 0 ? google.totalSpend / google.totalLeads : 0;
  const fatigue      = combineFatigue(meta.fatigueStats, google.fatigueStats);
  const hasData      = totalSpend > 0 || email.hasData;

  const signals: MktCommentarySignal[] = [];
  if (totalSpend > 0) {
    signals.push(mktRoasSignal(blendedRoas));
    if (metaCpl  > 0) signals.push(mktCplSignal(metaCpl, brand));
    if (googleCpc > 0) signals.push(mktCpcSignal(googleCpc));
  }
  if (fatigue.healthy + fatigue.watch + fatigue.fatigued > 0) signals.push(mktFatigueSignal(fatigue));
  if (email.hasData) {
    if (email.openRate  > 0) signals.push(mktEmailOpenSignal(email.openRate));
    if (email.clickRate > 0) signals.push(mktEmailClickSignal(email.clickRate));
  }

  return buildResult(signals, blendedRoas, hasData);
}

/** Commentary for the master marketing overview (/marketing) */
export function computeMasterCommentary(input: MasterMarketingInput): MktCommentaryResult {
  const brands = ["spa", "aesthetics", "slimming"] as const;

  let totalSpend = 0, totalRevenue = 0;
  let totalMetaSpend = 0, totalMetaLeads = 0;
  let totalGoogleSpend = 0, totalGoogleLeads = 0;
  let totalFatigue: MktFatigueStats = { healthy: 0, watch: 0, fatigued: 0 };
  let emailOpenSum = 0, emailClickSum = 0, emailBrandCount = 0;

  for (const b of brands) {
    const m = input[b];
    totalSpend       += m.meta.totalSpend + m.google.totalSpend;
    totalRevenue     += m.meta.attributedRevenue + m.google.attributedRevenue;
    totalMetaSpend   += m.meta.totalSpend;
    totalMetaLeads   += m.meta.totalLeads;
    totalGoogleSpend += m.google.totalSpend;
    totalGoogleLeads += m.google.totalLeads;
    totalFatigue = combineFatigue(totalFatigue, combineFatigue(m.meta.fatigueStats, m.google.fatigueStats));
    if (m.email.hasData && m.email.openRate > 0) {
      emailOpenSum  += m.email.openRate;
      emailClickSum += m.email.clickRate;
      emailBrandCount++;
    }
  }

  const blendedRoas = totalSpend      > 0 ? totalRevenue    / totalSpend      : 0;
  const blendedCpl  = totalMetaLeads  > 0 ? totalMetaSpend  / totalMetaLeads  : 0;
  const blendedCpc  = totalGoogleLeads > 0 ? totalGoogleSpend / totalGoogleLeads : 0;
  const hasData     = totalSpend > 0 || emailBrandCount > 0;

  const signals: MktCommentarySignal[] = [];
  if (totalSpend > 0) {
    signals.push(mktRoasSignal(blendedRoas));
    if (blendedCpl  > 0) signals.push(mktCplSignal(blendedCpl));
    if (blendedCpc  > 0) signals.push(mktCpcSignal(blendedCpc));
  }
  if (totalFatigue.healthy + totalFatigue.watch + totalFatigue.fatigued > 0) signals.push(mktFatigueSignal(totalFatigue));
  if (emailBrandCount > 0) {
    const avgOpen  = emailOpenSum  / emailBrandCount;
    const avgClick = emailClickSum / emailBrandCount;
    signals.push(mktEmailOpenSignal(avgOpen));
    if (avgClick > 0) signals.push(mktEmailClickSignal(avgClick));
  }

  return buildResult(signals, blendedRoas, hasData);
}
