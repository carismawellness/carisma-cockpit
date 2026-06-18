/**
 * Operations Dashboard — Commentary Benchmarks & Phrasing Templates
 *
 * Spec produced by a build-time expert panel (3 domain specialists + synthesiser):
 *   • Hospitality & wellness ratings strategist (Google Reviews)
 *   • Financial controls expert (Diligence Audit)
 *   • Luxury spa quality consultant (Facility / Mystery Guest)
 *
 * Benchmarks calibrated to:
 *   • Hotel spa in Malta (4-5★ hotel-partnership model)
 *   • Medical aesthetics / slimming clinic
 *   • Carisma scale: 10 locations, EUR 3.3M revenue, 5,400+ reviews
 *
 * NO numbers appear anywhere else — edit here and the engine + UI react.
 */

export type RAGState   = "green" | "yellow" | "red" | "insufficient";
export type TrendState = "improving" | "flat" | "declining" | "alarming";

export interface MetricSpec {
  label:           string;
  unit:            "pct" | "stars" | "count" | "eur" | "pp";
  direction:       "higher_better" | "lower_better" | "zero_only";
  criticalFlag:    boolean;
  worldClass:      number;
  internalTarget:  number;
  benchmarkBasis:  string;
}

export interface PhrasingTemplate {
  green:  string;
  yellow: string;
  red:          string;
  insufficient?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   OPERATIONS DASHBOARD
   ══════════════════════════════════════════════════════════════════════════ */

export const OPS_METRIC_SPECS: Record<string, MetricSpec> = {
  weightedAvg: {
    label:          "Google Rating",
    unit:           "stars",
    direction:      "higher_better",
    criticalFlag:   true,
    worldClass:     4.8,
    internalTarget: 4.5,
    benchmarkBasis:
      "Google Maps hospitality category — Malta hotel-spa top quartile. " +
      "4.5★ is the market-expectation floor for hotel-affiliated spas; 4.8★ = world-class.",
  },
  ratingDelta: {
    label:          "Rating Trend (MoM)",
    unit:           "stars",
    direction:      "higher_better",
    criticalFlag:   false,
    worldClass:     0.03,
    internalTarget: 0.0,
    benchmarkBasis:
      "At 5,400+ reviews a 0.05-star swing requires ~270 reviews shifting distribution — " +
      "material moves are real service signals, not noise.",
  },
  criticalCount: {
    label:          "Critical Reviews (≤3★)",
    unit:           "count",
    direction:      "lower_better",
    criticalFlag:   true,
    worldClass:     1,
    internalTarget: 2,
    benchmarkBasis:
      "Industry NPS data: ~5% luxury wellness guests report dissatisfaction. At ~500 monthly " +
      "visits across 10 locations, 2–4 critical reviews = 99%+ satisfaction rate.",
  },
  noteworthyCount: {
    label:          "Noteworthy Reviews (4★ + text)",
    unit:           "count",
    direction:      "lower_better",
    criticalFlag:   false,
    worldClass:     8,
    internalTarget: 8,
    benchmarkBasis:
      "4★-with-text represents ~20–30% of reviews at our velocity. Tracking themes " +
      "prevents them becoming 3★ patterns. Above 15/period signals recurring service gap.",
  },
  complimentaryPct: {
    label:          "Complimentary %",
    unit:           "pct",
    direction:      "lower_better",
    criticalFlag:   false,
    worldClass:     0.5,
    internalTarget: 2.0,
    benchmarkBasis:
      "Hotel spa comps are contractually governed. World-class (Six Senses, Four Seasons): <0.5% " +
      "because every comp requires GM countersignature. Above 4% implies unauthorised write-offs.",
  },
  cashPct: {
    label:          "Cash Sales %",
    unit:           "pct",
    direction:      "lower_better",
    criticalFlag:   false,
    worldClass:     5.0,
    internalTarget: 12.0,
    benchmarkBasis:
      "Malta hospitality runs higher cash than Northern Europe (cultural norm, tourist cash). " +
      "12% is the operational ceiling; above 18% triggers VAT audit risk under Maltese Revenue guidelines.",
  },
  discountedCashPct: {
    label:          "Discounted Cash %",
    unit:           "pct",
    direction:      "lower_better",
    criticalFlag:   true,
    worldClass:     1.5,
    internalTarget: 5.0,
    benchmarkBasis:
      "Highest-risk POS fraud vector (cash + discount = no audit trail). Target <5%; " +
      "<1.5% achievable with dual-authorisation controls.",
  },
  delCancelledPct: {
    label:          "Del. & Cancelled %",
    unit:           "pct",
    direction:      "lower_better",
    criticalFlag:   false,
    worldClass:     3.0,
    internalTarget: 10.0,
    benchmarkBasis:
      "Hotel spa industry norm <10%; above 15% indicates undertrained staff or systematic " +
      "void-to-pocket patterns.",
  },
  unattended: {
    label:          "Unattended Sessions",
    unit:           "count",
    direction:      "zero_only",
    criticalFlag:   true,
    worldClass:     0,
    internalTarget: 0,
    benchmarkBasis:
      "No acceptable non-zero value. An unattended POS session = treatment delivered without " +
      "a transaction record — direct revenue leakage + liability, regardless of count.",
  },
  avgFacility: {
    label:          "Facility Standards",
    unit:           "pct",
    direction:      "higher_better",
    criticalFlag:   false,
    worldClass:     92,
    internalTarget: 88,
    benchmarkBasis:
      "Monthly internal audit (self-administered, scores higher than external). " +
      "92%+ = genuine operational discipline; 75%+ = operational baseline.",
  },
  avgMystery: {
    label:          "Mystery Guest Score",
    unit:           "pct",
    direction:      "higher_better",
    criticalFlag:   true,
    worldClass:     82,
    internalTarget: 78,
    benchmarkBasis:
      "External mystery guest evaluator. 78%+ = good; 82%+ = Condé Nast Award-level. " +
      "65% red threshold: below this, hotel-partnership contract renewal risk begins.",
  },
};

/* ── RAG Threshold Cutoffs ──────────────────────────────────────────────────
   higher_better: green >= .green, yellow >= .yellow, red < .yellow
   lower_better:  green <= .green, yellow <= .yellow, red > .yellow
   zero_only:     green = 0, yellow 1-2, red >= 3
   ─────────────────────────────────────────────────────────────────────────── */

export const OPS_RAG_THRESHOLDS: Record<string, { green: number; yellow: number }> = {
  weightedAvg:       { green: 4.5,  yellow: 4.2  },
  ratingDelta:       { green: -0.01, yellow: -0.05 },
  criticalCount:     { green: 2,    yellow: 5    },
  noteworthyCount:   { green: 8,    yellow: 15   },
  complimentaryPct:  { green: 2.0,  yellow: 4.0  },
  cashPct:           { green: 12.0, yellow: 18.0 },
  discountedCashPct: { green: 5.0,  yellow: 7.0  },
  delCancelledPct:   { green: 10.0, yellow: 15.0 },
  unattended:        { green: 0,    yellow: 2    },
  avgFacility:       { green: 88,   yellow: 75   },
  avgMystery:        { green: 78,   yellow: 65   },
};

/* ── Trend Detection Thresholds (pp month-over-month) ─────────────────────── */

export const OPS_FACILITY_TREND_THRESHOLDS = {
  improving:  2,
  flat_min:  -2,
  declining: -5,
  alarming:  -999,
};

export const OPS_MYSTERY_TREND_THRESHOLDS = {
  improving:  3,
  flat_min:  -3,
  declining: -7,
  alarming:  -999,
};

/* ── Phrasing Templates ─────────────────────────────────────────────────────
   Slots: {{VALUE}}, {{BENCHMARK}}, {{DELTA}}, {{LOCATION}}, {{LOCATION_SCORE}}, {{PERIOD}}, {{GAP}}
   ─────────────────────────────────────────────────────────────────────────── */

export const OPS_TEMPLATES: Record<string, PhrasingTemplate> = {
  weightedAvg: {
    green:
      "Weighted Google rating of {{VALUE}} is above the 4.5★ Malta hotel-spa benchmark — " +
      "reputation is intact and Google Maps local-pack visibility is protected.",
    yellow:
      "Weighted rating of {{VALUE}} sits below the 4.5★ Malta benchmark " +
      "({{DELTA}} vs prior month); lowest performer is {{LOCATION}} at {{LOCATION_SCORE}} — " +
      "activate a targeted post-visit review request sequence at underperforming sites " +
      "and audit the last 30 days of reviews at {{LOCATION}} within 48 hours.",
    red:
      "Weighted rating of {{VALUE}} is below the 4.2★ threshold and risks suppressing " +
      "Google Maps local-pack visibility — escalate a cross-location service review, " +
      "prioritise {{LOCATION}} ({{LOCATION_SCORE}}), and increase response rate on all " +
      "negative reviews to ≤24 hours this week.",
  },
  ratingDelta: {
    green:
      "Month-on-month rating movement of {{VALUE}} is stable — no corrective action required.",
    yellow:
      "Rating has dipped {{VALUE}} this month — cross-reference the critical review log to " +
      "determine whether the decline is location-specific or service-category-wide, " +
      "and brief location managers by end of week.",
    red:
      "Rating decline of {{VALUE}} is statistically significant at our review volume — " +
      "convene an operations review within 72 hours, identify the location driving the drop, " +
      "and implement a response protocol before the decline compounds into a second consecutive negative month.",
  },
  criticalCount: {
    green:
      "{{VALUE}} critical review(s) (≤3★) this period — within the expected range; " +
      "scan texts for recurring triggers before archiving.",
    yellow:
      "{{VALUE}} critical reviews (≤3★) this period exceeds baseline — categorise by " +
      "location and service type, and close the loop with a manager response on each within 24 hours.",
    red:
      "{{VALUE}} critical reviews (≤3★) this period signals a systemic service failure — " +
      "map by location and time-of-day, escalate to the GM within today's operations briefing, " +
      "and commission an unannounced mystery guest visit at the affected sites.",
  },
  noteworthyCount: {
    green:
      "{{VALUE}} noteworthy 4★ review(s) with written feedback — low volume; scan texts " +
      "for any single recurring friction to pre-empt a future negative trend.",
    yellow:
      "{{VALUE}} noteworthy 4★ reviews this period — extract the 3 most common friction " +
      "themes and assign one process owner per theme with a 2-week resolution deadline.",
    red:
      "{{VALUE}} noteworthy 4★ reviews indicates a persistent service gap across locations — " +
      "conduct a thematic cluster analysis, identify the top 2 systemic causes, and incorporate " +
      "into the next monthly brand standards briefing.",
  },
  complimentaryPct: {
    green:
      "Complimentary transactions at {{VALUE}} — within the 2% policy threshold; " +
      "override controls are functioning.",
    yellow:
      "Complimentary at {{VALUE}} ({{DELTA}} above the 2% ceiling) — review manager " +
      "authorisation logs for the past 30 days and obtain written justification for each comp event.",
    red:
      "Complimentary at {{VALUE}} indicates a critical override control failure — suspend " +
      "complimentary authorisation rights for all non-GM staff immediately and commission " +
      "a full audit covering the current month and prior two months.",
  },
  cashPct: {
    green:
      "Cash sales at {{VALUE}} — within the 12% operational ceiling for Malta hospitality.",
    yellow:
      "Cash sales at {{VALUE}} is approaching the 18% VAT-compliance threshold — " +
      "conduct a till reconciliation audit for high-cash days and verify all cash " +
      "transactions have matching signed slips in end-of-day closure reports.",
    red:
      "Cash sales at {{VALUE}} significantly exceeds the 18% ceiling and creates VAT " +
      "compliance exposure — escalate to the Finance Director, freeze unreported cash " +
      "handling procedures, and commission an unannounced spot audit within 5 business days.",
  },
  discountedCashPct: {
    green:
      "Discounted cash at {{VALUE}} — dual-authorisation discount policies are being applied correctly.",
    yellow:
      "Discounted cash at {{VALUE}} (approaching the 7% concern threshold) — identify " +
      "which staff applied discounts without system-generated authorisation codes " +
      "and schedule retraining within 14 days.",
    red:
      "Discounted cash at {{VALUE}} — the highest-risk POS pattern for revenue leakage; " +
      "suspend manual discount capability in the POS system immediately and cross-reference " +
      "all discounted cash transactions with therapist schedules to identify discrepancies.",
  },
  delCancelledPct: {
    green:
      "Deleted & cancelled at {{VALUE}} — within operational tolerances; POS accuracy is confirmed.",
    yellow:
      "Deleted & cancelled at {{VALUE}} (above the 10% benchmark) — pull a void report by " +
      "staff member and identify whether deletions cluster around specific shift times or " +
      "individuals; deliver targeted retraining within 7 days.",
    red:
      "Deleted & cancelled at {{VALUE}} indicates a potential systematic void-to-pocket pattern — " +
      "freeze self-service void permissions, require manager counter-void for all future " +
      "deletions, and submit the void log to the Finance Director for forensic review.",
  },
  unattended: {
    green:
      "No unattended POS sessions — all treatments have complete transaction records; " +
      "full POS session discipline confirmed.",
    yellow:
      "{{VALUE}} unattended POS session(s) detected — probable system glitch but investigation " +
      "is required; identify the affected terminal and shift, confirm whether an alternate " +
      "transaction record exists, and report findings to the Operations Director within 48 hours.",
    red:
      "{{VALUE}} unattended POS session(s) — each represents a treatment delivered without " +
      "a logged transaction; lock down terminals requiring mandatory session close, investigate " +
      "each event within 48 hours, and report to the Operations Director.",
  },
  avgFacility: {
    green:
      "Facility standards at {{VALUE}} — above the 88% control threshold; internal " +
      "compliance is consistent across locations.",
    yellow:
      "Facility compliance at {{VALUE}} is below the 88% threshold — {{LOCATION}} is the " +
      "current drag point at {{LOCATION_SCORE}}; conduct a targeted audit of failing checklist " +
      "categories at underperforming locations before next review cycle.",
    red:
      "Facility standards at {{VALUE}} indicate a systemic compliance failure — at this " +
      "level internal audit results likely understate actual conditions; immediate " +
      "location-by-location review required.",
  },
  avgMystery: {
    green:
      "Mystery guest score at {{VALUE}} confirms the guest experience is being delivered " +
      "at brand standard from an external evaluator's perspective.",
    yellow:
      "Mystery guest at {{VALUE}} signals guest experience inconsistencies not fully captured " +
      "by internal audits — review mystery report categories against facility checklist items " +
      "and schedule a re-assessment within 6 weeks.",
    red:
      "Mystery guest at {{VALUE}} is a brand-risk signal: guests are experiencing material " +
      "gaps between the Carisma positioning and actual delivery; brief the operations director " +
      "this week, create a 30-day improvement plan per location, and prioritise " +
      "service-specific retraining.",
  },
};

/* ── Trend Templates (surfaced for declining/alarming only) */

export const OPS_TREND_TEMPLATES: Record<string, string> = {
  facilityTrend_declining:
    "Facility standards declining {{DELTA}} vs prior month — investigate root causes " +
    "before the score approaches the 75% amber threshold.",
  facilityTrend_alarming:
    "Facility standards dropped sharply ({{DELTA}} vs prior month) — this velocity of " +
    "decline is outside normal variation; audit all locations and identify whether the " +
    "driver is concentrated (location issue) or diffuse (systemic).",
  mysteryTrend_declining:
    "Mystery guest scores trending down {{DELTA}} — confirm comparable location-mix " +
    "before acting; if the same locations were evaluated, this is a real service signal " +
    "requiring escalation this cycle.",
  mysteryTrend_alarming:
    "Mystery guest scores have collapsed {{DELTA}} — even accounting for visit-mix " +
    "variability, this requires immediate executive review of the guest experience model.",
};

/* ── Anomaly Template ────────────────────────────────────────────────────── */

export const OPS_ANOMALY_TEMPLATE_CALIBRATION_GAP =
  "⚠️ Internal facility compliance is green ({{FACILITY_VALUE}}) while mystery guest is red " +
  "({{MYSTERY_VALUE}}) — the checklist is not measuring the right things; " +
  "cross-reference failing mystery categories against facility checklist items before acting on either score.";

/* ── Focus Area & Wins Priority Lists ─────────────────────────────────────── */

export const OPS_FOCUS_PRIORITY = [
  "unattended",
  "discountedCashPct",
  "cashPct",
  "avgMystery",
  "weightedAvg",
  "delCancelledPct",
  "avgFacility",
  "ratingDelta",
  "criticalCount",
  "complimentaryPct",
  "noteworthyCount",
  "mysteryTrend",
  "facilityTrend",
];

export const OPS_WINS_PRIORITY = [
  "unattended",
  "weightedAvg",
  "avgMystery",
  "discountedCashPct",
  "avgFacility",
  "cashPct",
  "delCancelledPct",
  "complimentaryPct",
  "criticalCount",
];

/* ══════════════════════════════════════════════════════════════════════════
   EBITDA DASHBOARD (preserved from prior session)
   ══════════════════════════════════════════════════════════════════════════ */

export type RagState = RAGState;

export interface MetricConfig {
  key:           string;
  label:         string;
  direction:     "higher_is_better" | "lower_is_better";
  greenMin:      number;
  yellowMin:     number;
  benchmark:     number;
  priority:      number;
  templateGreen:  string;
  templateYellow: string;
  templateRed:    string;
}

export const EBITDA_COMMENTARY_CONFIG: MetricConfig[] = [
  {
    key:       "ebitda_margin",
    label:     "EBITDA Margin",
    direction: "higher_is_better",
    greenMin:  15,
    yellowMin: 8,
    benchmark: 15,
    priority:  1,
    templateGreen:  "EBITDA margin of {value}% meets the {benchmark}% target — profitability is on track.",
    templateYellow: "EBITDA margin of {value}% is below the {benchmark}% target — review cost drivers this period.",
    templateRed:    "EBITDA margin of {value}% is critically low — immediate cost review required to protect cash position.",
  },
  {
    key:       "revenueYoy",
    label:     "Revenue Growth (YoY)",
    direction: "higher_is_better",
    greenMin:  5,
    yellowMin: 0,
    benchmark: 10,
    priority:  2,
    templateGreen:  "Revenue grew {value}% year-on-year — growth momentum is positive.",
    templateYellow: "Revenue growth of {value}% YoY is below the {benchmark}% target — investigate volume or pricing.",
    templateRed:    "Revenue is declining {value}% YoY — urgent action required on pipeline or pricing strategy.",
  },
  {
    key:       "wages_pct",
    label:     "Wages % of Revenue",
    direction: "lower_is_better",
    greenMin:  45,
    yellowMin: 52,
    benchmark: 45,
    priority:  3,
    templateGreen:  "Labour cost at {value}% of revenue — within the {benchmark}% target.",
    templateYellow: "Labour cost at {value}% of revenue is above target — review staffing levels and scheduling efficiency.",
    templateRed:    "Labour cost at {value}% of revenue is critically high — staffing rationalisation needed immediately.",
  },
  {
    key:       "marketing_pct",
    label:     "Marketing % of Revenue",
    direction: "lower_is_better",
    greenMin:  10,
    yellowMin: 15,
    benchmark: 10,
    priority:  4,
    templateGreen:  "Marketing spend at {value}% of revenue — within budget.",
    templateYellow: "Marketing at {value}% of revenue exceeds the {benchmark}% guideline — review campaign ROI.",
    templateRed:    "Marketing at {value}% of revenue is unsustainable — audit campaigns and pause low-performers.",
  },
  {
    key:       "sga_pct",
    label:     "SG&A % of Revenue",
    direction: "lower_is_better",
    greenMin:  12,
    yellowMin: 18,
    benchmark: 12,
    priority:  5,
    templateGreen:  "SG&A at {value}% of revenue — overhead is controlled.",
    templateYellow: "SG&A at {value}% of revenue is above target — review administrative overhead.",
    templateRed:    "SG&A at {value}% of revenue requires immediate cost review.",
  },
  {
    key:       "cogs_pct",
    label:     "COGS % of Revenue",
    direction: "lower_is_better",
    greenMin:  15,
    yellowMin: 22,
    benchmark: 15,
    priority:  6,
    templateGreen:  "COGS at {value}% of revenue — product costs are well-managed.",
    templateYellow: "COGS at {value}% of revenue is above target — review supplier pricing and product mix.",
    templateRed:    "COGS at {value}% of revenue is critically high — supplier review required.",
  },
  {
    key:       "rent_util_pct",
    label:     "Rent & Utilities % of Revenue",
    direction: "lower_is_better",
    greenMin:  12,
    yellowMin: 18,
    benchmark: 12,
    priority:  7,
    templateGreen:  "Occupancy costs at {value}% of revenue — fixed cost base is manageable.",
    templateYellow: "Occupancy costs at {value}% of revenue are above target — evaluate lease renegotiation options.",
    templateRed:    "Occupancy costs at {value}% of revenue require structural review.",
  },
];

/* ── HR Dashboard Benchmarks ──────────────────────────────────────────────── */

export interface HRThreshold {
  green:     number;
  greenMax?: number;
  yellow:    number;
  yellowMax?: number;
  benchmark: number;
  direction: "higher_better" | "lower_better" | "range";
  unit:      "pct" | "eur" | "hrs" | "count";
}

export const HR_METRIC_THRESHOLDS: Record<string, HRThreshold> = {
  humanCapitalPct: {
    green: 40, greenMax: 55, yellow: 35, yellowMax: 62,
    benchmark: 47, direction: "range", unit: "pct",
  },
  avgCostPerEmployee: {
    green: 1400, greenMax: 1900, yellow: 1200, yellowMax: 2200,
    benchmark: 1650, direction: "range", unit: "eur",
  },
  revenuePerEmployee: {
    green: 3500, yellow: 2800, benchmark: 3500, direction: "higher_better", unit: "eur",
  },
  revpahSpa: {
    green: 38, yellow: 28, benchmark: 38, direction: "higher_better", unit: "eur",
  },
  revpahAesthetics: {
    green: 55, yellow: 40, benchmark: 55, direction: "higher_better", unit: "eur",
  },
  revpahSlimming: {
    green: 45, yellow: 32, benchmark: 45, direction: "higher_better", unit: "eur",
  },
  netMovement: {
    green: 0, greenMax: 2, yellow: -2, yellowMax: 5,
    benchmark: 1, direction: "range", unit: "count",
  },
  turnoverRate: {
    green: 25, yellow: 40, benchmark: 25, direction: "lower_better", unit: "pct",
  },
  therapistRatio: {
    green: 65, yellow: 55, benchmark: 65, direction: "higher_better", unit: "pct",
  },
  onTimePct: {
    green: 85, yellow: 75, benchmark: 85, direction: "higher_better", unit: "pct",
  },
  avgActivityPct: {
    green: 70, yellow: 55, benchmark: 70, direction: "higher_better", unit: "pct",
  },
};

export const HR_TEMPLATES: Record<string, Record<string, string>> = {
  humanCapitalPct: {
    green:  "Human capital at {{VAL}} of revenue — within the 40–55% wellness industry range for Malta.",
    yellow: "Human capital at {{VAL}} — outside the 40–55% target range; review staffing mix or service volume.",
    red:    "Human capital at {{VAL}} is critically outside range — immediate workforce cost audit required.",
  },
  avgCostPerEmployee: {
    green:  "Average cost per employee at {{VAL}} — within the €1,400–1,900 benchmark range.",
    yellow: "Average cost per employee at {{VAL}} deviates from the €1,400–1,900 range — review payroll components.",
    red:    "Average cost per employee at {{VAL}} is significantly outside range — escalate to HR and Finance.",
  },
  revenuePerEmployee: {
    green:  "Revenue per employee at {{VAL}} — above the {{TARGET}} productivity benchmark.",
    yellow: "Revenue per employee at {{VAL}} is below the {{TARGET}} target — review scheduling efficiency.",
    red:    "Revenue per employee at {{VAL}} indicates low productivity — workforce utilisation review required.",
  },
  revpahSpa: {
    green:  "Spa RevPAH at {{VAL}} — above the {{TARGET}} benchmark; therapist productivity is strong.",
    yellow: "Spa RevPAH at {{VAL}} is below the {{TARGET}} target — review appointment density and upsell.",
    red:    "Spa RevPAH at {{VAL}} is critically low — immediate scheduling and pricing review required.",
  },
  revpahAesthetics: {
    green:  "Aesthetics RevPAH at {{VAL}} — above the {{TARGET}} benchmark.",
    yellow: "Aesthetics RevPAH at {{VAL}} is below the {{TARGET}} target — review treatment slot utilisation.",
    red:    "Aesthetics RevPAH at {{VAL}} requires urgent attention — consult and treatment volume review needed.",
  },
  revpahSlimming: {
    green:  "Slimming RevPAH at {{VAL}} — above the {{TARGET}} benchmark.",
    yellow: "Slimming RevPAH at {{VAL}} is below the {{TARGET}} target — review programme adherence rates.",
    red:    "Slimming RevPAH at {{VAL}} is critically low — programme structure and pricing review required.",
  },
  netMovement: {
    green:  "Net headcount movement of {{VAL}} — within the stable range; workforce is balanced.",
    yellow: "Net headcount movement of {{VAL}} — monitor for retention risk or over-hiring pressure.",
    red:    "Net headcount movement of {{VAL}} — significant workforce instability; escalate to HR immediately.",
  },
  turnoverRate: {
    green:  "Annualised turnover at {{VAL}} — within the wellness industry norm of <25%.",
    yellow: "Annualised turnover at {{VAL}} exceeds the 25% benchmark — review exit interview themes.",
    red:    "Annualised turnover at {{VAL}} is critically high — retention crisis; commission engagement survey.",
  },
  therapistRatio: {
    green:  "Therapist ratio at {{VAL}} — revenue-generating staff proportion is healthy.",
    yellow: "Therapist ratio at {{VAL}} is below the {{TARGET}} target — review support-to-therapist balance.",
    red:    "Therapist ratio at {{VAL}} — too many non-revenue staff; restructuring review required.",
  },
  onTimePct: {
    green:  "On-time attendance at {{VAL}} — scheduling discipline is strong across teams.",
    yellow: "On-time attendance at {{VAL}} is below the {{TARGET}} target — address punctuality with managers.",
    red:    "On-time attendance at {{VAL}} indicates a systemic punctuality issue — formal attendance policy review.",
  },
  avgActivityPct: {
    green:  "Team activity at {{VAL}} — workforce is productively engaged.",
    yellow: "Team activity at {{VAL}} is below the {{TARGET}} target — review task allocation and idle time.",
    red:    "Team activity at {{VAL}} indicates significant underutilisation — workload redistribution required.",
  },
};

export const HR_FOCUS_PRIORITY = [
  "turnoverRate", "humanCapitalPct", "onTimePct", "therapistRatio",
  "avgActivityPct", "revpahSpa", "revpahAesthetics", "revpahSlimming",
  "revenuePerEmployee", "netMovement", "avgCostPerEmployee",
];

export const HR_WINS_PRIORITY = [
  "revenuePerEmployee", "revpahSpa", "revpahAesthetics", "revpahSlimming",
  "humanCapitalPct", "therapistRatio", "onTimePct", "avgActivityPct",
  "turnoverRate", "netMovement", "avgCostPerEmployee",
];

/* ══════════════════════════════════════════════════════════════════════════
   MARKETING DASHBOARD (re-instated from prior session)
   ══════════════════════════════════════════════════════════════════════════ */

export type MktRagState = "green" | "yellow" | "red";

export const MKT_RAG_THRESHOLDS = {
  roas:              { green: 6.0,  yellow: 3.5,  direction: "higher_better" as const },
  cplBlended:        { green: 10,   yellow: 18,   direction: "lower_better"  as const },
  cplSpa:            { green: 8,    yellow: 12,   direction: "lower_better"  as const },
  cplAesthetics:     { green: 12,   yellow: 18,   direction: "lower_better"  as const },
  cplSlimming:       { green: 9.20, yellow: 13.80, direction: "lower_better" as const },
  cpc:               { green: 1.20, yellow: 2.00, direction: "lower_better"  as const },
  fatigueHealthyPct: { green: 70,   yellow: 40,   direction: "higher_better" as const },
  emailOpenRate:     { green: 25,   yellow: 20,   direction: "higher_better" as const },
  emailClickRate:    { green: 3.5,  yellow: 2.3,  direction: "higher_better" as const },
} as const;

export const MKT_KILL_THRESHOLDS = {
  cplSpa: 16,
  cplAesthetics: 24,
  cplSlimming: 18.40,
  roasMin: 2.0,
};

export const MKT_TEMPLATES: Record<string, { green: string; yellow: string; red: string }> = {
  roas: {
    green:  "ROAS at {{VALUE}} — above target ({{BENCHMARK}}x). Platform attribution is healthy; no immediate budget changes needed.",
    yellow: "ROAS at {{VALUE}} — below target ({{BENCHMARK}}x). Review audience quality and bid strategy → test lookalike audiences or tighten interest targeting.",
    red:    "ROAS at {{VALUE}} — approaching kill threshold ({{KILL}}x). Pause underperforming ad sets immediately and audit creative fatigue before injecting more budget.",
  },
  cpl: {
    green:  "{{BRAND}} Meta CPL at {{VALUE}} — within target (≤{{BENCHMARK}}). Lead volume and quality are holding; maintain current bid caps.",
    yellow: "{{BRAND}} Meta CPL at {{VALUE}} — above target ({{BENCHMARK}}). Refresh the 3 highest-spend creatives and test a new hook → aim to get CPL below {{BENCHMARK}} within 7 days.",
    red:    "{{BRAND}} Meta CPL at {{VALUE}} — above kill threshold ({{KILL}}). Pause campaigns, diagnose the CPL spike, and launch new creative before reopening spend.",
  },
  cpc: {
    green:  "Google CPC at {{VALUE}} — on target (≤{{BENCHMARK}}). Search intent quality is strong; maintain keyword match types.",
    yellow: "Google CPC at {{VALUE}} — above target ({{BENCHMARK}}). Review search terms report for irrelevant queries → add negatives and tighten to Exact/Phrase match.",
    red:    "Google CPC at {{VALUE}} — significantly above target. Pause broad-match campaigns, rebuild with tighter keywords, and set manual CPC caps → implied CPL at {{IMPLIED_CPL}}.",
  },
  fatigueHealthyPct: {
    green:  "{{VALUE}} of campaigns are healthy — creative rotation is working well.",
    yellow: "Only {{VALUE}} of campaigns are healthy — schedule a creative refresh for Watch-status ad sets within 7 days.",
    red:    "Less than {{VALUE}} of campaigns are healthy — pause fatigued ad sets, launch 3–5 new creatives per brand this week.",
  },
  emailOpenRate: {
    green:  "Email open rate at {{VALUE}} — above industry benchmark ({{BENCHMARK}}%). Sender reputation is strong; keep current send cadence.",
    yellow: "Email open rate at {{VALUE}} — near floor ({{BENCHMARK}}%). A/B test subject lines with urgency or personalisation to lift opens before it drops further.",
    red:    "Email open rate at {{VALUE}} — below floor. Sunset unengaged contacts (>180 days), run a re-engagement sequence, then resume regular sends → protects deliverability.",
  },
  emailClickRate: {
    green:  "Email click rate at {{VALUE}} — above benchmark ({{BENCHMARK}}%). CTA placement and offer are landing.",
    yellow: "Email click rate at {{VALUE}} — below benchmark ({{BENCHMARK}}%). Test a single prominent CTA above-the-fold instead of multiple competing links.",
    red:    "Email click rate at {{VALUE}} — critically low. Rebuild emails with one hero offer, one CTA, and a benefit-led headline → test against control next send.",
  },
};

export const MKT_FOCUS_PRIORITY: string[] = [
  "roas", "cpl", "fatigueHealthyPct", "cpc", "emailOpenRate", "emailClickRate",
];

export const MKT_WINS_PRIORITY: string[] = [
  "roas", "emailOpenRate", "emailClickRate", "fatigueHealthyPct", "cpl", "cpc",
];

/* ══════════════════════════════════════════════════════════════════════════
   CRM AGENT COMMENTARY — benchmarks (re-instated from prior session)
   ══════════════════════════════════════════════════════════════════════════ */

export interface MetricBenchmark {
  label:          string;
  unit:           string;
  higherIsBetter: boolean;
  benchmark:      number;
  green:          number;
  yellow:         number;
  priority:       number;
  templates: {
    green:  string;
    yellow: string;
    red:          string;
  insufficient?: string;
  };
}

export const BENCHMARK_BY_KEY: Record<string, MetricBenchmark> = {
  avg_conv_pct: {
    label: "Avg Conversion Rate", unit: "%", higherIsBetter: true,
    benchmark: 25, green: 25, yellow: 15, priority: 1,
    templates: {
      green:  "Conversion rate is {value}%, above the {benchmark}% target.",
      yellow: "Conversion rate is {value}%, below the {benchmark}% target. Review objection-handling scripts and increase follow-up frequency.",
      red:    "Conversion rate is {value}%, critically below the {benchmark}% target. Escalate for script review and live call coaching this week.",
    },
  },
  avg_deposit_pct: {
    label: "Deposit Conversion Rate", unit: "%", higherIsBetter: true,
    benchmark: 60, green: 60, yellow: 40, priority: 2,
    templates: {
      green:  "Deposit rate is {value}%, above the {benchmark}% benchmark.",
      yellow: "Deposit rate is {value}%, below the {benchmark}% benchmark. Reinforce urgency and limited-slot messaging.",
      red:    "Deposit rate is {value}%, critically below {benchmark}%. Introduce deposit-first booking policy.",
    },
  },
  bkg_eff_pct: {
    label: "Booking Efficiency", unit: "%", higherIsBetter: true,
    benchmark: 50, green: 50, yellow: 30, priority: 3,
    templates: {
      green:  "Booking efficiency is {value}%, above the {benchmark}% target.",
      yellow: "Booking efficiency is {value}%, below the {benchmark}% target. Audit call duration and pre-call preparation.",
      red:    "Booking efficiency is {value}%, critically below {benchmark}%. Conduct call shadow sessions.",
    },
  },
  total_messages: {
    label: "Messages / Dials per Day", unit: "dials", higherIsBetter: true,
    benchmark: 30, green: 30, yellow: 20, priority: 4,
    templates: {
      green:  "Daily activity is {value} dials/messages, at or above the {benchmark} target.",
      yellow: "Daily activity is {value} dials/messages, below the {benchmark} target. Review time-blocking.",
      red:    "Daily activity is {value} dials/messages, critically below {benchmark}. Reset daily dial minimums immediately.",
    },
  },
  total_talk_time: {
    label: "Talk Time per Active Day", unit: "min/day", higherIsBetter: true,
    benchmark: 90, green: 90, yellow: 60, priority: 5,
    templates: {
      green:  "Talk time is {value} min/day, above the {benchmark}-minute target.",
      yellow: "Talk time is {value} min/day, below {benchmark} minutes. Increase live-conversation attempts.",
      red:    "Talk time is {value} min/day, critically below {benchmark} minutes. Audit dial list quality.",
    },
  },
  total_bookings: {
    label: "Total Bookings", unit: "bookings", higherIsBetter: true,
    benchmark: 10, green: 10, yellow: 5, priority: 6,
    templates: {
      green:  "Team secured {value} bookings in the period, above the {benchmark} target.",
      yellow: "Team secured {value} bookings, below the {benchmark} target. Increase top-of-funnel activity.",
      red:    "Team secured {value} bookings, critically below {benchmark}. Convene a same-day team huddle.",
    },
  },
  total_deposits: {
    label: "Deposits Collected", unit: "deposits", higherIsBetter: true,
    benchmark: 8, green: 8, yellow: 4, priority: 7,
    templates: {
      green:  "Team collected {value} deposits, above the {benchmark} target.",
      yellow: "Team collected {value} deposits, below {benchmark}. Follow up on unconfirmed bookings within 24 hours.",
      red:    "Only {value} deposits collected vs {benchmark} target. Chase unpaid bookings immediately.",
    },
  },
  team_concentration_risk: {
    label: "Top-2 Agent Booking Concentration", unit: "%", higherIsBetter: false,
    benchmark: 60, green: 60, yellow: 75, priority: 8,
    templates: {
      green:  "Top-2 agents account for {value}% of bookings — healthy distribution.",
      yellow: "Top-2 agents account for {value}% of bookings, approaching concentration risk at {benchmark}%.",
      red:    "Top-2 agents account for {value}% — high concentration risk above {benchmark}%. Build depth across all agents.",
    },
  },
  inactive_agents_count: {
    label: "Inactive Agents", unit: "agents", higherIsBetter: false,
    benchmark: 0, green: 0, yellow: 1, priority: 9,
    templates: {
      green:  "No inactive agents this period — full team engagement.",
      yellow: "{value} agent(s) recorded no activity. Follow up to confirm availability.",
      red:    "{value} agents recorded zero activity. Immediate manager check-in required.",
    },
  },
  active_days_ratio: {
    label: "Active Days Ratio", unit: "%", higherIsBetter: true,
    benchmark: 80, green: 80, yellow: 60, priority: 3,
    templates: {
      green:  "Active on {value}% of working days — strong consistency.",
      yellow: "Active on {value}% of working days, below the {benchmark}% target.",
      red:    "Active on only {value}% of working days — well below {benchmark}%. Escalate immediately.",
    },
  },
  bookings_per_active_day: {
    label: "Bookings per Active Day", unit: "bookings/day", higherIsBetter: true,
    benchmark: 1.0, green: 1.0, yellow: 0.5, priority: 2,
    templates: {
      green:  "Averaging {value} bookings/day, above the {benchmark} target.",
      yellow: "Averaging {value} bookings/day, below {benchmark}. Increase same-day follow-up attempts.",
      red:    "Averaging {value} bookings/day, critically below {benchmark}. Review lead assignments.",
    },
  },
  revenue_per_active_day: {
    label: "Agent Revenue per Active Day", unit: "EUR/day", higherIsBetter: true,
    benchmark: 300, green: 300, yellow: 150, priority: 4,
    templates: {
      green:  "Generating €{value}/active day, above the €{benchmark} target.",
      yellow: "Generating €{value}/active day, below €{benchmark}. Review treatment mix.",
      red:    "Generating €{value}/active day, critically below €{benchmark}. Audit lead quality.",
    },
  },
  unreadWhatsapp: {
    label: "Unread WhatsApp Messages", unit: "messages", higherIsBetter: false,
    benchmark: 0, green: 5, yellow: 15, priority: 1,
    templates: {
      green:  "{value} unread WhatsApp messages — inbox is under control.",
      yellow: "{value} unread WhatsApp messages — approaching backlog. Clear within 2 hours.",
      red:    "{value} unread WhatsApp messages — critical backlog. All agents must prioritise immediately.",
    },
  },
  unreadCrm: {
    label: "Unread CRM SMS", unit: "messages", higherIsBetter: false,
    benchmark: 0, green: 5, yellow: 15, priority: 2,
    templates: {
      green:  "{value} unread CRM SMS — inbox current.",
      yellow: "{value} unread CRM SMS — growing backlog. Clear queue before end of shift.",
      red:    "{value} unread CRM SMS — critical. Pause outbound and clear inbound queue first.",
    },
  },
  unreadEmail: {
    label: "Unread Email", unit: "messages", higherIsBetter: false,
    benchmark: 0, green: 10, yellow: 30, priority: 3,
    templates: {
      green:  "{value} unread emails — inbox healthy.",
      yellow: "{value} unread emails — moderate backlog. Triage within 4 hours.",
      red:    "{value} unread emails — high backlog. Assign dedicated email responder today.",
    },
  },
  newLeads: {
    label: "New Leads (Last 7 Days)", unit: "leads/week", higherIsBetter: true,
    benchmark: 20, green: 20, yellow: 10, priority: 4,
    templates: {
      green:  "{value} new leads this week, above the {benchmark} target.",
      yellow: "Only {value} new leads this week, below {benchmark}. Review ad spend.",
      red:    "Only {value} new leads this week — critically below {benchmark}. Investigate top-of-funnel urgently.",
    },
  },
  todoCount: {
    label: "Follow-up Backlog", unit: "contacts", higherIsBetter: false,
    benchmark: 0, green: 10, yellow: 25, priority: 5,
    templates: {
      green:  "{value} follow-up tasks pending — manageable backlog.",
      yellow: "{value} follow-up tasks overdue. Block 1 hour to batch-process.",
      red:    "{value} follow-up tasks overdue — critical backlog. All agents must clear tasks immediately.",
    },
  },
};

export const CRITICAL_METRICS = {
  team:       ["avg_conv_pct", "total_bookings", "team_concentration_risk"] as const,
  individual: ["avg_conv_pct", "bookings_per_active_day", "active_days_ratio"] as const,
} as const;

export const CRM_AGENT_BENCHMARKS = BENCHMARK_BY_KEY;
