// slug → hotel config. Monthly revenue targets in EUR ex-VAT.
// Update `monthlyTarget` values as actual targets are confirmed.
export interface HotelConfig {
  locId:         number;
  name:          string;
  shortName:     string;
  color:         string;
  monthlyTarget: number; // EUR ex-VAT
}

export const HOTEL_SLUG_MAP: Record<string, HotelConfig> = {
  inter:     { locId: 1, name: "InterContinental Malta",   shortName: "InterContinental", color: "#4A6FA5", monthlyTarget: 65_000 },
  hugos:     { locId: 2, name: "Hugo's Boutique Hotel",    shortName: "Hugo's",           color: "#7C9E9C", monthlyTarget: 50_000 },
  hyatt:     { locId: 3, name: "Hyatt Regency Malta",      shortName: "Hyatt",            color: "#B79E61", monthlyTarget: 32_000 },
  ramla:     { locId: 4, name: "Radisson Blu Ramla Bay",   shortName: "Ramla Bay",        color: "#6B9E7C", monthlyTarget: 55_000 },
  riviera:   { locId: 5, name: "Labranda Riviera Hotel",   shortName: "Riviera",          color: "#D4845A", monthlyTarget: 35_000 },
  odycy:     { locId: 6, name: "Odycy Hotel",              shortName: "Odycy",            color: "#5A8FD4", monthlyTarget: 30_000 },
  excelsior: { locId: 7, name: "Excelsior Grand Hotel",    shortName: "Excelsior",        color: "#9B6BB0", monthlyTarget: 30_000 },
  novotel:   { locId: 8, name: "Novotel St Julian's",      shortName: "Novotel",          color: "#C04A4A", monthlyTarget: 20_000 },
};
