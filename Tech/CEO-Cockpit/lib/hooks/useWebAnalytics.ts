"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { WebAnalyticsResult } from "@/app/api/analytics/web/route";

export type { WebAnalyticsResult };

type BrandSlug = "spa" | "aesthetics" | "slimming";

const EMPTY: WebAnalyticsResult = {
  sessions: 0,
  maltaSessions: null,
  maltaPct: null,
  pageViews: 0,
  avgSessionDurationSec: null,
  bounceRatePct: null,
  conversions: 0,
  conversionRatePct: null,
  viewItemCount: null,
  viewItemPct: null,
  addToCartCount: null,
  addToCartPct: null,
  beginCheckoutCount: null,
  beginCheckoutPct: null,
  purchaseCount: null,
  purchasePct: null,
  hasData: false,
};

/**
 * Hook that fetches web analytics (GA4) for a brand and date range.
 * Reads from /api/analytics/web which queries ga4_daily in Supabase.
 */
export function useWebAnalytics(brand: BrandSlug, dateFrom: Date, dateTo: Date) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const q = useQuery<WebAnalyticsResult>({
    queryKey: ["web-analytics", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/analytics/web?brand=${brand}&from=${from}&to=${to}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || `Web analytics ${res.status}`,
        );
      }
      return res.json() as Promise<WebAnalyticsResult>;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    analytics: q.data ?? EMPTY,
    loading: q.isLoading,
    error: q.error?.message ?? null,
  };
}
