"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { BrandSlug } from "@/lib/types/ads";

export interface KlaviyoPopupStats {
  hasData:           boolean;
  viewedCount:       number;
  submittedCount:    number;
  captureRatePct:    number | null;
  targetPct:         number;   // 8
  note?:             string;
}

const EMPTY: KlaviyoPopupStats = {
  hasData:        false,
  viewedCount:    0,
  submittedCount: 0,
  captureRatePct: null,
  targetPct:      8,
};

export function useKlaviyoPopup(brand: BrandSlug, dateFrom: Date, dateTo: Date) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to   = format(dateTo,   "yyyy-MM-dd");

  const q = useQuery<KlaviyoPopupStats>({
    queryKey: ["klaviyo-popup", brand, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/email/klaviyo-popup?brand=${brand}&from=${from}&to=${to}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 60 * 60 * 1000,  // 1 hour — popup metrics don't change fast
    retry: 1,
  });

  return {
    popup:   q.data ?? EMPTY,
    loading: q.isLoading,
    error:   q.error?.message ?? null,
  };
}
