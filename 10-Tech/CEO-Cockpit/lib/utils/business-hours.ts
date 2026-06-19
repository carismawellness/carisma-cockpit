/**
 * Business-hours elapsed-time helper for the speed-to-lead metric.
 *
 * Operating window: Mon–Sat, 09:00–19:00 Europe/Malta. Sundays closed.
 * Counts only the minutes between two instants that fall inside open windows.
 * A lead arriving outside hours starts its clock at the next opening.
 *
 * DST-safe: open/close boundaries are resolved per Malta calendar day using
 * `Intl` timeZone formatting, so the March/October switches don't shift the
 * window. We never hand-roll a fixed UTC+2 offset (that bug is called out in
 * the repo's learnings).
 *
 * Pure functions only — unit-tested in business-hours.test.ts.
 */

export const MALTA_TZ = "Europe/Malta";
export const OPEN_HOUR = 9; // 09:00
export const CLOSE_HOUR = 19; // 19:00
// JS getUTCDay()-style weekday: 0 = Sunday. We are CLOSED on Sunday only.
const CLOSED_WEEKDAY = 0;

const MS_PER_MINUTE = 60_000;

/** Malta-local Y/M/D for an instant. */
function maltaYMD(ms: number): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: MALTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day };
}

/**
 * Offset (localWallClock − UTC) in ms for the given instant, in Malta time.
 * Positive because Malta is ahead of UTC (+1h winter, +2h summer).
 */
function maltaOffsetMs(ms: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: MALTA_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUTC - ms;
}

/**
 * Convert a Malta wall-clock time (Y/M/D H:M) to an epoch-ms instant.
 * Two-pass to stay correct across DST transitions.
 */
function maltaWallToMs(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = maltaOffsetMs(guess);
  let utc = guess - off1;
  const off2 = maltaOffsetMs(utc);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

/** Weekday (0=Sun..6=Sat) of an instant, in Malta time. */
function maltaWeekday(ms: number): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: MALTA_TZ, weekday: "short" }).format(
    new Date(ms),
  );
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? 0;
}

/**
 * Business minutes between two instants (Mon–Sat 09:00–19:00 Malta).
 * Returns 0 if end <= start. Walks each Malta calendar day, summing the
 * overlap of [start, end] with that day's open window.
 */
export function businessMinutesBetween(start: Date, end: Date): number {
  const s = start.getTime();
  const e = end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;

  let totalMs = 0;
  let { year, month, day } = maltaYMD(s);

  // Safety cap: ~3 years of days. A single lead should never span this.
  for (let i = 0; i < 1200; i++) {
    const openMs = maltaWallToMs(year, month, day, OPEN_HOUR, 0);
    if (openMs > e) break; // no more open windows can overlap [s, e]

    const closeMs = maltaWallToMs(year, month, day, CLOSE_HOUR, 0);
    if (maltaWeekday(openMs) !== CLOSED_WEEKDAY) {
      const winStart = Math.max(s, openMs);
      const winEnd = Math.min(e, closeMs);
      if (winEnd > winStart) totalMs += winEnd - winStart;
    }

    // Advance to the next Malta calendar day. Adding 26h then re-reading the
    // date lands safely on the next day regardless of 23/25h DST days.
    const next = maltaYMD(openMs + 26 * 60 * 60 * 1000);
    year = next.year;
    month = next.month;
    day = next.day;
  }

  return totalMs / MS_PER_MINUTE;
}

export type StlBucket = "<5" | "5-30" | "30-60" | "60-240" | ">240" | "pending";

/** Canonical bucket order for charts/legends. */
export const STL_BUCKETS: StlBucket[] = ["<5", "5-30", "30-60", "60-240", ">240", "pending"];

/** Human label for a bucket. */
export const STL_BUCKET_LABELS: Record<StlBucket, string> = {
  "<5": "<5 min",
  "5-30": "5–30 min",
  "30-60": "30–60 min",
  "60-240": "1–4 hr",
  ">240": ">4 hr",
  pending: "Pending",
};

/** Classify a business-minutes value into an SLA bucket. */
export function stlBucketOf(businessMinutes: number | null, responded: boolean): StlBucket {
  if (!responded || businessMinutes === null) return "pending";
  if (businessMinutes < 5) return "<5";
  if (businessMinutes < 30) return "5-30";
  if (businessMinutes < 60) return "30-60";
  if (businessMinutes < 240) return "60-240";
  return ">240";
}

/** Median of a numeric array (0 for empty). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mean of a numeric array (0 for empty). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
