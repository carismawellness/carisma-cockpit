/**
 * Returns the preceding period of the same length, ending the day before `from`.
 * If the current range is 7 days, the previous range is also 7 days.
 */
export function previousPeriod(from: Date, to: Date): { prevFrom: Date; prevTo: Date } {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days + 1);
  return { prevFrom, prevTo };
}

/**
 * Returns the percentage change (current - previous) / |previous| * 100.
 * Returns undefined if previous is 0 (avoid divide-by-zero).
 */
export function deltaPct(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}
