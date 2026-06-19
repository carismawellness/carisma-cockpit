/**
 * Funnel constraint detection — identifies the biggest bottleneck
 * in each brand's funnel by comparing stage conversion rates
 * against benchmarks.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FunnelStage {
  label: string;
  value: number;
  /** Conversion rate FROM previous stage TO this stage (%) */
  conversionPct: number | null;
}

export interface Constraint {
  stage: string;
  actual: number;
  benchmark: number;
  gap: number; // negative = below benchmark
  severity: "green" | "amber" | "red";
}

export interface BrandFunnel {
  brand: string;
  stages: FunnelStage[];
  constraint: Constraint | null;
  /** Overall lead-to-booking conversion (user benchmark: 20%) */
  overallConversionPct: number;
  /** Average leads per day per agent */
  leadsPerDayPerAgent: number;
}

/* ------------------------------------------------------------------ */
/*  Benchmarks                                                         */
/* ------------------------------------------------------------------ */

/** Stage-level conversion benchmarks (%) */
export const STAGE_BENCHMARKS: Record<string, number> = {
  // Shared stages
  "Lead → Contacted": 85,
  "Contacted → Qualified": 60,
  "Qualified → Consult Booked": 50,
  "Consult Booked → Consult Showed": 75,
  "Consult Showed → Booked": 40,
  "Qualified → Booked": 35,
  "Booked → Showed": 80,
  "Showed → Completed": 90,
  // Slimming split
  "Consult Showed → Regular": 30,
  "Consult Showed → Premium": 15,
};

/** User-defined overall benchmarks */
export const OVERALL_CONVERSION_BENCHMARK = 20; // 20% lead → booking
export const LEADS_PER_DAY_PER_AGENT_MIN = 8;

/* ------------------------------------------------------------------ */
/*  Severity thresholds                                                */
/* ------------------------------------------------------------------ */

export function severityColor(actual: number, benchmark: number): "green" | "amber" | "red" {
  const ratio = benchmark > 0 ? actual / benchmark : 1;
  if (ratio >= 1) return "green";
  if (ratio >= 0.75) return "amber";
  return "red";
}

export function overallConversionSeverity(pct: number): "green" | "amber" | "red" {
  if (pct >= OVERALL_CONVERSION_BENCHMARK) return "green";
  if (pct >= 15) return "amber";
  return "red";
}

export function leadsPerAgentSeverity(val: number): "green" | "amber" | "red" {
  if (val >= LEADS_PER_DAY_PER_AGENT_MIN) return "green";
  if (val >= 5) return "amber";
  return "red";
}

/* ------------------------------------------------------------------ */
/*  Constraint detection                                               */
/* ------------------------------------------------------------------ */

/**
 * Finds the stage with the largest negative gap vs its benchmark.
 * Returns null if all stages are at or above benchmark.
 */
export function detectConstraint(
  stages: FunnelStage[],
  benchmarks: Record<string, number> = STAGE_BENCHMARKS
): Constraint | null {
  let worst: Constraint | null = null;

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const curr = stages[i];
    const transitionLabel = `${prev.label} → ${curr.label}`;
    const benchmark = benchmarks[transitionLabel];

    if (benchmark === undefined || curr.conversionPct === null) continue;

    const gap = curr.conversionPct - benchmark;
    if (gap < 0 && (worst === null || gap < worst.gap)) {
      worst = {
        stage: transitionLabel,
        actual: curr.conversionPct,
        benchmark,
        gap,
        severity: severityColor(curr.conversionPct, benchmark),
      };
    }
  }

  return worst;
}

/* ------------------------------------------------------------------ */
/*  Tailwind color classes by severity                                 */
/* ------------------------------------------------------------------ */

export const severityClasses = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  red:   { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", dot: "bg-red-500" },
  off:   { bg: "bg-gray-50", text: "text-gray-400", border: "border-gray-200", dot: "bg-gray-300" },
} as const;
