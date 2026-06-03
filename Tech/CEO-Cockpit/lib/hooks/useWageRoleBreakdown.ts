"use client";

import { useQuery } from "@tanstack/react-query";

// Mirrors the /api/finance/wage-role-breakdown response.
export interface WageRoleBreakdownData {
  roles: {
    manager:      number;
    reception:    number;
    practitioner: number;
    therapist:    number;
    crm:          number;
    unassigned:   number;
  };
  total:            number;
  supplement_total: number;
  has_data:         boolean;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function useWageRoleBreakdown(
  org:      string | null,
  dateFrom: Date,
  dateTo:   Date,
  enabled:  boolean,
) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  return useQuery<WageRoleBreakdownData>({
    queryKey: ["wage-role-breakdown", org, df, dt],
    enabled:  enabled && org !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/finance/wage-role-breakdown?org=${org}&date_from=${df}&date_to=${dt}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}
