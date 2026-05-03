export interface LabMarker {
  code: string;
  name: string;
  value: number;
  unit: string;
  optimalLow: number;
  optimalHigh: number;
  refLow: number;
  refHigh: number;
  trend: { x: string; y: number }[];
  status: "green" | "amber" | "red";
}

export interface ImagingStudy {
  date: string;
  modality: string;
  region: string;
  facility: string;
  impression: string;
}

export interface ScreeningItem {
  name: string;
  lastDone: string | null;
  nextDue: string;
  status: "green" | "amber" | "red";
}

export interface MedicationItem {
  name: string;
  dose: string;
  indication: string;
  prescriber: string;
  startDate: string;
  active: boolean;
}

export interface VaccineItem {
  name: string;
  date: string;
  nextDue: string | null;
}

export const recordsSeed = {
  labs: {
    lastDraw: "2026-04-12",
    nextDue: "2026-07-12",
    markers: [
      { code: "APOB", name: "ApoB", value: 88, unit: "mg/dL", optimalLow: 0, optimalHigh: 60, refLow: 0, refHigh: 100, status: "red", trend: [{ x: "Q1 24", y: 76 }, { x: "Q3 24", y: 82 }, { x: "Q1 25", y: 79 }, { x: "Q3 25", y: 84 }, { x: "Q1 26", y: 88 }] },
      { code: "LDL", name: "LDL-C", value: 118, unit: "mg/dL", optimalLow: 0, optimalHigh: 100, refLow: 0, refHigh: 130, status: "amber", trend: [{ x: "Q1 24", y: 105 }, { x: "Q3 24", y: 110 }, { x: "Q1 25", y: 112 }, { x: "Q3 25", y: 114 }, { x: "Q1 26", y: 118 }] },
      { code: "HDL", name: "HDL-C", value: 58, unit: "mg/dL", optimalLow: 50, optimalHigh: 100, refLow: 40, refHigh: 100, status: "green", trend: [{ x: "Q1 24", y: 52 }, { x: "Q3 24", y: 55 }, { x: "Q1 25", y: 56 }, { x: "Q3 25", y: 57 }, { x: "Q1 26", y: 58 }] },
      { code: "TG", name: "Triglycerides", value: 88, unit: "mg/dL", optimalLow: 0, optimalHigh: 100, refLow: 0, refHigh: 150, status: "green", trend: [{ x: "Q1 24", y: 95 }, { x: "Q3 24", y: 92 }, { x: "Q1 25", y: 90 }, { x: "Q3 25", y: 89 }, { x: "Q1 26", y: 88 }] },
      { code: "HBA1C", name: "HbA1c", value: 5.2, unit: "%", optimalLow: 4.5, optimalHigh: 5.4, refLow: 4.0, refHigh: 5.7, status: "green", trend: [{ x: "Q1 24", y: 5.4 }, { x: "Q3 24", y: 5.3 }, { x: "Q1 25", y: 5.3 }, { x: "Q3 25", y: 5.2 }, { x: "Q1 26", y: 5.2 }] },
      { code: "FINS", name: "Fasting Insulin", value: 4.8, unit: "µIU/mL", optimalLow: 2, optimalHigh: 5, refLow: 2, refHigh: 25, status: "green", trend: [{ x: "Q1 24", y: 6.2 }, { x: "Q3 24", y: 5.5 }, { x: "Q1 25", y: 5.1 }, { x: "Q3 25", y: 4.9 }, { x: "Q1 26", y: 4.8 }] },
      { code: "HSCRP", name: "hs-CRP", value: 0.8, unit: "mg/L", optimalLow: 0, optimalHigh: 1, refLow: 0, refHigh: 3, status: "green", trend: [{ x: "Q1 24", y: 1.4 }, { x: "Q3 24", y: 1.1 }, { x: "Q1 25", y: 0.9 }, { x: "Q3 25", y: 0.8 }, { x: "Q1 26", y: 0.8 }] },
      { code: "VITD", name: "Vit D 25-OH", value: 48, unit: "ng/mL", optimalLow: 40, optimalHigh: 80, refLow: 30, refHigh: 100, status: "green", trend: [{ x: "Q1 24", y: 32 }, { x: "Q3 24", y: 38 }, { x: "Q1 25", y: 42 }, { x: "Q3 25", y: 45 }, { x: "Q1 26", y: 48 }] },
      { code: "TT", name: "Total Testosterone", value: 685, unit: "ng/dL", optimalLow: 600, optimalHigh: 900, refLow: 264, refHigh: 916, status: "green", trend: [{ x: "Q1 24", y: 612 }, { x: "Q3 24", y: 645 }, { x: "Q1 25", y: 668 }, { x: "Q3 25", y: 678 }, { x: "Q1 26", y: 685 }] },
      { code: "FERR", name: "Ferritin", value: 142, unit: "ng/mL", optimalLow: 50, optimalHigh: 200, refLow: 30, refHigh: 400, status: "green", trend: [{ x: "Q1 24", y: 135 }, { x: "Q3 24", y: 138 }, { x: "Q1 25", y: 140 }, { x: "Q3 25", y: 141 }, { x: "Q1 26", y: 142 }] },
    ] as LabMarker[],
  },
  imaging: [
    { date: "2025-11-04", modality: "DEXA", region: "Whole body", facility: "Mater Dei Hospital", impression: "ALMI 8.9 → 9.2 kg/m². Body fat 16.4%. Bone density T-score +0.4 (normal)." },
    { date: "2025-09-12", modality: "MRI", region: "Lumbar spine", facility: "Saint James Hospital", impression: "Mild L4-L5 disc desiccation. No herniation. Recheck in 24 mo if symptoms recur." },
    { date: "2025-06-22", modality: "Echocardiogram", region: "Cardiac", facility: "Mater Dei", impression: "Normal LV function (EF 62%). No valve abnormalities." },
    { date: "2024-08-10", modality: "CAC", region: "Coronary", facility: "Synlab Malta", impression: "Agatston score 0. Repeat in 5 yr." },
  ] as ImagingStudy[],
  screenings: [
    { name: "Lipid panel + ApoB", lastDone: "2026-04-12", nextDue: "2026-07-12", status: "green" },
    { name: "Skin check (dermatology)", lastDone: "2025-10-03", nextDue: "2026-10-03", status: "green" },
    { name: "Eye exam", lastDone: "2024-06-15", nextDue: "2026-06-15", status: "amber" },
    { name: "DEXA whole body", lastDone: "2025-11-04", nextDue: "2027-11-04", status: "green" },
    { name: "CAC scan", lastDone: "2024-08-10", nextDue: "2029-08-10", status: "green" },
    { name: "Colonoscopy (baseline)", lastDone: null, nextDue: "2031-01-01", status: "green" },
    { name: "Audiogram baseline", lastDone: null, nextDue: "2026-12-31", status: "amber" },
    { name: "Dental cleaning", lastDone: "2026-02-20", nextDue: "2026-08-20", status: "green" },
    { name: "STI panel", lastDone: "2026-01-15", nextDue: "2027-01-15", status: "green" },
  ] as ScreeningItem[],
  medications: [
    { name: "Multivitamin (active)", dose: "1 cap", indication: "Baseline micronutrient", prescriber: "Self", startDate: "2023-01-01", active: true },
  ] as MedicationItem[],
  vaccines: [
    { name: "Tdap", date: "2022-04-12", nextDue: "2032-04-12" },
    { name: "Influenza", date: "2025-10-22", nextDue: "2026-10-22" },
    { name: "COVID-19 (booster)", date: "2025-11-08", nextDue: null },
    { name: "HPV (Gardasil 9, dose 3 of 3)", date: "2024-08-10", nextDue: null },
    { name: "Hepatitis A (booster)", date: "2023-05-12", nextDue: "2033-05-12" },
  ] as VaccineItem[],
  familyHistory: [
    { relative: "Father", conditions: "Hypertension (dx age 55), Type 2 diabetes (dx 62)" },
    { relative: "Mother", conditions: "Hashimoto's thyroiditis (dx 48)" },
    { relative: "Paternal grandfather", conditions: "MI age 68; CABG age 72; deceased 79" },
    { relative: "Maternal grandmother", conditions: "Breast cancer (dx 71); alive 88" },
  ],
  providers: [
    { name: "Dr. Anna Borg", specialty: "Primary care (PCP)", clinic: "Mater Dei Internal Medicine", lastVisit: "2026-04-12" },
    { name: "Dr. Marco Vella", specialty: "Cardiology", clinic: "Saint James Cardiac Centre", lastVisit: "2025-06-22" },
    { name: "Dr. Carla Spiteri", specialty: "Dermatology", clinic: "Carisma Aesthetics", lastVisit: "2025-10-03" },
    { name: "Dr. James Camilleri", specialty: "Dentistry", clinic: "Sliema Dental", lastVisit: "2026-02-20" },
  ],
};
