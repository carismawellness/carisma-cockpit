"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { KlaviyoApiResponse, KlaviyoOverview } from "@/lib/types/klaviyo";
import type { BrandSlug } from "@/lib/types/ads";

interface UseKlaviyoDataOptions {
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  enabled?: boolean;
}

const EMPTY_OVERVIEW: KlaviyoOverview = {
  totalSubscribers: 0,
  overallOpenRate: 0,
  overallClickRate: 0,
  overallUnsubscribeRate: 0,
  overallBounceRate: 0,
  totalRecipients: 0,
  totalDelivered: 0,
  totalCampaignsSent: 0,
  totalActiveFlows: 0,
};

export function useKlaviyoData({ brand, dateFrom, dateTo, enabled = true }: UseKlaviyoDataOptions) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const query = useQuery<KlaviyoApiResponse>({
    queryKey: ["klaviyo", brand, from, to],
    queryFn: async () => {
      const url = `/api/email/klaviyo?brand=${brand}&from=${from}&to=${to}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Klaviyo API error (${res.status})`);
      }
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    campaigns: query.data?.campaigns ?? [],
    flows: query.data?.flows ?? [],
    overview: query.data?.overview ?? EMPTY_OVERVIEW,
    loading: query.isLoading,
    error: query.error?.message ?? query.data?.error ?? null,
    tokenMissing: query.data?.tokenMissing ?? false,
  };
}
