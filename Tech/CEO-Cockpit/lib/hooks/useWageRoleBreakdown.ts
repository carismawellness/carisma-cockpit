"use client";

import { useQuery } from "@tanstack/react-query";

export interface WageRoleData {
  roles: {
    manager:      number;
    reception:    number;
    practitioner: number;
    therapist:    number;
    crm:          number;
    unassigned:   number;
  };
  total:    number;
  has_data: boolean;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Used by EbitdaTransactionsDialog to show role totals when a wages cell
 * is clicked. Calls wage-role-breakdown and sums across all venues.
 * Signature is (org, dateFrom, dateTo, enabled) to match the dialog's
 * existing call pattern.
 *
 * NOTE: currently only covers SPA venue-specific wage accounts.
 */
export function useWageRoleBreakdown(
  org:      string | null,
  dateFrom: Date,
  dateTo:   Date,
  enabled:  boolean,
) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  return useQuery<WageRoleData>({
    queryKey: ["wage-role-breakdown", org, df, dt],
    enabled:  enabled && org !== null,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const res = await fetch(
        `/api/finance/wage-role-breakdown?date_from=${df}&date_to=${dt}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const raw = await res.json();

      // Sum byVenueRole across all venues → flat totals for the dialog table
      const roles = { manager: 0, reception: 0, practitioner: 0, therapist: 0, crm: 0, unassigned: 0 };
      const bvr = (raw.byVenueRole ?? {}) as Record<string, Record<string, number>>;
      for (const roleAmounts of Object.values(bvr)) {
        for (const [role, amount] of Object.entries(roleAmounts)) {
          if (role in roles) (roles as Record<string, number>)[role] += amount;
          else roles.unassigned += amount;
        }
      }
      const total = Object.values(roles).reduce((a, b) => a + b, 0);
      return { roles, total, has_data: (raw.total_rows ?? raw.total_txns ?? 0) > 0 };
    },
  });
}
