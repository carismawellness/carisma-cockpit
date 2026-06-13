/**
 * Constants for the Carisma Slimming Master Google Sheet.
 *
 * Uses the same zero-auth CSV export approach as the Cockpit datasheet.
 * The sheet MUST be shared as "Anyone with the link can view" — otherwise
 * the export returns a 302/403 redirect to the Google login page.
 *
 * Sheet URL: https://docs.google.com/spreadsheets/d/1aD69WuWPH3Tl7mPIstVZKmAt3a8fX9q_DFjh4GC_8Cw
 */

export const SLIMMING_MASTER_SHEET_ID =
  "1aD69WuWPH3Tl7mPIstVZKmAt3a8fX9q_DFjh4GC_8Cw";

export const SLIMMING_MASTER_TABS = {
  /**
   * Legacy weight record tab — no date anchoring.
   * @deprecated Use WEIGHT_TRACKER instead.
   */
  WEIGHT_RECORD: { gid: "1147187129", name: "Clients weight record" },

  /**
   * Redesigned weight tracker — canonical data source for the Cockpit.
   * Columns: Name | Program Start (DD/MM/YYYY) | Starting weight | 1 week | 2 week | … | 24 week
   * Data convention: 0 = missed weigh-in (null), "No tanita" = no baseline, blank = not yet due.
   * Program Start anchors each client's weekly readings to real calendar dates:
   *   weigh-in date for week N = Program Start + N × 7 days
   */
  WEIGHT_TRACKER: { gid: "998904193", name: "Weight tracker" },
} as const;

export function slimmingMasterCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${SLIMMING_MASTER_SHEET_ID}/export?format=csv&gid=${gid}`;
}
