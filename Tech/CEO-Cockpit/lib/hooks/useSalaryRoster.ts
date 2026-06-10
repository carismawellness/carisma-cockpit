"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const SPA_SLUGS = new Set(["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"]);
const MIN_TOKEN = 3;

function toDateParam(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Strip venue suffix from spa therapist names: "TINA-HUGOS" → "tina", "PHACHA" → "phacha"
function stripVenueSuffix(raw: string): string {
  const s = (raw || "").trim();
  const dashIdx = s.indexOf("-");
  return (dashIdx > 0 ? s.slice(0, dashIdx) : s).toLowerCase().trim();
}

interface RosterEntry {
  venue: string;
  employee_name: string;
  salary: number;
}

// Build an unambiguous token → salary map from a name→salary map.
// A token is unambiguous if only one full name contains it.
function buildTokenMap(nameToSalary: Map<string, number>): Map<string, number> {
  const tokenToNames = new Map<string, Set<string>>();
  for (const normName of nameToSalary.keys()) {
    for (const token of normName.split(/\s+/).filter(t => t.length >= MIN_TOKEN)) {
      const s = tokenToNames.get(token) ?? new Set();
      s.add(normName);
      tokenToNames.set(token, s);
    }
  }
  const result = new Map<string, number>();
  for (const [token, names] of tokenToNames) {
    if (names.size === 1) result.set(token, nameToSalary.get([...names][0])!);
  }
  return result;
}

export function useSalaryRoster(dateFrom: Date, dateTo: Date) {
  const { data, isLoading } = useQuery({
    queryKey: ["salary-roster", toDateParam(dateFrom), toDateParam(dateTo)],
    queryFn: async () => {
      const res = await fetch(
        `/api/finance/salary-roster?date_from=${toDateParam(dateFrom)}&date_to=${toDateParam(dateTo)}`
      );
      if (!res.ok) return { data: [] as RosterEntry[] };
      return res.json() as Promise<{ data: RosterEntry[] }>;
    },
    staleTime: 5 * 60_000,
  });

  const { aesTokenMap, slmTokenMap, spaTokenMap } = useMemo(() => {
    const aesByName = new Map<string, number>();
    const slmByName = new Map<string, number>();
    const spaByName = new Map<string, number>(); // aggregated across all spa venues

    for (const row of data?.data ?? []) {
      const normName = row.employee_name.toLowerCase().trim().replace(/\s+/g, " ");
      if (row.venue === "aesthetics") {
        aesByName.set(normName, (aesByName.get(normName) ?? 0) + row.salary);
      } else if (row.venue === "slimming") {
        slmByName.set(normName, (slmByName.get(normName) ?? 0) + row.salary);
      } else if (SPA_SLUGS.has(row.venue)) {
        spaByName.set(normName, (spaByName.get(normName) ?? 0) + row.salary);
      }
    }

    return {
      aesTokenMap: buildTokenMap(aesByName),
      slmTokenMap: buildTokenMap(slmByName),
      spaTokenMap: buildTokenMap(spaByName),
    };
  }, [data]);

  // Look up salary for an aesthetics person by display name (e.g. "Giovanni")
  function getAesSalary(displayName: string): number | null {
    for (const token of displayName.toLowerCase().split(/\s+/).filter(t => t.length >= MIN_TOKEN)) {
      const s = aesTokenMap.get(token);
      if (s !== undefined) return s;
    }
    return null;
  }

  // Look up salary for a slimming staff member by display name (e.g. "Sarah")
  function getSlmSalary(displayName: string): number | null {
    for (const token of displayName.toLowerCase().split(/\s+/).filter(t => t.length >= MIN_TOKEN)) {
      const s = slmTokenMap.get(token);
      if (s !== undefined) return s;
    }
    return null;
  }

  // Look up salary for a spa therapist — handles "TINA-HUGOS" style names
  function getSpaSalary(displayName: string): number | null {
    const base = stripVenueSuffix(displayName);
    for (const token of base.split(/\s+/).filter(t => t.length >= MIN_TOKEN)) {
      const s = spaTokenMap.get(token);
      if (s !== undefined) return s;
    }
    return null;
  }

  return { getAesSalary, getSlmSalary, getSpaSalary, isLoading };
}
