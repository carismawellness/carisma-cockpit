export interface WhoopDay {
  date: string;
  recovery: number;
  hrv: number;
  rhr: number;
  sleepHours: number;
  deepSleepMin: number;
  remSleepMin: number;
  strain: number;
}

const oneDay = 24 * 60 * 60 * 1000;
const today = new Date("2026-05-03").getTime();

export const whoopSeed = {
  today: { recovery: 82, hrv: 64, rhr: 51, sleepHours: 7.4, deepSleepMin: 92, strain: 13.1 },
  last30Days: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today - (29 - i) * oneDay);
    const base = 70 + Math.sin(i / 4) * 12 + (Math.random() - 0.5) * 8;
    const recovery = Math.max(35, Math.min(99, Math.round(base)));
    return {
      date: d.toISOString().slice(0, 10),
      recovery,
      hrv: Math.round(58 + recovery * 0.15 + (Math.random() - 0.5) * 5),
      rhr: Math.round(54 - recovery * 0.05 + (Math.random() - 0.5) * 3),
      sleepHours: +(6.5 + Math.random() * 1.8).toFixed(1),
      deepSleepMin: Math.round(70 + (recovery - 70) * 0.6 + (Math.random() - 0.5) * 15),
      remSleepMin: Math.round(85 + Math.random() * 30),
      strain: +(8 + Math.random() * 9).toFixed(1),
    } as WhoopDay;
  }),
};

export type WhoopSeed = typeof whoopSeed;
