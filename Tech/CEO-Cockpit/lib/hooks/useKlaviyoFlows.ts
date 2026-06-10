"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BrandSlug } from "@/lib/types/ads";

export interface KlaviyoFlowRow {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  recipients: number;
  delivered: number;
  openRate: number;          // 0-1
  clickRate: number;         // 0-1
  unsubscribeRate: number;   // 0-1
  bounceRate: number;        // 0-1
  clicks: number;
  opensUnique: number;
}

interface Opts {
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  enabled?: boolean;
}

/** Per-flow live metrics for a brand over a date range. Hits Klaviyo's
 *  flow-values-report directly — slower than the overview but isolated so it
 *  doesn't block the rest of the dashboard. */
export function useKlaviyoFlows({ brand, dateFrom, dateTo, enabled = true }: Opts) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const q = useQuery<{ flows: KlaviyoFlowRow[]; error?: string; tokenMissing?: boolean }>({
    queryKey: ["klaviyo-flows", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/email/klaviyo-flows?brand=${brand}&from=${from}&to=${to}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Klaviyo flows ${res.status}`);
      }
      return res.json();
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  return {
    flows: q.data?.flows ?? [],
    loading: q.isLoading,
    error: q.error?.message ?? q.data?.error ?? null,
    tokenMissing: q.data?.tokenMissing ?? false,
  };
}
