/**
 * Commentary Benchmarks — Operations Dashboard + EBITDA Dashboard
 *
 * Expert panel synthesised spec (build-time) for the Strategic Commentary Engine.
 * Benchmarks are specific to:
 *   - Luxury hotel spa in Malta (4-5★ hotel contexts)
 *   - Medical aesthetics / slimming clinic
 *   - Carisma's operational scale (10 locations, EUR 3.3M revenue)
 *
 * Edit this file to update thresholds or phrasing. The engine (engine.ts) reads
 * from here only — no duplicated numbers in components.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   OPERATIONS DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */

export type RAGState = "green" | "yellow" | "red";
export type TrendState = "improving" | "flat" | "declining" | "alarming";

export interface MetricSpec {
  label: string;
  unit: "pct" | "stars" | "count" | "eur" | "pp";
  direction: "higher_better" | "lower_better" | "zero_only";
  criticalFlag: boolean;
  worldClass: number;
  internalTarget: number;
  benchmarkBasis: string;
}

export interface PhrasingTemplate {
  green: string;
  yellow: string;
  red: string;
}

export const OPS_METRIC_SPECS: Record<string, MetricSpec> = {
  weightedAvg: {
    label: "Google Rating",
    unit: "stars",
    direction: "higher_better",
    criticalFlag: true,
    worldClass: 4.9,
    internalTarget: 4.8,
    benchmarkBasis:
      "Luxury hotel spa benchmark — Google Maps top quartile for Malta & Mediterranean hotel spas. " +
      "4.8★ is the credibility floor for premium positioning; 4.9★ = world-class.",
  },
  ratingDelta: {
    label: "Rating Trend (MoM)",
    unit: "stars",
    direction: "higher_better",
    criticalFlag: false,
    worldClass: 0.1,
    internalTarget: 0.0,
    benchmarkBasis:
      "Month-on-month delta derived from the ~1-month-earlier snapshot. Stable (0.0) is baseline; " +
      "any negative delta is a leading indicator that warrants investigation before it manifests in the rating.",
  },
  criticalCount: {
    label: "Critical Reviews (≤3★)",
    unit: "count",
    direction: "lower_better",
    criticalFlag: true,
    worldClass: 0,
    internalTarget: 0,
    benchmarkBasis:
      "Luxury spa standard: zero critical reviews per period. A single ≤3★ review at this rating level " +
      "(4.8★ avg) is statistically significant — each reduces the mean by ~0.1★ at our review volumes.",
  },
  noteworthyCount: {
    label: "Noteworthy Reviews (4★ + feedback)",
    unit: "count",
    direction: "lower_better",
    criticalFlag: false,
    worldClass: 0,
    internalTarget: 2,
    benchmarkBasis:
      "4★ reviews with written feedback contain service-gap signals that haven't yet shown in the " +
      "rating but will over time. Above 4 per period suggests a recurring theme requiring action.",
  },
  complimentaryPct: {
    label: "Complimentary %",
    unit: "pct",
    direction: "lower_better",
    criticalFlag: false,
    worldClass: 1.0,
    internalTarget: 2.0,
    benchmarkBasis:
      "Hotel spa industry standard: complimentary transactions <2% of total sales. " +
      "Reflects hotel partnership protocols and goodwill treatments. Above 4% implies unauthorised write-offs.",
  },
  cashPct: {
    label: "Cash Sales %",
    unit: "pct",
    direction: "lower_better",
    criticalFlag: false,
    worldClass: 6.0,
    internalTarget: 12.0,
    benchmarkBasis:
      "Malta hospitality compliance norm: cash <12% of total sales. World-class spa target is <6% " +
      "(minimises fraud, simplifies reconciliation). Each point above 12% materially elevates audit risk.",
  },
  discountedCashPct: {
    label: "Discounted Cash %",
    unit: "pct",
    direction: "lower_better",
    criticalFlag: true,
    worldClass: 2.0,
    internalTarget: 5.0,
    benchmarkBasis:
      "Cash discount transactions carry the highest leakage risk (discount + no digital trail). " +
      "Internal policy ceiling is 5%. Above 5% requires finance review. World-class target: <2%.",
  },
  delCancelledPct: {
    label: "Del. & Cancelled %",
    unit: "pct",
    direction: "lower_better",
    criticalFlag: false,
    worldClass: 3.0,
    internalTarget: 10.0,
    benchmarkBasis:
      "POS audit policy: deletions + cancellations combined <10% of total sales. " +
      "World-class spas maintain <3%. Above 10% may indicate overbooking, no-show policy failure, or POS manipulation.",
  },
  unattended: {
    label: "Unattended Sessions",
    unit: "count",
    direction: "zero_only",
    criticalFlag: true,
    worldClass: 0,
    internalTarget: 0,
    benchmarkBasis:
      "Zero tolerance. Unattended sessions represent both revenue leakage and a liability (guest safety). " +
      "Any count > 0 is an immediate operational failure requiring same-day correction.",
  },
  avgFacility: {
    label: "Facility Standards",
    unit: "pct",
    direction: "higher_better",
    criticalFlag: false,
    worldClass: 95,
    internalTarget: 85,
    benchmarkBasis:
      "Monthly internal audit checklist. 5★ hotel spa standard: ≥85% compliance. " +
      "World-class luxury spa operations achieve ≥95%. Below 60% indicates systemic maintenance failures.",
  },
  avgMystery: {
    label: "Mystery Guest Score",
    unit: "pct",
    direction: "higher_better",
    criticalFlag: true,
    worldClass: 90,
    internalTarget: 85,
    benchmarkBasis:
      "External mystery guest evaluator (third-party). International luxury spa benchmark: ≥85%. " +
      "World-class: ≥90%. This is the most externally credible quality signal — given it's unannounced, " +
      "it captures the true guest experience rather than prepared responses.",
  },
};

