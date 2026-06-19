/**
 * Tracked keywords for Google Search Console ranking monitoring.
 *
 * The ETL pulls clicks, impressions, CTR, and average position for each
 * (brand, keyword) pair on a daily basis from GSC and stores them in the
 * gsc_keyword_daily table. The marketing dashboards then display the latest
 * rankings + trend per brand.
 *
 * To add or remove a tracked keyword, edit the arrays below. Keywords are
 * matched against GSC queries case-insensitively (GSC lowercases everything).
 */

export type BrandSlug = "spa" | "aesthetics" | "slimming";

export const GSC_SITE_URLS: Record<BrandSlug, string> = {
  spa:        "sc-domain:carismaspa.com",
  aesthetics: "sc-domain:carismaaesthetics.com",
  slimming:   "sc-domain:carismaslimming.com",
};

export const TRACKED_KEYWORDS: Record<BrandSlug, string[]> = {
  spa: [
    "spa in malta",
    "spa day",
    "spa day malta",
    "massage",
    "spa packages",
    "spa",
    "massage malta",
    "carisma spa",
    "carisma spa malta",
    "massage near me",
  ],
  aesthetics: [
    "med aesthetics",
    "aesthetics",
    "botox malta",
    "lip fillers malta",
    "hydrafacial malta",
    "microneedling malta",
    "laser hair removal malta",
  ],
  slimming: [
    "ozempic malta",
    "weight loss malta",
    "slimming malta",
  ],
};

/** Flatten all tracked keywords (lower-cased) for any brand. */
export function allTrackedKeywords(): string[] {
  return Object.values(TRACKED_KEYWORDS).flat().map((k) => k.toLowerCase());
}
