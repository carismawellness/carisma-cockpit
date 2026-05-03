export const mindSeed = {
  todayMood: 4, // 1-5
  todayEnergy: 4,
  todayFocus: 3,
  meditationStreakDays: 47,
  meditationMinutesWeek: 95,
  cognitiveBattery: { date: "2026-03-15", processing: 92, workingMemory: 88, executive: 95, overall: 91 },
  last30Days: Array.from({ length: 30 }, (_, i) => ({
    x: `D${i - 29}`,
    mood: Math.round(3.4 + Math.sin(i / 5) * 0.7 + (Math.random() - 0.5) * 0.6),
    energy: Math.round(3.6 + Math.sin(i / 6) * 0.6 + (Math.random() - 0.5) * 0.6),
    focus: Math.round(3.3 + Math.sin(i / 4) * 0.8 + (Math.random() - 0.5) * 0.6),
  })),
};