export const OPS_RAG_THRESHOLDS: Record<string, { green: number; yellow: number }> = {
  weightedAvg:       { green: 4.8,  yellow: 4.5  },
  ratingDelta:       { green: 0.0,  yellow: -0.1 },
  criticalCount:     { green: 0,    yellow: 2    },
  noteworthyCount:   { green: 0,    yellow: 4    },
  complimentaryPct:  { green: 2.0,  yellow: 4.0  },
  cashPct:           { green: 8.0,  yellow: 12.0 },
  discountedCashPct: { green: 3.0,  yellow: 5.0  },
  delCancelledPct:   { green: 5.0,  yellow: 10.0 },
  unattended:        { green: 0,    yellow: 0    },
  avgFacility:       { green: 85,   yellow: 60   },
  avgMystery:        { green: 85,   yellow: 60   },
};

export const OPS_TREND_THRESHOLDS = {
  improving:  3,
  flat_low:  -3,
  declining: -8,
  alarming:  -999,
};

export const OPS_TEMPLATES: Record<string, PhrasingTemplate> = {
  weightedAvg: {
    green:
      "Google rating of {{VALUE}} across all 10 locations is at or above the 4.8★ luxury benchmark — " +
      "reputation is a competitive advantage and the primary conversion driver for new guests.",
    yellow:
      "Google rating of {{VALUE}} is below the 4.8★ benchmark ({{DELTA}} vs prior month) — " +
      "lowest-rated location is {{LOCATION}} at {{LOCATION_SCORE}}; activate post-visit " +
      "review request flows and audit the service gap at the two lowest-rated locations this week.",
    red:
      "Google rating of {{VALUE}} has dropped below the 4.5★ credibility threshold ({{DELTA}} vs prior month) — " +
      "lowest performer: {{LOCATION}} at {{LOCATION_SCORE}}; convene a same-week service quality " +
      "review with all location managers and implement a 30-day recovery plan.",
  },
  ratingDelta: {
    green:
      "Rating trend is stable ({{VALUE}} vs prior month) — no erosion detected.",
    yellow:
      "Rating trend of {{VALUE}} signals gradual erosion month-on-month — " +
      "escalate mystery guest assessments to identify the service gap before the decline entrenches.",
    red:
      "Sharp rating decline of {{VALUE}} in a single month is anomalous — " +
      "check for a viral complaint, a staff incident, or a data error, then brief the operations director before the end of the week.",
  },
  criticalCount: {
    green:
      "Zero critical reviews (≤3★) in this period — reputation health is excellent.",
    yellow:
      "{{VALUE}} critical review(s) (≤3★) in {{PERIOD}} — read each one now, identify the location " +
      "and service type, respond publicly within 24 hours, and share feedback with the relevant manager.",
    red:
      "{{VALUE}} critical reviews (≤3★) in {{PERIOD}} signals a systemic service failure — " +
      "cluster reviews by location and complaint theme, brief managers within 48 hours, and commission " +
      "an unannounced mystery guest visit at the affected sites.",
  },
  noteworthyCount: {
    green:
      "No negative 4★ feedback requiring attention in this period.",
    yellow:
      "{{VALUE}} review(s) at 4★ with written feedback — read each one for recurring themes " +
      "that signal emerging issues before they reach critical status.",
    red:
      "{{VALUE}} reviews at 4★ with written feedback indicates a volume pattern of service gaps — " +
      "run a structured content analysis, identify the top 3 recurring themes, and feed findings into " +
      "the next mystery guest briefing and staff training agenda.",
  },
  complimentaryPct: {
    green:
      "Complimentary transactions at {{VALUE}} — within the <2% policy threshold.",
    yellow:
      "Complimentary at {{VALUE}} is above the 2% target — identify which locations and staff are " +
      "issuing the most complimentary services and confirm every instance has a manager sign-off record.",
    red:
      "Complimentary at {{VALUE}} materially exceeds the 2% policy ceiling — " +
      "audit authorisation logs for the month across all locations; this level suggests unauthorised " +
      "write-offs and requires an immediate finance review.",
  },
  cashPct: {
    green:
      "Cash sales at {{VALUE}} — within the <8% best-practice target.",
    yellow:
      "Cash sales at {{VALUE}} is approaching the 12% compliance ceiling — " +
      "identify which locations carry the highest cash ratio and verify POS reconciliation records.",
    red:
      "Cash sales at {{VALUE}} breaches the 12% compliance threshold — " +
      "flag immediately to finance for audit; cash above 12% significantly elevates fraud " +
      "and misappropriation exposure and must be corrected this period.",
  },
  discountedCashPct: {
    green:
      "Discounted cash transactions at {{VALUE}} — within the <3% best-practice range.",
    yellow:
      "Discounted cash at {{VALUE}} is approaching the 5% internal limit — " +
      "request manager-approved discount logs for the current month and verify each authorisation.",
    red:
      "Discounted cash at {{VALUE}} exceeds the 5% threshold — this combination carries " +
      "the highest revenue leakage risk; escalate to finance for review and re-certify the " +
      "discount authorisation policy with all managers this week.",
  },
  delCancelledPct: {
    green:
      "Deleted & cancelled transactions at {{VALUE}} — well below the 5% best-practice benchmark.",
    yellow:
      "Deleted & cancelled at {{VALUE}} is elevated above best practice but within the 10% policy ceiling — " +
      "identify which locations account for the bulk and check for booking platform issues or no-show policy gaps.",
    red:
      "Deleted & cancelled at {{VALUE}} exceeds the 10% compliance threshold — " +
      "review cancellation reasons by location; volumes at this level may indicate overbooking, " +
      "no-show policy failure, or POS manipulation and require a finance-led audit this month.",
  },
  unattended: {
    green:
      "Zero unattended sessions — full operational oversight is confirmed.",
    yellow:
      "",
    red:
      "{{VALUE}} unattended session(s) recorded — this is a simultaneous liability and revenue exposure; " +
      "identify each session and the responsible therapist today, correct the POS record, and " +
      "re-brief all location managers on the close-out protocol before end of week.",
  },
  avgFacility: {
    green:
      "Facility standards at {{VALUE}} — above the 85% internal target; maintain monthly re-assessment cadence.",
    yellow:
      "Facility standards at {{VALUE}} is below the 85% target — review the failed checklist " +
      "items by category, prioritise any item failing at multiple locations, and set a 4-week remediation target.",
    red:
      "Facility standards at {{VALUE}} is critically low — convene a facilities review this week, " +
      "share the full failed item list with each location manager, and institute daily spot-checks " +
      "until the score recovers above 60%.",
  },
  avgMystery: {
    green:
      "Mystery guest score at {{VALUE}} — above the 85% benchmark; the end-to-end guest " +
      "experience is operating at standard from an external evaluator's perspective.",
    yellow:
      "Mystery guest score at {{VALUE}} falls below the 85% benchmark — share the evaluator report " +
      "with location managers, identify the top 3 failing service dimensions, and schedule " +
      "a re-assessment within 6 weeks.",
    red:
      "Mystery guest score at {{VALUE}} is critically below standard — guest experience is failing on " +
      "key evaluated dimensions; brief the operations director this week, create a 30-day improvement " +
      "plan per location, and prioritise service-specific retraining.",
  },
};

