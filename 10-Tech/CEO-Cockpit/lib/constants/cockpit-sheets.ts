/**
 * Single source of truth for the Carisma Cockpit datasheet (Google Sheets).
 *
 * HOW THIS STAYS AUTH-FREE FOREVER
 * ---------------------------------
 * All data is fetched via the public Visualization (gviz) CSV endpoint
 * addressed by SHEET NAME (not gid) with a range that skips the title row:
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={NAME}&range=A2:ZZ
 *
 * This requires NO OAuth, NO service accounts, NO refresh tokens.
 * The only requirement: the sheet remains shared as "Anyone with the link can view."
 * If you ever see a 403 or redirect-to-login, check the sharing settings on the sheet.
 *
 * WHY THIS EXACT URL FORM
 * -----------------------
 * 1. /export?format=csv → returns HTTP 400 for our XLSX-uploaded Cockpit
 *    datasheet (Google handles /export inconsistently for non-native sheets).
 * 2. /gviz/tq?...&gid={GID} → IGNORES the gid for XLSX files and always
 *    returns the first tab, so Aesthetics/Slimming silently received the
 *    Spa Services data when we tried this on 2026-06-15.
 * 3. /gviz/tq?...&sheet={NAME} → correctly returns the named tab.
 * 4. The Cockpit tabs have a single-cell title in row 1 above the headers.
 *    With /export those came back as two distinct rows. With gviz they get
 *    MERGED — the title text is glued onto the first header cell. Adding
 *    &range=A2:ZZ tells gviz to skip the title row entirely so row 1 of
 *    the CSV is the real header row.
 *
 * If the underlying file is ever converted to a native Google Sheet,
 * /export?format=csv&gid= would also work — but this URL form will keep
 * working in both modes, so leave it.
 *
 * NEVER replace these URLs with Google Sheets API (v4) calls — that path requires
 * OAuth and will break every ~6 months when the refresh token expires.
 *
 * DATA SOURCE: All revenue ETL pulls from this single Cockpit datasheet.
 * This is NOT the old Cockpit POS sheet — it is the master operational datasheet
 * maintained by the Carisma team at 195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a.
 */

export const COCKPIT_SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";

export const COCKPIT_TABS = {
  /** Spa service transactions — columns: Status, Service Date, Unit Price, Sales Point, Employee(s), etc. */
  SPA_SERVICES: { gid: "1281126329", name: "Service - Spa" },

  /** Spa retail / product sales — columns: Date, Total Amount, VAT Exclusive Amount, Point of Sales, Brand, etc. */
  SPA_RETAIL: { gid: "1170650850", name: "Retail - Spa" },

  /** Aesthetics clinic service & product sales — columns: Costumer, Service/Products, Date of service, Price, Payment type, Sales Staf, Employee */
  AESTHETICS: { gid: "2033734488", name: "Aesthetics" },

  /** Slimming programme package sales — columns: Date, Client, Weight loss, Treatments, Medical consultation, Products, Full price, Paid, Employee */
  SLM_SALES: { gid: "1945063877", name: "Sales - Slimming" },

  /** Slimming individual treatment transactions — columns: Date, Client, Treatment, Price, Therapist */
  SLM_TRANSACTIONS: { gid: "1735295211", name: "Tx - Slimming" },
} as const;

/** Build a zero-auth CSV URL for any Cockpit tab.
 *  Takes the tab NAME (not gid). See file header for the URL-form rationale.
 *  Pass an explicit `range` to narrow columns and get a distinct gviz cache key
 *  (useful when the default A2:ZZ cache is stale but a tighter range is fresh). */
export function cockpitCsvUrl(tabName: string, range = "A2:ZZ"): string {
  return `https://docs.google.com/spreadsheets/d/${COCKPIT_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&range=${range}`;
}
