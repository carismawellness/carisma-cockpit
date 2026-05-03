/**
 * Biological Age Scorecard — the 8-number hero dashboard for the Health pillar.
 * Each metric has: value, optimal target band, last reading delta, status.
 */

export type AgeMetricStatus = "green" | "amber" | "red";

export interface AgeMetric {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  optimal: string;
  delta: string;
  status: AgeMetricStatus;
  rationale: string;
}

export interface BioAgeSeed {
  asOf: string;
  chronologicalAge: number;
  estimatedBioAge: number;
  paceOfAging: number;
  metrics: AgeMetric[];
  hrvTrend: { x: string; y: number }[];
  vo2Trend: { x: string; y: number }[];
}

export const biologicalAgeSeed: BioAgeSeed = {
  asOf: "2026-04-28",
  chronologicalAge: 35,
  estimatedBioAge: 31.4,
  paceOfAging: 0.91,
  metrics: [
    { key: "dunedin", label: "DunedinPACE", value: 0.91, unit: "yr/yr", optimal: "<0.95", delta: "▼ 0.04 vs 2025", status: "green", rationale: "Slowing biological aging — keep current routine" },
    { key: "vo2", label: "VO2 Max %ile", value: "92nd", unit: "for age", optimal: "top 2.5%", delta: "▲ from 88th", status: "amber", rationale: "Elite-for-age but not yet top 2.5%; add one zone-2 session" },
    { key: "apob", label: "ApoB", value: 88, unit: "mg/dL", optimal: "<60", delta: "▲ +12 vs 2024", status: "red", rationale: "Trending up — discuss statin or diet shift with PCP" },
    { key: "lpa", label: "Lp(a)", value: 18, unit: "nmol/L", optimal: "<75", delta: "(genetic, stable)", status: "green", rationale: "Low — major CVD risk lever already favorable" },
    { key: "almi", label: "DEXA ALMI", value: 9.2, unit: "kg/m²", optimal: ">8.5", delta: "▲ 0.3 vs 6mo", status: "green", rationale: "Sarcopenia defense on track" },
    { key: "grip", label: "Grip Strength", value: 56, unit: "kg dom.", optimal: ">55", delta: "▲ 2 vs 6mo", status: "green", rationale: "Above mortality threshold; keep loaded carries" },
    { key: "hba1c", label: "HbA1c + Insulin", value: "5.2 / 4.8", unit: "% / µIU", optimal: "<5.4 / <5", delta: "▼ 0.1 / ▼ 0.6", status: "green", rationale: "Metabolic flexibility excellent" },
    { key: "deepsleep", label: "Deep Sleep", value: 87, unit: "min/night", optimal: ">75", delta: "▲ 11 vs 90d ago", status: "green", rationale: "Glymphatic clearance window healthy" },
  ],
  hrvTrend: Array.from({ length: 90 }, (_, i) => ({
    x: `D${i - 89}`,
    y: Math.round(58 + Math.sin(i / 12) * 6 + (i / 90) * 4 + (Math.random() - 0.5) * 4),
  })),
  vo2Trend: [
    { x: "Jan 24", y: 42.1 },
    { x: "Jul 24", y: 44.6 },
    { x: "Jan 25", y: 45.8 },
    { x: "Jul 25", y: 46.9 },
    { x: "Jan 26", y: 47.5 },
    { x: "Apr 26", y: 48.2 },
  ],
};