export const OPS_TREND_TEMPLATES: Record<string, string> = {
  facilityTrend_declining:
    "Facility standards trend is declining ({{DELTA}} vs prior month) — " +
    "investigate root causes before the score reaches the 60% amber threshold.",
  facilityTrend_alarming:
    "Facility standards have dropped sharply ({{DELTA}} vs prior month) — " +
    "this rapid deterioration requires immediate attention; audit all locations and " +
    "suspend any recent changes to cleaning or maintenance protocols.",
  mysteryTrend_declining:
    "Mystery guest scores are trending down ({{DELTA}} vs prior month) — " +
    "escalate evaluator findings to managers and set a correction timeline.",
  mysteryTrend_alarming:
    "Mystery guest scores have collapsed ({{DELTA}} vs prior month) — " +
    "immediate executive review of the guest experience operating model is required.",
};

export const OPS_FOCUS_PRIORITY = [
  "unattended",
  "criticalCount",
  "weightedAvg",
  "avgMystery",
  "discountedCashPct",
  "delCancelledPct",
  "cashPct",
  "avgFacility",
  "complimentaryPct",
  "noteworthyCount",
  "ratingDelta",
  "mysteryTrend",
  "facilityTrend",
];

export const OPS_WINS_PRIORITY = [
  "weightedAvg",
  "criticalCount",
  "unattended",
  "avgMystery",
  "avgFacility",
  "discountedCashPct",
  "delCancelledPct",
  "cashPct",
  "complimentaryPct",
];

