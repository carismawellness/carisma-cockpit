"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BrandSlug } from "@/lib/types/ads";

export interface KlaviyoFlowRow {
  flowId: string;
  flowName: string;
  status: string;
  snapshotDate: string;
  recipients: number;
  delivered: number;
  opens: number;
  clicks: number;
  unsubscribes: number;
  openRate: number | null;   // percentage (0-100)
  clickRate: number | null;  // percentage (0-100)
}

interface Opts {
  brand: BrandSlug;
  dateFrom: Date;
  dateTo: Date;
  enabled?: boolean;
}

/** Per-flow Klaviyo metrics from Supabase (klaviyo_flows_daily).
 *  Populated nightly by /api/etl/klaviyo-flows-sync. Reads from DB —
 *  never calls Klaviyo directly at render time. */
export function useKlaviyoFlows({ brand, dateFrom, dateTo, enabled = true }: Opts) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to   = format(dateTo,   "yyyy-MM-dd");

  const q = useQuery<{ flows: KlaviyoFlowRow[]; snapshotCount: number; error?: string }>({
    queryKey: ["klaviyo-flows-db", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/email/klaviyo-flows-db?brand=${brand}&from=${from}&to=${to}`,
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
    flows:   q.data?.flows ?? [],
    loading: q.isLoading,
    error:   q.error?.message ?? q.data?.error ?? null,
  };
}
