"use client";

import { useQuery } from "@tanstack/react-query";

export type WageRoleBreakdown = {
  byVenueRole:        Record<string, Record<string, number>>;
  byVenueRoleContact: Record<string, Record<string, Record<string, number>>>;
  date_from:  string;
  date_to:    string;
  total_txns: number;
};

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches per-role per-venue wage amounts from Zoho GL transactions.
 * Used by the EBITDA page to populate the Wages & Salaries role sub-rows.
 * Cached for 5 minutes.
 *
 * byVenueRole:        venue_slug -> role -> total amount
 * byVenueRoleContact: venue_slug -> role -> contact_name -> amount
 */
export function useWageSplitByVenue(dateFrom: Date, dateTo: Date) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  const q = useQuery<WageRoleBreakdown>({
    queryKey: ["wage-split-by-venue", df, dt],
    queryFn:  async () => {
      const res = await fetch(
        `/api/finance/wage-role-breakdown?date_from=${df}&date_to=${dt}`,
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
    isLoading:  q.isLoading,
    isFetching: q.isFetching,
    error:      q.error as Error | null,
  };
}
