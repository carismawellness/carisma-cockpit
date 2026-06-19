// Categoriser for Spa service-product strings as written in the Cockpit
// "Service - Spa" tab. Used by the Revenue-by-Service treemap on the Spa
// sales page.
//
// The source data has hundreds of distinct service names with messy patterns:
//   - Time-coded codes: "9-A-80MIN. Antistress Massage"
//   - Series codes:      "12-A Hydra Blue - Plumping Moisturizing Treatment"
//   - Package names in caps with branch suffixes: "SPA DELUXE PACKAGE INTER"
//   - Multi-language casing: "Valentine's Retreat", "ULTIMATE HYDRATION"
//   - Add-ons prefixed E1..E11 or ADDON1..15
//
// Match most-specific first; unmatched strings fall into "Other" so they're
// still surfaced (small rectangles on the treemap) rather than silently lost.

export const SPA_GROUP_ORDER = [
  "Massage",
  "Facial",
  "Hammam",
  "Body Treatment",
  "Package",
  "Add-on",
  "F&B / Extras",
  "Other",
] as const;

export type SpaGroup = (typeof SPA_GROUP_ORDER)[number];

export const SPA_GROUP_COLORS: Record<SpaGroup, string> = {
  Massage:        "#0EA5E9", // sky-500
  Facial:         "#8B5CF6", // violet-500
  Hammam:         "#F59E0B", // amber-500
  "Body Treatment": "#10B981", // emerald-500
  Package:        "#EC4899", // pink-500
  "Add-on":       "#6366F1", // indigo-500
  "F&B / Extras": "#94A3B8", // slate-400
  Other:          "#CBD5E1", // slate-300
};

export interface CategorisedService {
  group:    SpaGroup;
  category: string;
}

/**
 * Maps a raw spa service name to a high-level group + a more descriptive
 * category. Stable, side-effect-free, safe to import on client or server.
 */
export function categorizeSpaService(rawName: string | null | undefined): CategorisedService {
  if (!rawName) return { group: "Other", category: "Other" };
  const s = rawName.toLowerCase();

  // ── Add-ons / mini-treatments (prefix codes) ─────────────────────────────
  if (/^addon\d/i.test(rawName) || /^e\d{1,2}\s/i.test(rawName))
    return { group: "Add-on", category: "Add-on" };
  if (/\baddon\b|\badd[\s-]?on\b/i.test(s))
    return { group: "Add-on", category: "Add-on" };

  // ── F&B / Extras ────────────────────────────────────────────────────────
  if (/prosecco|champagne|wine|cocktail/.test(s))
    return { group: "F&B / Extras", category: "Beverages" };
  if (/breakfast|lunch|dinner|fruit\s*platter|snack|food/.test(s))
    return { group: "F&B / Extras", category: "Food" };
  if (/spa kit rental|sauna use|guest pass|hotel lobby|pool deck|spa room use/.test(s))
    return { group: "F&B / Extras", category: "Facility Use" };

  // ── Hammam ──────────────────────────────────────────────────────────────
  if (/hammam|turkish\s*foam|sea\s*salt\s*exfoliating/.test(s))
    return { group: "Hammam", category: "Hammam" };

  // ── Facials (do BEFORE Massage so "Face & Decollete massage" goes to massage) ──
  if (/\bfacial\b|hydra\s*blue|hydration\s*&?\s*glow|city\s*life|acni\s*pur|douceur\s*marine|extended\s*youth|short\s*and\s*sweet\s*-\s*freshup|white\s*lumination|brightening|fresh\s*up\s*firming/.test(s))
    return { group: "Facial", category: "Facial" };
  if (/\beye\s*(perfection|youth|mask)\b/.test(s))
    return { group: "Facial", category: "Eye Treatment" };

  // ── Body treatments ─────────────────────────────────────────────────────
  if (/cellulite|lymphatic\s*drainage|body\s*glow|body\s*scrub|dry\s*silky\s*scrub|afloat|aqualab|body\s*contour|anticellulite|anti[\s-]*cellulite|muscle\s*recovery/.test(s))
    return { group: "Body Treatment", category: "Body Treatment" };

  // ── Massage (very broad — catches the bulk of services) ─────────────────
  if (/massage|reflexolog|hot\s*stone|signature|antistress|therapeutic|balinese|japanese|thai|hawaiian|lomi[\s-]*lomi|ayurvedic|shirodara|deep\s*tissue|sport\s*massage|indian\s*head|head\s*to\s*toe|hot\s*&?\s*cold/.test(s))
    return { group: "Massage", category: "Massage" };

  // ── Packages (named bundles, multi-element experiences) ─────────────────
  if (/package|spa\s*day|spa\s*party|sparty|around\s*the\s*world|wellness\s*voyage|wellness\s*package|wellness\s*vanity|deluxe|retreat|ritual|escape|pampering|getaway|glow\s*together|time\s*for|time\s*to\s*relax|harmony|fusion|bliss|romantic|valentine|breeze|short\s*&?\s*sweet|just\s*for\s*you|couples?|vip|stress\s*breaker|spa\s*deluxe|fresh\s*up\s*package|conquest|carisma\s*retreat|essential\s*revival|riviera\s*anti[\s-]*stress|magnetic\s*wellness|breakfast\s*promo|pool\s*deck\s*promo|sunny\s*glow|sunny\s*serenity|sweet\s*chill|after\s*work|ladies\s*\d|queen|king|wellness\s*case|let'?s\s*glow|gentleman'?s|her\s*timeless|her\s*quite|forever|eternal\s*harmony|destress\s*fusion|deep\s*release|special\s*offer|guest\s*pass|spa\s*deluxe\s*package/.test(s))
    return { group: "Package", category: "Package" };

  return { group: "Other", category: "Other" };
}