/* ═══════════════════════════════════════════════════════════════════════════
   EBITDA DASHBOARD — Strategic Commentary Config
   ═══════════════════════════════════════════════════════════════════════════
   Expert-panel synthesised benchmarks for the Carisma group P&L dashboard.
   Covers ebitda-v2 (current period) and ebitda-longitudinal (multi-month trend).

   Sources: ISPA 2024, BCG wellness ops benchmarks, European spa 2024,
   Carisma's own 2021-2025 CAGR of 15.6%.

   Thresholds are consistent with EbitdaSummaryHeader.tsx RAG colours:
     EBITDA margin: >=20% green, >=10% amber, <10% red

   For lower_is_better metrics, greenMin = the AT-OR-BELOW green ceiling;
   yellowMin = the AT-OR-BELOW yellow ceiling. engine.ts handles direction logic.
   ═══════════════════════════════════════════════════════════════════════════ */

export type RagState = "green" | "yellow" | "red";

export interface MetricConfig {
  key: string;
  label: string;
  unit: "%" | "EUR" | "ratio";
  benchmark: number;
  benchmarkBasis: string;
  /**
   * higher_is_better: value >= greenMin → green
   * lower_is_better:  value <= greenMin → green
   */
  greenMin: number;
  /**
   * higher_is_better: value >= yellowMin → yellow, else red
   * lower_is_better:  value <= yellowMin → yellow, else red
   */
  yellowMin: number;
  direction: "higher_is_better" | "lower_is_better";
  /** Placeholders: {value}, {benchmark} */
  templateGreen: string;
  templateYellow: string;
  templateRed: string;
  /** 1 = highest priority — drives verdict logic first */
  priority: number;
}

export const VERDICT_RULE =
  "RED if ANY metric with priority <= 3 is red, OR if 2 or more metrics are red total. " +
  "YELLOW if ANY metric with priority <= 2 is yellow, OR if 2 or more metrics are yellow total. " +
  "GREEN otherwise.";

