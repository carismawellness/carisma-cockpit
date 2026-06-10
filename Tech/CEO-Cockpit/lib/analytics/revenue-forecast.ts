// lib/analytics/revenue-forecast.ts
//
// Pure, unit-testable revenue forecast engine for the group sales view.
//
// Methodology (per brand, same method applied independently to Spa,
// Aesthetics and Slimming):
//
//   1. Growth estimate g — YoY growth from the trailing 3 full months that
//      have data in BOTH years (sum current ÷ sum LY − 1). Falls back to
//      YTD YoY when fewer than 3 paired months exist. Clamped to a sane
//      band (−30%..+50%) so sparse data can't blow up the projection.
//
//   2. Current (partial) month — blend of two estimators:
//        (a) run-rate:  MTD ÷ elapsed days × days-in-month
//        (b) seasonal:  LY same month × (1 + g)
//      Weighted by month progress: weight_a = elapsed/daysInMonth, so the
//      seasonal estimator dominates early in the month and the run-rate
//      dominates late. If the LY month is missing, run-rate alone is used.
//
//   3. Future months to end of calendar year — LY same month × (1 + g).
//      Where the LY month is missing, the average of available trailing
//      full months is used as the base (no growth applied — the trailing
//      months are already at current-year level).
//
// Everything here is deterministic and side-effect free. All month keys
// are "YYYY-MM-01" strings (matching the group sales API).

export type BrandKey = "spa" | "aesthetics" | "slimming";

export type ForecastMethod = "blend" | "seasonal" | "runrate";
export type GrowthMethod = "trailing3" | "ytd" | "none";

/** Clamp band for the YoY growth estimate. */
export const GROWTH_CLAMP = { min: -0.3, max: 0.5 } as const;

/** How many trailing full months to average when an LY baseline is missing. */
const TRAILING_BASE_MONTHS = 6;

export interface BrandForecastAssumptions {
  /** YoY growth applied (already clamped). */
  g: number;
  /** How g was estimated. */
  gMethod: GrowthMethod;
  /** LY same-month revenue used as the seasonal base (null = unavailable). */
  lyValue: number | null;
  /** Month-to-date actual (current month only, null for future months). */
  mtd: number | null;
  /** Days of the current month covered by data (current month only). */
  elapsedDays: number | null;
  daysInMonth: number;
}

export interface BrandForecastPoint {
  forecast: number;
  method: ForecastMethod;
  assumptions: BrandForecastAssumptions;
}

export interface ForecastMonthPoint {
  /** "YYYY-MM-01" */
  month: string;
  /** Sum of the three brand forecasts. */
  forecastTotal: number;
  /** Group LY same-month actual (null when no LY data for the month). */
  lyTotal: number | null;
  isCurrentMonth: boolean;
  perBrand: Record<BrandKey, BrandForecastPoint>;
}

export interface FiscalYearProjection {
  year: number;
  /** Actual revenue, Jan through the last FULL month of the current year. */
  actualsToDate: number;
  /** Forecast for the current (partial) month + remaining months. */
  forecastRemainder: number;
  /** actualsToDate + forecastRemainder. */
  projectedTotal: number;
  /** Full prior calendar year actual (from available data). */
  lyTotal: number;
  /** Prior-year months with no data — flags an understated lyTotal. */
  lyMonthsMissing: number;
}

export interface GroupForecast {
  /** "YYYY-MM-01" of the current (partial) month. */
  currentMonth: string;
  /** Group-level growth estimate (headline number for the UI). */
  g: number;
  gMethod: GrowthMethod;
  /** Forecast for the current month and each remaining month of the year. */
  months: ForecastMonthPoint[];
  fy: FiscalYearProjection;
}

/** Revenue keyed by "YYYY-MM-01". Current month value = MTD actual. */
export type MonthlyRevenueMap = Record<string, number>;

// ---------------------------------------------------------------------------
// Date helpers (string-based, timezone-safe)
// ---------------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Shift a "YYYY-MM-01" key by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${pad2(nm)}-01`;
}

/** Shift a "YYYY-MM-01" key by `delta` years. */
export function shiftYears(month: string, delta: number): string {
  const [y, rest] = [Number(month.slice(0, 4)), month.slice(4)];
  return `${y + delta}${rest}`;
}

/** Days in the month of a "YYYY-MM-01" key. */
export function daysInMonthOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function clampGrowth(g: number): number {
  return Math.min(GROWTH_CLAMP.max, Math.max(GROWTH_CLAMP.min, g));
}

function val(map: MonthlyRevenueMap, month: string): number {
  return map[month] ?? 0;
}

// ---------------------------------------------------------------------------
// Growth estimation
// ---------------------------------------------------------------------------

/**
 * Estimate YoY growth from the trailing 3 full months that have data in
 * BOTH years. Falls back to YTD YoY when fewer than 3 paired months exist.
 * Returns g = 0 (method "none") when no paired data is available at all.
 */
