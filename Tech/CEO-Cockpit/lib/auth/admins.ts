/**
 * Single source of truth for cockpit admin emails.
 *
 * Override via the ADMIN_EMAILS env var (comma-separated). The literal
 * fallback below matches the list previously copy-pasted across the
 * middleware and admin API routes — do NOT remove emails from it without
 * confirming nobody gets locked out.
 */
export const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase());

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes((email ?? "").trim().toLowerCase());
}
