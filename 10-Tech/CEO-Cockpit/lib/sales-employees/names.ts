// Name normalization + employee lookup for revenue-data → employee matching.
//
// Names in the Cockpit sheets vary in case and spacing ("Laura Camila",
// "LAURA  CAMILA ") — all matching happens on normalizeName(): uppercase,
// collapse whitespace, trim. An employee matches a data name when the
// normalized display_name OR any normalized alias equals the normalized
// data name.

import type { SalesEmployee } from "./types";

export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a lookup of normalized name → employee for a set of employees
 * (callers should pre-filter to a single brand — slugs are unique but
 * data names are only unique per brand).
 */
export function buildNameLookup<T extends SalesEmployee>(
  employees: T[],
): Map<string, T> {
  const lookup = new Map<string, T>();
  for (const emp of employees) {
    const display = normalizeName(emp.display_name);
    if (display) lookup.set(display, emp);
    for (const alias of emp.aliases ?? []) {
      const norm = normalizeName(alias);
      if (norm && !lookup.has(norm)) lookup.set(norm, emp);
    }
  }
  return lookup;
}
