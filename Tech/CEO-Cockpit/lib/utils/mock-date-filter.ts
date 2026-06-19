import { format, isWithinInterval, startOfDay, endOfDay, parse } from "date-fns";

/**
 * Given an array of week-start dates and a date range, returns the indices
 * of weeks that fall within the range.
 */
export function getFilteredIndices(
  weekDates: Date[],
  dateFrom: Date,
  dateTo: Date
): number[] {
  const from = startOfDay(dateFrom);
  const to = endOfDay(dateTo);
  return weekDates
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => date >= from && date <= to)
    .map(({ index }) => index);
}

/**
 * Picks elements from an array at given indices.
 */
export function filterByIndices<T>(arr: readonly T[], indices: number[]): T[] {
  return indices.map((i) => arr[i]).filter((v) => v !== undefined);
}

/**
 * Sums values from an array at given indices.
 */
export function sumFiltered(arr: readonly number[], indices: number[]): number {
  return indices.reduce((sum, i) => sum + (arr[i] ?? 0), 0);
}

/**
 * Builds an array of Date objects from week-label strings like "05-Jan"
 * anchored to a specific year.
 */
export function weekLabelsToDateObjects(
  labels: readonly string[],
  year: number
): Date[] {
  return labels.map((label) => parse(label, "dd-MMM", new Date(year, 0, 1)));
}

/**
 * Builds an array of Date objects for months Jan-Dec of given year(s).
 * monthIndex: 0-based (0 = Jan, 11 = Dec)
 */
export function monthIndicesToDateObjects(
  startYear: number,
  count: number
): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const year = startYear + Math.floor(i / 12);
    const month = i % 12;
    return new Date(year, month, 1);
  });
}

/**
 * Returns a human-readable label for the active date range.
 */
export function formatDateRangeLabel(from: Date, to: Date): string {
  return `${format(from, "MMM d")} \u2013 ${format(to, "MMM d, yyyy")}`;
}

/**
 * Returns "N weeks" or "N months" label based on filtered count.
 */
export function filteredCountLabel(
  count: number,
  unit: "week" | "month"
): string {
  return `${count} ${unit}${count !== 1 ? "s" : ""}`;
}
