"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BrandSlug } from "@/lib/types/ads";

export interface KlaviyoOverview {
  totalSubscribers: number;
  campaignsSent: number;
  activeFlows: number;
  totalRecipients: number;
  totalDelivered: number;
  openRate: number;          // 0-1
  clickRate: number;         // 0-1
  unsubscribeRate: number;   // 0-1
  bounceRate: number;        // 0-1
  hasData: boolean;
  lastSyncedAt: string | null;
  error?: string;
}

const EMPTY: KlaviyoOverview = {
  totalSubscribers: 0,
  campaignsSent: 0,
  activeFlows: 0,
  totalRecipients: 0,
  totalDelivered: 0,
  openRate: 0,
  clickRate: 0,
  unsubscribeRate: 0,
  bounceRate: 0,
  hasData: false,
  lastSyncedAt: null,
};

interface Opts {
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  enabled?: boolean;
}

/** Fast Supabase-backed overview metrics for a brand. Used by all marketing
 *  dashboards. Reads from klaviyo_daily, populated nightly by the ETL. */
export function useKlaviyoOverview({ brand, dateFrom, dateTo, enabled = true }: Opts) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to = format(dateTo, "yyyy-MM-dd");

  const q = useQuery<KlaviyoOverview>({
    queryKey: ["klaviyo-overview", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/email/klaviyo-overview?brand=${brand}&from=${from}&to=${to}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Klaviyo overview ${res.status}`);
      }
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    overview: q.data ?? EMPTY,
    loading: q.isLoading,
    error: q.error?.message ?? q.data?.error ?? null,
  };
}
