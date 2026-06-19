export type WeightTrend = "down" | "up" | "flat" | "new" | null;

// on_track   = pctLost > 0.3%  (clearly losing weight)
// plateau    = -0.3% ≤ pctLost ≤ 0.3%  (weight unchanged)
// gaining    = pctLost < -0.3%  (weight has increased)
// awaiting   = has baseline but no valid weekly reading yet
// no_baseline = "No tanita" or empty starting weight
export type WeightStatus = "on_track" | "plateau" | "gaining" | "no_baseline" | "awaiting";

export interface WeightClient {
  name: string;
  /** ISO date string YYYY-MM-DD — when the client's program began. */
  programStart: string | null;
  startWeight: number | null;
  currentWeight: number | null;
  /** Positive = good (client lost weight). Negative = bad (client gained). */
  weightLost: number | null;
  /** Positive = good (% of start weight lost). Negative = bad (% gained). */
  pctLost: number | null;
  weeksLogged: number;
  trend: WeightTrend;
  status: WeightStatus;
}

// ── Weekly trend (chronological) ─────────────────────────────────────────────

export interface WeeklyTrendPoint {
  /** ISO date of the Monday starting this calendar week. */
  weekStart: string;
  /** Human-readable label, e.g. "3 Mar" */
  weekLabel: string;
  /** Total clients who had a valid weigh-in this week. */
  weighed: number;
  /** Weighed clients whose weight dropped vs prior reading. */
  losing: number;
  /** Weighed clients whose weight rose vs prior reading. */
  gaining: number;
  /** Weighed clients whose weight was unchanged (±0.15 kg). */
  plateau: number;
  /** losing / weighed × 100, rounded to 1 dp. Null if nobody weighed. */
  losingPct: number | null;
}

export interface SlimmingWeightTrendData {
  asOf: string;
  weeks: WeeklyTrendPoint[];
}

export interface SlimmingWeightSummary {
  totalClients: number;
  clientsWithData: number;
  onTrack: number;
  plateaued: number;
  gaining: number;
  awaiting: number;
  noBaseline: number;
  /** Average % lost across all clients with data. Null if no data. */
  avgPctLost: number | null;
  /** Total kg lost summed across all clients who have lost weight. */
  totalKgLost: number;
}

export interface SlimmingWeightData {
  asOf: string;
  sheetAccessible: boolean;
  summary: SlimmingWeightSummary;
  /** All clients, sorted alphabetically. */
  clients: WeightClient[];
  /** Gaining + plateau clients, sorted worst-first (call list). */
  notLosingWeight: WeightClient[];
}