export const EBITDA_COMMENTARY_CONFIG: MetricConfig[] = [
  {
    key: "ebitda_margin",
    label: "EBITDA Margin",
    unit: "%",
    benchmark: 20,
    benchmarkBasis:
      "Premium multi-location spa groups in European markets target 18-25% EBITDA margin. " +
      "For Carisma's blended model (spa + aesthetics + slimming) at Malta scale, 20% is the realistic world-class floor.",
    direction: "higher_is_better",
    greenMin: 20,
    yellowMin: 10,
    templateGreen:
      "EBITDA margin is {value}%, ahead of the {benchmark}% benchmark. Sustain cost discipline and consider reinvesting surplus into capacity or marketing.",
    templateYellow:
      "EBITDA margin is {value}%, below the {benchmark}% target. Review wages and SG&A against revenue mix and present a corrective plan within 2 weeks.",
    templateRed:
      "EBITDA margin is {value}%, critically below the {benchmark}% floor. Freeze discretionary spend and convene a cost review within 5 business days.",
    priority: 1,
  },
  {
    key: "revenueYoy",
    label: "Group Revenue YoY Growth",
    unit: "%",
    benchmark: 12,
    benchmarkBasis:
      "Midpoint of 8-18% organic YoY growth band for premium boutique wellness groups in Southern Europe (ISPA 2024). " +
      "Carisma's own 2021-2025 CAGR of 15.6% further validates 12% as a credible steady-state target.",
    direction: "higher_is_better",
    greenMin: 10,
    yellowMin: 3,
    templateGreen:
      "Revenue grew {value}% YoY, ahead of the {benchmark}% European wellness benchmark. The group is compounding market share in Malta.",
    templateYellow:
      "Revenue grew {value}% YoY, below the {benchmark}% benchmark. Review hotel-spa renewals, Aesthetics menu expansion, and Slimming pricing to accelerate before year-end.",
    templateRed:
      "Revenue is {value}% YoY vs +{benchmark}% benchmark. Audit top-3 revenue-losing venues and convene weekly recovery standups with all brand GMs immediately.",
    priority: 2,
  },
  {
    key: "wages_pct",
    label: "Wages & Salaries % of Revenue",
    unit: "%",
    benchmark: 47,
    benchmarkBasis:
      "Mid-point of 40-55% premium hotel spa range for a Malta service-heavy multi-location model (BCG wellness ops benchmarks, European spa 2024).",
    direction: "lower_is_better",
    greenMin: 48,
    yellowMin: 55,
    templateGreen:
      "Wages at {value}% of revenue, within the {benchmark}% benchmark. Labour efficiency is healthy; maintain scheduling discipline and therapist utilisation targets.",
    templateYellow:
      "Wages at {value}% of revenue, above the {benchmark}% benchmark. Review shift scheduling for under-utilised hours and therapist-to-room ratios before next payroll cycle.",
    templateRed:
      "Wages at {value}% of revenue, materially above the {benchmark}% benchmark. Conduct utilisation audit across all venues; freeze open headcount requisitions immediately.",
    priority: 3,
  },
  {
    key: "marketing_pct",
    label: "Marketing & Advertising % of Revenue",
    unit: "%",
    benchmark: 11,
    benchmarkBasis:
      "Mid-point of 8-14% scaling wellness D2C brand range, reflecting Carisma's current growth stage across Meta, Google, and Klaviyo channels.",
    direction: "lower_is_better",
    greenMin: 14,
    yellowMin: 18,
    templateGreen:
      "Marketing at {value}% of revenue, within efficient range. Continue optimising Meta and Google allocation based on blended CAC per brand.",
    templateYellow:
      "Marketing at {value}% of revenue, approaching the {benchmark}% upper bound. Review campaign-level ROAS; pause any ad sets below 2.5x ROAS before next budget cycle.",
    templateRed:
      "Marketing at {value}% of revenue, above sustainable levels. Pull last-30-day blended CAC per brand and pause lowest-ROAS ad sets immediately.",
    priority: 4,
  },
  {
    key: "rent_util_pct",
    label: "Rent & Utilities % of Revenue",
    unit: "%",
    benchmark: 20,
    benchmarkBasis:
      "Mid-point of 15-25% total occupancy cost for hotel-based spa; reflects Malta hotel commission/fixed-minimum hybrid lease model across 8 Spa venues plus Aesthetics and Slimming fixed sites.",
    direction: "lower_is_better",
    greenMin: 23,
    yellowMin: 28,
    templateGreen:
      "Rent & utilities at {value}% of revenue, within range for a hotel-based multi-venue model. Revenue growth is absorbing fixed costs efficiently.",
    templateYellow:
      "Rent & utilities at {value}% of revenue, above the {benchmark}% target. Review lowest-performing hotel venue contribution margin and check if minimum rent thresholds are triggering.",
    templateRed:
      "Rent & utilities at {value}% of revenue, unsustainable at current levels. Open renegotiation with hotel partners and assess reducing hours at loss-making venues.",
    priority: 5,
  },
  {
    key: "sga_pct",
    label: "SG&A % of Revenue",
    unit: "%",
    benchmark: 7,
    benchmarkBasis:
      "Mid-point of 5-10% lean multi-brand ops range for professional services, software, admin, and insurance at a 10-location EUR 3.3M group.",
    direction: "lower_is_better",
    greenMin: 10,
    yellowMin: 14,
    templateGreen:
      "SG&A at {value}% of revenue, lean overhead for a 10-location group. Maintain vendor contract discipline at annual renewal.",
    templateYellow:
      "SG&A at {value}% of revenue, above the {benchmark}% target. Audit software subscriptions and professional services retainers for duplication or deferrable spend.",
    templateRed:
      "SG&A at {value}% of revenue, disproportionate to current scale. Cancel or consolidate software tools and renegotiate any professional services contracts above EUR 1K/month this month.",
    priority: 6,
  },
  {
    key: "cogs_pct",
    label: "COGS % of Revenue",
    unit: "%",
    benchmark: 17,
    benchmarkBasis:
      "Mid-point of 12-22% spa COGS range; reflects Carisma's service-heavy mix with moderate retail and treatment consumables across 3 brands.",
    direction: "lower_is_better",
    greenMin: 20,
    yellowMin: 25,
    templateGreen:
      "COGS at {value}% of revenue, healthy product margin for the current treatment and retail mix. Review supplier contracts every 6 months.",
    templateYellow:
      "COGS at {value}% of revenue, approaching the {benchmark}% upper threshold. Review product usage per treatment and check for supplier price increases or waste above 5%.",
    templateRed:
      "COGS at {value}% of revenue, eroding gross margin. Renegotiate volume pricing with primary suppliers and audit treatment protocols for over-dispensing this month.",
    priority: 7,
  },
];