export function estimateYoYGrowth(
  byMonth: MonthlyRevenueMap,
  currentMonth: string
): { g: number; gMethod: GrowthMethod } {
  // Trailing 3 full months immediately before the current month.
  let curSum = 0;
  let lySum = 0;
  let paired = 0;
  for (let i = 1; i <= 3; i++) {
    const m = addMonths(currentMonth, -i);
    const cur = val(byMonth, m);
    const ly = val(byMonth, shiftYears(m, -1));
    if (cur > 0 && ly > 0) {
      curSum += cur;
      lySum += ly;
      paired++;
    }
  }
  if (paired >= 3 && lySum > 0) {
    return { g: clampGrowth(curSum / lySum - 1), gMethod: "trailing3" };
  }

  // Fallback: YTD YoY across all full months of the current year.
  const year = Number(currentMonth.slice(0, 4));
  const curMonthNum = Number(currentMonth.slice(5, 7));
  let ytdCur = 0;
  let ytdLy = 0;
  let ytdPaired = 0;
  for (let mNum = 1; mNum < curMonthNum; mNum++) {
    const m = `${year}-${pad2(mNum)}-01`;
    const cur = val(byMonth, m);
    const ly = val(byMonth, shiftYears(m, -1));
    if (cur > 0 && ly > 0) {
      ytdCur += cur;
      ytdLy += ly;
      ytdPaired++;
    }
  }
  if (ytdPaired > 0 && ytdLy > 0) {
    return { g: clampGrowth(ytdCur / ytdLy - 1), gMethod: "ytd" };
  }

  return { g: 0, gMethod: "none" };
}

/**
 * Group-level headline growth, built from per-brand PAIRED sums — months
 * only count when that brand has data in both years. This stops a brand
 * with no LY history (e.g. a newly launched brand) from inflating group
 * growth just because last year's group total is missing its revenue.
 */
export function estimateGroupGrowth(
  brandMaps: MonthlyRevenueMap[],
  currentMonth: string
): { g: number; gMethod: GrowthMethod } {
  let cur3 = 0, ly3 = 0, paired3 = 0;
  let curY = 0, lyY = 0, pairedY = 0;
  const year = Number(currentMonth.slice(0, 4));
  const curMonthNum = Number(currentMonth.slice(5, 7));

  for (const byMonth of brandMaps) {
    for (let i = 1; i <= 3; i++) {
      const m = addMonths(currentMonth, -i);
      const cur = val(byMonth, m);
      const ly = val(byMonth, shiftYears(m, -1));
      if (cur > 0 && ly > 0) { cur3 += cur; ly3 += ly; paired3++; }
    }
    for (let mNum = 1; mNum < curMonthNum; mNum++) {
      const m = `${year}-${pad2(mNum)}-01`;
      const cur = val(byMonth, m);
      const ly = val(byMonth, shiftYears(m, -1));
      if (cur > 0 && ly > 0) { curY += cur; lyY += ly; pairedY++; }
    }
  }

  if (paired3 >= 3 && ly3 > 0) return { g: clampGrowth(cur3 / ly3 - 1), gMethod: "trailing3" };
  if (pairedY > 0 && lyY > 0)  return { g: clampGrowth(curY / lyY - 1), gMethod: "ytd" };
  return { g: 0, gMethod: "none" };
}

// ---------------------------------------------------------------------------
// Per-month forecasting
// ---------------------------------------------------------------------------

/**
 * Project the current (partial) month by blending the MTD run-rate with the
 * LY-seasonal estimate, weighted by how far through the month we are.
 */
export function forecastCurrentMonth(
  byMonth: MonthlyRevenueMap,
  currentMonth: string,
  elapsedDays: number,
  g: number,
  gMethod: GrowthMethod
): BrandForecastPoint {
  const daysInMonth = daysInMonthOf(currentMonth);
  const elapsed = Math.min(Math.max(1, Math.round(elapsedDays)), daysInMonth);
  const mtd = val(byMonth, currentMonth);
  const lyRaw = val(byMonth, shiftYears(currentMonth, -1));
  const lyValue = lyRaw > 0 ? lyRaw : null;

  const runRate = (mtd / elapsed) * daysInMonth;

  const assumptions: BrandForecastAssumptions = {
    g,
    gMethod,
    lyValue,
    mtd,
    elapsedDays: elapsed,
    daysInMonth,
  };

  if (lyValue === null) {
    return { forecast: Math.round(runRate), method: "runrate", assumptions };
  }

  const seasonal = lyValue * (1 + g);
  const weightRunRate = elapsed / daysInMonth; // late month → trust run-rate
  const blend = weightRunRate * runRate + (1 - weightRunRate) * seasonal;
  // Never project below what's already booked.
  return { forecast: Math.round(Math.max(blend, mtd)), method: "blend", assumptions };
}

/**
 * Project a future month: LY same month × (1 + g). When the LY month is
 * missing, the average of available trailing full months is used as the base.
 */
