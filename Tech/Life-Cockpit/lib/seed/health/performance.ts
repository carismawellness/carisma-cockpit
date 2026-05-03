export const performanceSeed = {
  vo2: {
    current: 48.2,
    percentile: 92,
    trend: [{ x: "Jan 24", y: 42.1 }, { x: "Jul 24", y: 44.6 }, { x: "Jan 25", y: 45.8 }, { x: "Jul 25", y: 46.9 }, { x: "Jan 26", y: 47.5 }, { x: "Apr 26", y: 48.2 }],
  },
  lifts: [
    { name: "Trap-bar deadlift", current: 180, unit: "kg", lastUpdate: "2026-04-28", trend: "▲ +5 vs Q1" },
    { name: "Weighted pull-up", current: 30, unit: "kg added", lastUpdate: "2026-04-26", trend: "▲ +2.5 vs Q1" },
    { name: "Goblet squat", current: 40, unit: "kg ×10", lastUpdate: "2026-04-30", trend: "→ stable" },
    { name: "Farmer's carry", current: 80, unit: "kg/hand · 40m", lastUpdate: "2026-04-29", trend: "▲ +5kg vs Q1" },
    { name: "Dead hang", current: 92, unit: "sec", lastUpdate: "2026-04-25", trend: "▲ +12s vs Q1" },
  ],
  grip: { dominant: 56, nonDominant: 52, target: 55 },
};
