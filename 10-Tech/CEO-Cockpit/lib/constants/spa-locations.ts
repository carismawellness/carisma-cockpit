/**
 * Canonical Spa location colour palette — single source of truth.
 *
 * Colours are matched to the design reference palette and extended for
 * all active locations. Use these everywhere spa hotels appear in charts.
 *
 * ID  Name            Colour
 * ─── ─────────────── ──────────────────────
 *  1  Inter           #4BA9A4  teal
 *  2  Hugos           #5B96D4  blue
 *  3  Hyatt           #6EAE74  sage green
 *  4  Ramla           #9575CD  lavender
 *  5  Labranda        #F0A030  orange
 *  6  Sunny Coast     #B04FB8  purple
 *  7  Excelsior       #E06870  coral
 *  8  Novotel         #5C72C4  indigo
 * 11  Qawra (closed)  #9CA3AF  grey
 * 12  Seashells       #6B7280  dark grey
 */

/** Lookup by Supabase / Lapis location_id. */
export const SPA_LOCATION_PALETTE: Record<number, { name: string; color: string }> = {
  1:  { name: "Inter",              color: "#4BA9A4" },
  2:  { name: "Hugos",              color: "#5B96D4" },
  3:  { name: "Hyatt",              color: "#6EAE74" },
  4:  { name: "Ramla",              color: "#9575CD" },
  5:  { name: "Labranda",           color: "#F0A030" },
  6:  { name: "Sunny Coast",        color: "#B04FB8" },
  7:  { name: "Excelsior",          color: "#E06870" },
  8:  { name: "Novotel",            color: "#5C72C4" },
  11: { name: "Qawra (closed)",     color: "#9CA3AF" },
  12: { name: "Seashells (closed)", color: "#6B7280" },
};

/**
 * Lookup by display name. Covers both the Cockpit datasheet names and
 * the Supabase/Lapis names where they differ (Riviera ↔ Labranda,
 * Odycy ↔ Sunny Coast, Inter ↔ InterContinental).
 */
export const SPA_LOCATION_COLOR_BY_NAME: Record<string, string> = {
  "Inter":              "#4BA9A4",
  "InterContinental":   "#4BA9A4",
  "Hugos":              "#5B96D4",
  "Hyatt":              "#6EAE74",
  "Ramla":              "#9575CD",
  "Ramla Bay":          "#9575CD",
  "Labranda":           "#F0A030",
  "Riviera":            "#F0A030",
  "Sunny Coast":        "#B04FB8",
  "Odycy":              "#B04FB8",
  "Excelsior":          "#E06870",
  "Novotel":            "#5C72C4",
  "Qawra (closed)":     "#9CA3AF",
  "Seashells (closed)": "#6B7280",
};

/** Fallback for unknown locations. */
export const SPA_LOCATION_FALLBACK_COLOR = "#9CA3AF";