export function forecastFutureMonth(
  byMonth: MonthlyRevenueMap,
  month: string,
  currentMonth: string,
  g: number,
  gMethod: GrowthMethod
): BrandForecastPoint {
  const daysInMonth = daysInMonthOf(month);
  const lyRaw = val(byMonth, shiftYears(month, -1));
  const lyValue = lyRaw > 0 ? lyRaw : null;

  const assumptions: BrandForecastAssumptions = {
    g,
    gMethod,
    lyValue,
    mtd: null,
    elapsedDays: null,
    daysInMonth,
  };

  if (lyValue !== null) {
    return { forecast: Math.round(lyValue * (1 + g)), method: "seasonal", assumptions };
  }

  // No LY baseline — use the average of available trailing full months.
  // These are already at current-year level, so no growth is applied.
  let sum = 0;
  let count = 0;
  for (let i = 1; i <= TRAILING_BASE_MONTHS; i++) {
    const m = addMonths(currentMonth, -i);
    const v = val(byMonth, m);
    if (v > 0) {
      sum += v;
      count++;
    }
  }
  const base = count > 0 ? sum / count : 0;
  return { forecast: Math.round(base), method: "runrate", assumptions };
}

// ---------------------------------------------------------------------------
// Group assembly
// ---------------------------------------------------------------------------

const BRAND_KEYS: BrandKey[] = ["spa", "aesthetics", "slimming"];

/**
 * Build the full group forecast: current (partial) month + every remaining
 * month of the current calendar year, with per-brand breakdown (each brand
 * gets its own growth estimate) and a fiscal-year projection.
 *
 * Returns null when there is no LY data at all (nothing to anchor a
 * forecast to) — callers should hide the forecast UI in that case.
 */
export function buildGroupForecast(
  brands: Record<BrandKey, MonthlyRevenueMap>,
  currentMonth: string,
  elapsedDays: number,
  // Injectable for tests; defaults to the calendar value.
  daysInMonth: number = daysInMonthOf(currentMonth)
): GroupForecast | null {
  const year = Number(currentMonth.slice(0, 4));
  const curMonthNum = Number(currentMonth.slice(5, 7));

  // Group-level month map = sum of the three brands.
  const groupByMonth: MonthlyRevenueMap = {};
  for (const key of BRAND_KEYS) {
    for (const [m, v] of Object.entries(brands[key] ?? {})) {
      groupByMonth[m] = (groupByMonth[m] ?? 0) + v;
    }
  }

  // No LY data at all (full prior calendar year empty) → no forecast.
  let lyTotal = 0;
  let lyMonthsMissing = 0;
  for (let mNum = 1; mNum <= 12; mNum++) {
    const v = val(groupByMonth, `${year - 1}-${pad2(mNum)}-01`);
    lyTotal += v;
    if (v <= 0) lyMonthsMissing++;
  }
  if (lyTotal <= 0) return null;

  // Per-brand growth estimates (same method per brand).
  const growth = {} as Record<BrandKey, { g: number; gMethod: GrowthMethod }>;
  for (const key of BRAND_KEYS) {
    growth[key] = estimateYoYGrowth(brands[key] ?? {}, currentMonth);
  }
  const groupGrowth = estimateGroupGrowth(
    BRAND_KEYS.map((k) => brands[k] ?? {}),
    currentMonth
  );

  // Forecast current month + remaining months of the calendar year.
  const months: ForecastMonthPoint[] = [];
  for (let mNum = curMonthNum; mNum <= 12; mNum++) {
    const month = `${year}-${pad2(mNum)}-01`;
    const isCurrentMonth = mNum === curMonthNum;

    const perBrand = {} as Record<BrandKey, BrandForecastPoint>;
    for (const key of BRAND_KEYS) {
      const map = brands[key] ?? {};
      const { g, gMethod } = growth[key];
      perBrand[key] = isCurrentMonth
        ? forecastCurrentMonth(map, currentMonth, elapsedDays, g, gMethod)
        : forecastFutureMonth(map, month, currentMonth, g, gMethod);
      // Current-month projection uses the injected daysInMonth if provided.
      if (isCurrentMonth) perBrand[key].assumptions.daysInMonth = daysInMonth;
    }

    const forecastTotal = BRAND_KEYS.reduce((s, k) => s + perBrand[k].forecast, 0);
    const lyRaw = val(groupByMonth, shiftYears(month, -1));
    months.push({
      month,
      forecastTotal,
      lyTotal: lyRaw > 0 ? Math.round(lyRaw) : null,
      isCurrentMonth,
      perBrand,
    });
  }

  // Fiscal-year projection: full-month actuals + forecast remainder.
  let actualsToDate = 0;
  for (let mNum = 1; mNum < curMonthNum; mNum++) {
    actualsToDate += val(groupByMonth, `${year}-${pad2(mNum)}-01`);
  }
  const forecastRemainder = months.reduce((s, m) => s + m.forecastTotal, 0);

  return {
    currentMonth,
    g: groupGrowth.g,
    gMethod: groupGrowth.gMethod,
    months,
    fy: {
      year,
      actualsToDate: Math.round(actualsToDate),
      forecastRemainder: Math.round(forecastRemainder),
      projectedTotal: Math.round(actualsToDate + forecastRemainder),
      lyTotal: Math.round(lyTotal),
      lyMonthsMissing,
    },
  };
}
