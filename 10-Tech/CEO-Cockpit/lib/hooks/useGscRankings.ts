"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BrandSlug } from "@/lib/types/ads";

export interface GscKeywordRow {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  positionPrev: number | null;
  positionChange: number | null;
  trend: { date: string; position: number | null; clicks: number }[];
  lastSeen: string | null;
}

export interface GscRankingsResponse {
  brand: BrandSlug;
  window: { startDate: string; endDate: string; days: number };
  keywords: GscKeywordRow[];
  error?: string;
}

interface Opts {
  brand: BrandSlug;
  /** Start of the period to summarize. Required. */
  dateFrom: Date;
  /** End of the period to summarize. Required. */
  dateTo: Date;
  enabled?: boolean;
}

/** Read tracked-keyword rankings from Supabase (populated nightly by GSC ETL).
 *  Aggregates the daily rows in [dateFrom, dateTo] into one row per keyword,
 *  and compares against the equal-length window immediately before for the
 *  Δ position change indicator. */
export function useGscRankings({ brand, dateFrom, dateTo, enabled = true }: Opts) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const q = useQuery<GscRankingsResponse>({
    queryKey: ["gsc-rankings", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/marketing/gsc-rankings?brand=${brand}&from=${from}&to=${to}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `GSC rankings ${res.status}`);
      }
      return res.json();
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  return {
    keywords: q.data?.keywords ?? [],
    window: q.data?.window,
    loading: q.isLoading,
    error: q.error?.message ?? q.data?.error ?? null,
  };
}