/* ══════════════════════════════════════════════════════════════════════════
   HR DASHBOARD — Strategic Commentary Benchmarks
   Expert panel: HR & Workforce Analyst, Revenue/Ops Analyst,
                 Attendance & Productivity Analyst (Jun 2026)
   Applies to: /hr and all nested HR dashboards
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * HR threshold descriptor — supports directional and range-based metrics.
 * For "range" direction: green = [green, greenMax], yellow = just outside green.
 */
export interface HRThreshold {
  direction: "higher_better" | "lower_better" | "range";
  green: number;
  greenMax?: number;
  yellow: number;
  yellowMax?: number;
  benchmark: number;
  unit: "pct" | "eur" | "count" | "hrs";
}

/* ── HR RAG Thresholds ───────────────────────────────────────────────────── */

export const HR_METRIC_THRESHOLDS: Record<string, HRThreshold> = {
  humanCapitalPct: {
    direction: "lower_better",
    green: 40, yellow: 47, benchmark: 40, unit: "pct",
  },
  avgCostPerEmployee: {
    direction: "lower_better",
    green: 1600, yellow: 1950, benchmark: 1600, unit: "eur",
  },
  revenuePerEmployee: {
    direction: "higher_better",
    green: 3700, yellow: 2960, benchmark: 3700, unit: "eur",
  },
  revpahSpa: {
    direction: "higher_better",
    green: 50, yellow: 38, benchmark: 50, unit: "eur",
  },
  revpahAesthetics: {
    direction: "higher_better",
    green: 70, yellow: 53, benchmark: 70, unit: "eur",
  },
  revpahSlimming: {
    direction: "higher_better",
    green: 35, yellow: 26, benchmark: 35, unit: "eur",
  },
  netMovement: {
    direction: "higher_better",
    green: 0, yellow: -2, benchmark: 0, unit: "count",
  },
  turnoverRate: {
    direction: "lower_better",
    green: 25, yellow: 40, benchmark: 25, unit: "pct",
  },
  therapistRatio: {
    direction: "range",
    green: 55, greenMax: 68, yellow: 48, yellowMax: 75, benchmark: 61.5, unit: "pct",
  },
  onTimePct: {
    direction: "higher_better",
    green: 90, yellow: 80, benchmark: 90, unit: "pct",
  },
  avgActivityPct: {
    direction: "higher_better",
    green: 85, yellow: 70, benchmark: 85, unit: "pct",
  },
};

