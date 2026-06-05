"use client";

import { useQuery } from "@tanstack/react-query";

export type WageRoleBreakdown = {
  byVenueRole:        Record<string, Record<string, number>>;
  byVenueRoleContact: Record<string, Record<string, Record<string, number>>>;
  date_from:  string;
  date_to:    string;
  total_txns: number;
};

export type WageRoleData = {
  has_data: boolean;
  roles:    Record<string, number>;
  total:    number;
};

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function transformBreakdown(raw: WageRoleBreakdown): WageRoleData {
  const roles: Record<string, number> = {};
  for (const venueRoles of Object.values(raw.byVenueRole)) {
    for (const [role, amount] of Object.entries(venueRoles)) {
      roles[role] = (roles[role] ?? 0) + amount;
    }
  }
  const total = Object.values(roles).reduce((s, v) => s + v, 0);
  return { has_data: total > 0, roles, total };
}

export function useWageRoleBreakdown(
  org: string,
  dateFrom: Date,
  dateTo: Date,
  enabled = true,
) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  const q = useQuery<WageRoleBreakdown>({
    queryKey: ["wage-role-breakdown", org, df, dt],
    enabled,
    queryFn:  async () => {
      const res = await fetch(
        `/api/finance/wage-role-breakdown?date_from=${df}&date_to=${dt}&org=${encodeURIComponent(org)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    breakdown:  q.data,
    data:       q.data ? transformBreakdown(q.data) : undefined,
    isLoading:  q.isLoading,
    isFetching: q.isFetching,
    error:      q.error as Error | null,
  };
}
