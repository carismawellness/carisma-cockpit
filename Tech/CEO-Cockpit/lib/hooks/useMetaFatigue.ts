"use client";

import { useQuery } from "@tanstack/react-query";
import type { BrandSlug } from "@/lib/types/ads";
import type { FatigueApiResponse } from "@/app/api/ads/meta/fatigue/route";

export function useMetaFatigue(brand: BrandSlug) {
  return useQuery<FatigueApiResponse>({
    queryKey: ["meta-fatigue", brand],
    queryFn: async () => {
      const res = await fetch(`/api/ads/meta/fatigue?brand=${brand}`);
      if (!res.ok) throw new Error(`Fatigue API error: ${res.status}`);
      return res.json();
    },
    staleTime: 15 * 60 * 1000, // 15 min — matches server revalidate
    gcTime:    30 * 60 * 1000,
  });
}
