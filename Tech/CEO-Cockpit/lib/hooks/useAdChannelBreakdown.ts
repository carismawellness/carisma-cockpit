"use client";

import { useQuery } from "@tanstack/react-query";
import { toLocalDateStr } from "@/lib/utils/dates";

export type AdChannelBreakdown = {
  channelTotals: Record<string, number>;
  channelShares: Record<string, number>;
  grandTotal:    number;
  date_from:     string;
  date_to:       string;
};

const toIso = toLocalDateStr;

/**
 * Fetches advertising channel shares (Meta/Google/Klaviyo/Misc) from
 * transactions_raw (which has real contact names). Used to split each
 * venue advertising total proportionally by channel.
 */
export function useAdChannelBreakdown(dateFrom: Date, dateTo: Date) {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  const q = useQuery<AdChannelBreakdown>({
    queryKey: ["ad-channel-breakdown", df, dt],
    queryFn: async () => {
      const res = await fetch(`/api/finance/ad-channel-breakdown?date_from=${df}&date_to=${dt}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body as AdChannelBreakdown;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return { adChannelData: q.data, isLoading: q.isLoading };
}
