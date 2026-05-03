export const personalCapitalSeed = {
  asOf: "2026-04-30",
  liquidNetWorth: 450000,
  illiquidNetWorth: 2_800_000,
  monthlyBurn: 11700,
  yearsOfFreedom: 3.2,
  yofTrend: Array.from({ length: 24 }, (_, i) => {
    const month = i + 1;
    const liquid = 280000 + i * 7800 + (Math.random() - 0.5) * 4000;
    const burn = 10500 + i * 50;
    return { x: `M${i - 23}`, y: +(liquid / (burn * 12)).toFixed(2), liquid: Math.round(liquid), burn: Math.round(burn) };
  }),
  assets: [
    { category: "Cash & equivalents", value: 95000, allocationPct: 21, change1m: 0.4 },
    { category: "Public equities (index)", value: 245000, allocationPct: 54, change1m: 2.1 },
    { category: "Crypto (BTC + ETH)", value: 70000, allocationPct: 16, change1m: -3.8 },
    { category: "Property (Sliema apt deposit)", value: 40000, allocationPct: 9, change1m: 0 },
    { category: "Carisma equity (illiquid)", value: 2_800_000, allocationPct: 0, change1m: 1.2 },
  ],
  burnBreakdown: [
    { category: "Housing", value: 3200 },
    { category: "Food & dining", value: 1800 },
    { category: "Travel", value: 2400 },
    { category: "Health & wellness", value: 1100 },
    { category: "Discretionary", value: 1900 },
    { category: "Other (subs, transport)", value: 1300 },
  ],
};
