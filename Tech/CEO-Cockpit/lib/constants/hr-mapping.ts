/**
 * HR location → brand mapping for Talexio HR ETL and downstream HR API routes.
 *
 * - `LOCATION_TO_BRAND`: canonical location display name → brand bucket.
 * - `normaliseLocation()`: best-effort resolver that maps any Talexio
 *   `organisationUnit.name` (or revenue-table location name) to a canonical
 *   location display name. Unknown locations default to "Spa" (per spec) and
 *   the caller is expected to log a warning.
 * - `LOCATION_SLUG_TO_DISPLAY`: maps internal DB slugs (locations.slug) to
 *   the canonical display name used by HR routes.
 */
export type BrandName = "Spa" | "Aesthetics" | "Slimming" | "HQ";

export const LOCATION_TO_BRAND: Record<string, BrandName> = {
  Novotel:           "Spa",
  Excelsior:         "Spa",
  Labranda:          "Spa",
  InterContinental:  "Spa",
  Odycy:             "Spa",
  "Ramla Bay":       "Spa",
  Hugos:             "Spa",
  Hyatt:             "Spa",
  "Aesthetics Centre": "Aesthetics",
  "Slimming Centre":   "Slimming",
  HQ:                "HQ",
};

/**
 * Internal location slug → canonical display name.
 * Mirrors supabase/seed/002_locations.sql.
 */
export const LOCATION_SLUG_TO_DISPLAY: Record<string, string> = {
  inter:     "InterContinental",
  hugos:     "Hugos",
  hyatt:     "Hyatt",
  ramla:     "Ramla Bay",
  labranda:  "Labranda",
  odycy:     "Odycy",
  excelsior: "Excelsior",
  novotel:   "Novotel",
};

/**
 * Location ID → canonical display name. Matches seed order from
 * supabase/seed/002_locations.sql (BRAND_ID=1 for spa). Used by revenue
 * tables that key by location_id (spa_revenue_daily, etc.).
 */
export const LOCATION_ID_TO_DISPLAY: Record<number, string> = {
  1: "InterContinental",
  2: "Hugos",
  3: "Hyatt",
  4: "Ramla Bay",
  5: "Labranda",
  6: "Odycy",
  7: "Excelsior",
  8: "Novotel",
};

/**
 * Best-effort: convert an arbitrary Talexio (or other) location name into a
 * canonical display name from `LOCATION_TO_BRAND`. Returns null when no match
 * is possible — callers should fall back to "Spa" + log a warning per spec.
 */
export function normaliseLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();

  // Direct display-name match
  for (const canonical of Object.keys(LOCATION_TO_BRAND)) {
    if (canonical.toLowerCase() === key) return canonical;
  }

  // Aliases — matches the Talexio org-unit naming conventions seen in the
  // salary-supplement allocator route.
  const aliasMap: Record<string, string> = {
    intercontinental:  "InterContinental",
    inter:             "InterContinental",
    "hugo's":          "Hugos",
    hugo:              "Hugos",
    "ramla bay":       "Ramla Bay",
    "sunny coast":     "Odycy",
    sunnycoast:        "Odycy",
    aesthetics:        "Aesthetics Centre",
    "aesthetics clinic": "Aesthetics Centre",
    aesthtics:         "Aesthetics Centre",
    slimming:          "Slimming Centre",
    "slimming clinic": "Slimming Centre",
    centre:            "HQ",
    center:            "HQ",
    "head office":     "HQ",
    management:        "HQ",
    central:           "HQ",
    hq:                "HQ",
  };
  if (key in aliasMap) return aliasMap[key];

  // Partial match — checks each alias key against the raw input as a fallback
  for (const [k, display] of Object.entries(aliasMap)) {
    if (key.includes(k) || k.includes(key)) return display;
  }

  // Try partial match against canonical display names
  for (const canonical of Object.keys(LOCATION_TO_BRAND)) {
    if (key.includes(canonical.toLowerCase()) || canonical.toLowerCase().includes(key)) {
      return canonical;
    }
  }

  return null;
}

/**
 * Resolve a location's brand. Returns "Spa" when unknown (per spec).
 */
export function brandForLocation(locationName: string): BrandName {
  return LOCATION_TO_BRAND[locationName] ?? "Spa";
}
