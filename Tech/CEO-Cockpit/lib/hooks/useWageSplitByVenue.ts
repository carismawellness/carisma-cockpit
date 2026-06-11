"use client";

import { useQuery } from "@tanstack/react-query";
import { toLocalDateStr } from "@/lib/utils/dates";

export type WageRoleBreakdown = {
  byVenueRole:        Record<string, Record<string, number>>;
  byVenueRoleContact: Record<string, Record<string, Record<string, number>>>;
  date_from:  string;
  date_to:    string;
  total_txns: number;
};

const toIso = toLocalDateStr;

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
      // Parse body safely — the endpoint may return "An error occurred" plain text
      // on a Vercel cold-start crash (200 but non-JSON). Treat any parse failure
      // as an empty breakdown so the rest of the EBITDA page still loads.
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      return body as WageRoleBreakdown;
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
