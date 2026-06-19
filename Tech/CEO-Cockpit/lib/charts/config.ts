import { BRAND, LY_OVERLAY } from "@/lib/constants/design-tokens";

/**
 * Generic chart palette. Brand entries route through the canonical BRAND tokens
 * (lib/constants/design-tokens.ts) — the SINGLE source of truth — so they never
 * drift. These are the `soft` tints, used as a light multi-series palette in
 * non-brand-segmented charts. For any chart that REPRESENTS a brand, import
 * `BRAND` directly and use `BRAND.<brand>.dark` for the series.
 */
export const chartColors = {
  spa: BRAND.spa.soft,        // warm sand — carismaspa.com
  aesthetics: BRAND.aesthetics.soft, // soft teal — carismaaesthetics.com
  slimming: BRAND.slimming.soft,   // sage green — carismaslimming.com
  target: "#E07A5F",          // coral — shared accent (non-brand)
  budget: LY_OVERLAY,         // neutral gray — prior-period / budget
} as const;

export const chartDefaults = {
  margin: { top: 5, right: 30, left: 20, bottom: 5 },
  strokeWidth: 2,
  dotRadius: 4,
  animationDuration: 300,
} as const;

export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "€0.0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}€${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}€${(abs / 1_000).toFixed(1)}K`;
  return `${sign}€${abs.toFixed(1)}`;
}

export function formatNumberCompact(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(1)}`;
}

export function formatMultiplier(value: number): string {
  if (!Number.isFinite(value)) return "0.0x";
  return `${value.toFixed(1)}x`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatMinutes(value: number): string {
  return value < 1 ? `${Math.round(value * 60)}s` : `${value.toFixed(1)}m`;
}
