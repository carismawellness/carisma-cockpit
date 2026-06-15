/**
 * Single source of truth for the Carisma Cockpit datasheet (Google Sheets).
 *
 * HOW THIS STAYS AUTH-FREE FOREVER
 * ---------------------------------
 * All data is fetched via the public Visualization (gviz) CSV endpoint:
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={GID}
 *
 * This requires NO OAuth, NO service accounts, NO refresh tokens.
 * The only requirement: the sheet remains shared as "Anyone with the link can view."
 * If you ever see a 403 or redirect-to-login, check the sharing settings on the sheet.
 *
 * WHY GVIZ INSTEAD OF /export?format=csv
 * ---------------------------------------
 * The Cockpit datasheet is stored as an uploaded XLSX (not converted to native
 * Google Sheets format). For XLSX-stored files, /export?format=csv returns
 * HTTP 400 ("Sorry, unable to open the file at present") even when sharing is
 * set to "Anyone with the link." The gviz endpoint works for both XLSX and
 * native Sheets — so it's the safer default.
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
 *  Uses the gviz endpoint — see file header for why /export?format=csv was abandoned. */
export function cockpitCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${COCKPIT_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
}