/* ── HR Phrasing Templates ───────────────────────────────────────────────── */
// Slots: {{VAL}}, {{BENCHMARK}}, {{TARGET}}, {{DELTA}}
// Focus-area templates (yellow/red) MUST end with a concrete, owner-ready action.

export const HR_TEMPLATES: Record<string, PhrasingTemplate> = {
  humanCapitalPct: {
    green:
      "Human Capital % at {{VAL}} — within the ≤40% benchmark. Payroll discipline is strong.",
    yellow:
      "Human Capital % at {{VAL}}, {{DELTA}} above the 40% target — monitor payroll growth vs revenue; defer discretionary headcount additions.",
    red:
      "Human Capital % at {{VAL}} is critically above the 40% ceiling — payroll is outpacing revenue; review headcount plan with CFO and pause non-essential hiring.",
  },
  avgCostPerEmployee: {
    green:
      "Avg cost/employee at {{VAL}}/mo — within the ≤{{BENCHMARK}} benchmark for the Malta wellness market.",
    yellow:
      "Avg cost/employee at {{VAL}}/mo, {{DELTA}} above the {{BENCHMARK}} benchmark — review overtime and bonus patterns across locations.",
    red:
      "Avg cost/employee at {{VAL}}/mo exceeds the {{BENCHMARK}} ceiling — audit pay structure, overtime, and allowances; present corrective plan to CFO within 2 weeks.",
  },
  revenuePerEmployee: {
    green:
      "Revenue/employee at {{VAL}}/mo — above the {{BENCHMARK}} productivity benchmark. Workforce size is well-matched to revenue.",
    yellow:
      "Revenue/employee at {{VAL}}/mo, {{DELTA}} below benchmark — check whether recent headcount additions are aligned with confirmed revenue growth.",
    red:
      "Revenue/employee at {{VAL}}/mo is significantly below benchmark — workforce is over-indexed vs revenue; freeze non-essential hiring and review current roster utilisation.",
  },
  revpahSpa: {
    green:
      "Spa RevPAH at {{VAL}}/hr — at or above the {{BENCHMARK}} target. Therapist utilisation is healthy.",
    yellow:
      "Spa RevPAH at {{VAL}}/hr, {{DELTA}} below the {{BENCHMARK}} target — review scheduling gaps and cancellation rates; consider shoulder-hour promotions.",
    red:
      "Spa RevPAH at {{VAL}}/hr is critically below target — audit therapist roster vs confirmed bookings, check no-show rates, and escalate to Spa GM within 48 hours.",
  },
  revpahAesthetics: {
    green:
      "Aesthetics RevPAH at {{VAL}}/hr — above the {{BENCHMARK}} target. Clinic utilisation is strong.",
    yellow:
      "Aesthetics RevPAH at {{VAL}}/hr, {{DELTA}} below the {{BENCHMARK}} target — review unfilled practitioner slots and assess treatment-mix shift to lower-ticket services.",
    red:
      "Aesthetics RevPAH at {{VAL}}/hr is critically below target — audit booked vs available practitioner hours, check cancellation rates, and escalate to Aesthetics GM within 72 hours.",
  },
  revpahSlimming: {
    green:
      "Slimming RevPAH at {{VAL}}/hr — at or above the {{BENCHMARK}} target. Session scheduling is on track.",
    yellow:
      "Slimming RevPAH at {{VAL}}/hr, {{DELTA}} below the {{BENCHMARK}} target — check session density and whether package redemptions are outpacing new sales.",
    red:
      "Slimming RevPAH at {{VAL}}/hr is critically below target — review therapist roster vs bookings, check machine utilisation, and escalate to Slimming GM within 48 hours.",
  },
  netMovement: {
    green:
      "Net employee movement at {{VAL}} over the period — headcount is stable or growing.",
    yellow:
      "Net movement at {{VAL}} — slight net contraction; review leaver reasons and identify preventable exits.",
    red:
      "Net movement at {{VAL}} — significant workforce contraction; run an exit-interview analysis and present a retention plan to CHRO within 1 week.",
  },
  turnoverRate: {
    green:
      "Annualised turnover at {{VAL}}% — within the ≤{{BENCHMARK}}% top-quartile benchmark for this market.",
    yellow:
      "Annualised turnover at {{VAL}}%, {{DELTA}} above the {{BENCHMARK}}% benchmark — review exit patterns by brand and location, and assess retention incentives.",
    red:
      "Annualised turnover at {{VAL}}% is critical — run a structured exit-interview analysis, identify the top departure reasons, and present a retention plan to CHRO within 2 weeks.",
  },
  therapistRatio: {
    green:
      "Therapist ratio at {{VAL}}% of total headcount — within the 55–68% optimal band. Staffing mix is well-balanced.",
    yellow:
      "Therapist ratio at {{VAL}}%, outside the 55–68% target band — review role distribution; below 55% indicates excessive overhead, above 68% risks service quality.",
    red:
      "Therapist ratio at {{VAL}}% is significantly outside the 55–68% band — reassess role distribution and review all open headcount requests before approving non-therapist hires.",
  },
  onTimePct: {
    green:
      "On-time arrival at {{VAL}}% — above the {{BENCHMARK}}% threshold. Punctuality is strong across all sites.",
    yellow:
      "On-time arrival at {{VAL}}%, {{DELTA}} below the {{BENCHMARK}}% target — review late patterns by site and shift; check transport or access issues at affected locations.",
    red:
      "On-time arrival at {{VAL}}% is below safe levels — this risks hotel SLA compliance; escalate to Operations Manager and issue formal attendance notices within 48 hours.",
  },
  avgActivityPct: {
    green:
      "Office team activity at {{VAL}}% — above the {{BENCHMARK}}% benchmark. CRM and back-office throughput is on track.",
    yellow:
      "Office team activity at {{VAL}}%, {{DELTA}} below benchmark — check CRM task volume, rule out tool downtime, and verify task assignment is evenly distributed.",
    red:
      "Office team activity at {{VAL}}% is critically low — conduct 1-on-1 check-ins with outlier team members and audit task queues before drawing performance conclusions.",
  },
};

