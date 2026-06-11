/**
 * Format a Date as YYYY-MM-DD using the LOCAL timezone (not UTC).
 *
 * toISOString() shifts to UTC, which in Malta (UTC+2) turns
 * midnight May 1 into "2026-04-30" — causing date-range queries
 * to silently use the wrong day boundaries.
 *
 * Use this everywhere a user-selected Date is serialised into a
 * query-param or API call that expects a calendar date string.
 */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
