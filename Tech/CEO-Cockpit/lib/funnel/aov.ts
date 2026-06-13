/** Shared AOV resolution logic used by both the Funnel and Marketing pages */

export const BRAND_AOV_DEFAULT: Record<string, number> = {
  spa:        129,
  aesthetics: 179,
  slimming:   199,
};

// Zero-AOV entries MUST come first — they short-circuit before any positive-value match
export const AOV_OVERRIDES: Array<{ keywords: string[]; aov: number }> = [
  // Zero-revenue campaign types (awareness / recruitment / internal)
  { keywords: ["model call", "model calls", "recruitment"], aov: 0 },

  // Spa
  { keywords: ["gifting", "gift"], aov: 100 },
  { keywords: ["couple", "couples", "romantic"], aov: 249 },
  { keywords: ["hammam"], aov: 129 },
  { keywords: ["spa day", "body ritual", "body treatment", "ritual"], aov: 129 },
  { keywords: ["massage"], aov: 99 },

  // Aesthetics
  { keywords: ["snatch jawline", "jawline"], aov: 269 },
  { keywords: ["lip and glow", "lip"], aov: 200 },
  { keywords: ["hydrafacial"], aov: 100 },
  { keywords: ["hair regrowth"], aov: 250 },
  { keywords: ["facelift", "face lift", "face-lift"], aov: 250 },
  { keywords: ["dr. kendra", "dr kendra", "kendra"], aov: 250 },
  { keywords: ["filler", "dermal filler"], aov: 269 },
  { keywords: ["botox", "wrinkle", "anti-wrinkle", "injectable"], aov: 179 },
  { keywords: ["facial", "peel", "skin", "microneedling"], aov: 149 },
  { keywords: ["laser", "ipl", "laser hair removal", "hair removal"], aov: 199 },

  // Slimming
  { keywords: ["risk reversal", "menopause", "after babies", "pain solution"], aov: 250 },
  { keywords: ["fat freeze", "coolsculpt", "cryolipolysis"], aov: 199 },
  { keywords: ["emsculpt", "hifu", "body sculpt", "velashape", "cavitation"], aov: 199 },
  { keywords: ["weight loss", "slimming plan", "glp", "ozempic", "mounjaro"], aov: 350 },
];

export function resolveAov(brandSlug: string, campaignName: string): number {
  const lower = campaignName.toLowerCase();
  for (const { keywords, aov } of AOV_OVERRIDES) {
    if (keywords.some((k) => lower.includes(k))) return aov;
  }
  return BRAND_AOV_DEFAULT[brandSlug] ?? 300;
}

/**
 * Returns true for cost-centre campaigns (model calls, recruitment, store visits)
 * that should be excluded from Profitability Matrix and revenue totals.
 * Defined by any AOV_OVERRIDE entry with aov === 0.
 */
export function isNonRevenueCampaign(brandSlug: string, campaignName: string): boolean {
  return resolveAov(brandSlug, campaignName) === 0;
}
