export const chartColors = {
  spa: "#B79E61",        // warm gold — carismaspa.com
  aesthetics: "#96B2B2", // muted teal-blue — carismaaesthetics.com
  slimming: "#8EB093",   // sage green — carismaslimming.com
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
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatMinutes(value: number): string {
  return value < 1 ? `${Math.round(value * 60)}s` : `${value.toFixed(1)}m`;
}
