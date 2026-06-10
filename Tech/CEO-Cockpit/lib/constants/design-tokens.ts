export const colors = {
  navy: "#1B3A4B",
  navyLight: "#2A5066",
  navyDark: "#0F2433",
  gold: "#B79E61",
  goldLight: "#D4BE8A",
  goldDark: "#8A7744",
  goldBg: "#FBF7EF",
  warmWhite: "#FAFAF8",
  warmGray: "#F5F3EE",
  warmBorder: "#F0EDE8",
  charcoal: "#1A1A1A",
  textSecondary: "#6B7280",
  green: "#059669",
  red: "#DC2626",
  amber: "#D97706",
} as const;

/**
 * Canonical Carisma brand palette.
 * `dark` = primary brand color for solid fills, text on light backgrounds.
 * `soft` = pastel tint for backgrounds, LY/prior-period companion bars, badges.
 * Use these everywhere — no ad-hoc indigo / generic chart colors.
 */
export const BRAND = {
  spa:        { dark: "#8C7A5A", soft: "#EFE7D7" },
  aesthetics: { dark: "#3B7676", soft: "#DEEBEB" },
  slimming:   { dark: "#3D6B3D", soft: "#C9D8C1" },
} as const;

export type BrandKey = keyof typeof BRAND;

/** Same period last year — neutral gray, used for overlay lines/bars across brands. */
export const LY_OVERLAY = "#9CA3AF";

/** Positive / negative YoY badge tokens — pair fg+bg for consistent badges. */
export const YOY_BADGE = {
  positive: { fg: "#047857", bg: "#ECFDF5" },
  negative: { fg: "#DC2626", bg: "#FEF2F2" },
} as const;
