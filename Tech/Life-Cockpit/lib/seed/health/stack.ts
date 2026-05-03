export interface SupplementItem {
  name: string;
  dose: string;
  cadence: string;
  category: "core" | "performance" | "longevity" | "sleep";
  adherence: number; // 0-100 over last 30d
}

export interface ProtocolDose {
  name: string;
  weeklyTarget: string;
  weeklyActual: string;
  status: "green" | "amber" | "red";
}

export const stackSeed = {
  supplements: [
    { name: "Creatine monohydrate", dose: "5 g", cadence: "Daily AM", category: "performance", adherence: 96 },
    { name: "Vitamin D3 + K2", dose: "5000 IU / 100 µg", cadence: "Daily AM with fat", category: "core", adherence: 92 },
    { name: "Magnesium glycinate", dose: "400 mg", cadence: "Pre-bed", category: "sleep", adherence: 78 },
    { name: "Omega-3 (EPA+DHA)", dose: "2 g", cadence: "Daily AM", category: "core", adherence: 88 },
    { name: "Rapamycin", dose: "6 mg", cadence: "Weekly Sun", category: "longevity", adherence: 100 },
    { name: "Berberine", dose: "500 mg ×3", cadence: "Pre-meals", category: "longevity", adherence: 71 },
    { name: "B-complex (methylated)", dose: "1 cap", cadence: "Daily AM", category: "core", adherence: 90 },
    { name: "Ashwagandha (KSM-66)", dose: "600 mg", cadence: "Pre-bed", category: "sleep", adherence: 65 },
  ] satisfies SupplementItem[],
  protocols: [
    { name: "Sauna (≥80°C)", weeklyTarget: "4× × 20 min", weeklyActual: "3× × 22 min", status: "amber" },
    { name: "Cold plunge (≤10°C)", weeklyTarget: "11 min total", weeklyActual: "13 min", status: "green" },
    { name: "Zone 2 cardio", weeklyTarget: "180 min", weeklyActual: "165 min", status: "amber" },
    { name: "Strength sessions", weeklyTarget: "4×", weeklyActual: "4×", status: "green" },
    { name: "Breathwork", weeklyTarget: "5× × 10 min", weeklyActual: "2× × 8 min", status: "red" },
  ] satisfies ProtocolDose[],
  grooming: {
    am: ["Cleanser (CeraVe)", "Vitamin C serum (15%)", "Niacinamide", "SPF 50"],
    pm: ["Double cleanse", "Retinol 0.5% (Mon/Wed/Fri)", "Peptide moisturizer"],
    weekly: ["Exfoliating mask Sun", "Beard trim Sat", "Hair appointment every 4 weeks"],
    nextTreatment: "Microneedling at Carisma Aesthetics — 14 May",
  },
};
