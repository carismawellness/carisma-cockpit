/**
 * Single source of truth for the Carisma Lapis sales Google Sheet.
 *
 * HOW THIS STAYS AUTH-FREE FOREVER
 * ---------------------------------
 * All data is fetched via the public CSV export endpoint:
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
 *
 * This requires NO OAuth, NO service accounts, NO refresh tokens.
 * The only requirement: the sheet remains shared as "Anyone with the link can view."
 * If you ever see a 403 or redirect-to-login, check the sharing settings on the sheet.
 *
 * NEVER replace these URLs with Google Sheets API (v4) calls — that path requires
 * OAuth and will break every ~6 months when the refresh token expires.
 */

export const LAPIS_SHEET_ID = "195RvbNuZd-oNL-rziKC3Wz6ndy0cDA_a";

export const LAPIS_TABS = {
  /** Spa service transactions from Lapis POS */
  SPA_SERVICES: { gid: "683143306", name: "Service - Spa" },

  /** Spa retail / product sales from Lapis POS */
  SPA_RETAIL: { gid: "1271322967", name: "Retail - Spa" },

  /** Aesthetics clinic service & product sales */
  AESTHETICS: { gid: "1770739089", name: "Aesthetics" },

  /** Slimming programme package sales (new sign-ups & upgrades) */
  SLM_SALES: { gid: "506676479", name: "Sales - Slimming" },

  /** Slimming individual treatment transactions */
  SLM_TRANSACTIONS: { gid: "1268857393", name: "Tx - Slimming" },
} as const;

/** Build a zero-auth CSV export URL for any Lapis tab. */
export function lapisCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${LAPIS_SHEET_ID}/export?format=csv&gid=${gid}`;
}
