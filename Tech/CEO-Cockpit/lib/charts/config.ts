export const chartColors = {
  spa: "#EFE7D7",        // warm sand — carismaspa.com
  aesthetics: "#DEEBEB", // soft teal — carismaaesthetics.com
  slimming: "#C9D8C1",   // sage green — carismaslimming.com
  target: "#E07A5F",     // coral — shared accent
  budget: "#9CA3AF",     // neutral gray
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