/* ── HR Focus / Wins Priority ────────────────────────────────────────────── */

export const HR_FOCUS_PRIORITY = [
  "humanCapitalPct",      // 1 — direct P&L impact, CEO/CFO visibility
  "revenuePerEmployee",   // 2 — workforce productivity ratio
  "revpahSpa",            // 3 — largest brand by revenue
  "revpahAesthetics",     // 4
  "revpahSlimming",       // 5
  "turnoverRate",         // 6 — talent retention risk
  "netMovement",          // 7 — immediate headcount signal
  "onTimePct",            // 8 — SLA / hotel partner compliance
  "avgCostPerEmployee",   // 9 — cost structure
  "therapistRatio",       // 10 — staffing mix
  "avgActivityPct",       // 11 — office productivity
];

export const HR_WINS_PRIORITY = [
  "revenuePerEmployee",   // 1 — workforce productivity win
  "humanCapitalPct",      // 2 — payroll discipline
  "revpahSpa",            // 3
  "revpahAesthetics",     // 4
  "revpahSlimming",       // 5
  "onTimePct",            // 6 — SLA compliance
  "turnoverRate",         // 7 — retention strength
  "netMovement",          // 8 — headcount growth
  "avgCostPerEmployee",   // 9
  "therapistRatio",       // 10
  "avgActivityPct",       // 11
];

/* ═══════════════════════════════════════════════════════════════════════════
   MARKETING DASHBOARD  (/marketing + brand sub-pages)
   Expert panel: paid media analyst + email specialist
   All CPL thresholds from kpi_thresholds.json + adjusted for Malta market.
   ROAS = platform-attributed (leads × avg_deal_value / spend).
   ═══════════════════════════════════════════════════════════════════════════ */

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

export const MKT_TEMPLATES: Record<
  string,
  { green: string; yellow: string; red: string }
> = {
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
  "roas",
  "cpl",
  "fatigueHealthyPct",
  "cpc",
  "emailOpenRate",
  "emailClickRate",
];

export const MKT_WINS_PRIORITY: string[] = [
  "roas",
  "emailOpenRate",
  "emailClickRate",
  "fatigueHealthyPct",
  "cpl",
  "cpc",
];

/* ═══════════════════════════════════════════════════════════════════════════
   CRM AGENT COMMENTARY ENGINE
   Benchmarks for SDR / Chat-agent performance metrics used by engine.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MetricBenchmark {
  label: string;
  unit: string;
  higherIsBetter: boolean;
  benchmark: number;
  green: number;
  yellow: number;
  priority: number;
  templates: {
    green: string;
    yellow: string;
    red: string;
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
