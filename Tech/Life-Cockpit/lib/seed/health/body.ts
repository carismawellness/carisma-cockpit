export const bodySeed = {
  weight: { current: 78.4, target: 79, trend: Array.from({ length: 90 }, (_, i) => ({ x: `D${i - 89}`, y: +(78 + Math.sin(i / 14) * 0.6 + (Math.random() - 0.5) * 0.3).toFixed(1) })) },
  bp: { systolic: 118, diastolic: 74, status: "green" as const, trend: Array.from({ length: 30 }, (_, i) => ({ x: `D${i - 29}`, y: Math.round(118 + (Math.random() - 0.5) * 6) })) },
  dexa: { date: "2025-11-04", bodyFatPct: 16.4, almi: 9.2, vat: 0.42, boneTScore: 0.4 },
  cgm: { window: "2026-04-01 → 2026-04-14", avgGlucose: 92, timeInRange: 94, peakAfterMeal: 138, fastingAvg: 87 },
  nutrition: { proteinG: 168, fiberG: 38, eatingWindowHours: 9.5, proteinTarget: 165, fiberTarget: 40 },
};
