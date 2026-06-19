"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { AdsApiResponse, BrandSlug } from "@/lib/types/ads";

interface UseAdsDataOptions {
  platform: "meta" | "google";
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  enabled?: boolean;
}

export function useAdsData({ platform, brand, dateFrom, dateTo, enabled = true }: UseAdsDataOptions) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const query = useQuery<AdsApiResponse>({
    queryKey: ["ads", platform, brand, from, to],
    queryFn: async () => {
      const url = `/api/ads/${platform}?brand=${brand}&from=${from}&to=${to}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${platform} API error (${res.status})`);
      }
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  return {
    data: query.data ?? { campaigns: [], totals: { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 } },
    loading: query.isLoading,
    error: query.error?.message ?? query.data?.error ?? null,
    tokenExpired: query.data?.tokenExpired ?? false,
  };
}
