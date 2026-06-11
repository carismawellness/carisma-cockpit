"use client";

import { useQuery } from "@tanstack/react-query";
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
  days?: number;
  enabled?: boolean;
}

/** Read tracked-keyword rankings from Supabase (populated nightly by GSC ETL). */
export function useGscRankings({ brand, days = 28, enabled = true }: Opts) {
  const q = useQuery<GscRankingsResponse>({
    queryKey: ["gsc-rankings", brand, days],
    queryFn: async () => {
      const res = await fetch(`/api/marketing/gsc-rankings?brand=${brand}&days=${days}`);
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
