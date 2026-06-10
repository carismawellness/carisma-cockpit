/**
 * Hard-coded dates excluded from CRM dashboard reporting.
 *
 * 2026-05-06 was a GHL data migration day — leads were imported in bulk,
 * producing an 8,722-lead spike that biases averages and conversion rates
 * across the CRM Master page.
 *
 * 2026-05-09 had a second CRM-migration backfill that pushed Aesthetics
 * leads to 672 (vs ~50/day baseline) — same root cause, same treatment.
 *
 * We strip these dates from all crm_daily, crm_lead_reconciliation, and
 * crm_agent_daily aggregations so trends reflect actual operations.
 */

export const EXCLUDED_CRM_DATES: ReadonlySet<string> = new Set([
  "2026-05-06",
  "2026-05-09",
]);

/** Returns true if `date` (YYYY-MM-DD string) should be excluded from CRM reporting. */
export function isExcludedCrmDate(date: string): boolean {
  return EXCLUDED_CRM_DATES.has(date);
}

/**
 * Number of excluded dates that fall within an inclusive [from, to] range.
 * Used to correct calendar-day denominators (e.g. daily averages).
 */
export function countExcludedCrmDatesInRange(from: Date, to: Date): number {
  const fromMs = from.getTime();
  const toMs   = to.getTime();
  let count = 0;
  for (const iso of EXCLUDED_CRM_DATES) {
    const ms = new Date(iso + "T00:00:00").getTime();
    if (ms >= fromMs && ms <= toMs) count++;
  }
  return count;
}
