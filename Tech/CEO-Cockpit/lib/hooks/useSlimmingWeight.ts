"use client";

import { useQuery } from "@tanstack/react-query";
import type { SlimmingWeightData } from "@/lib/types/slimming-weight";

export type { SlimmingWeightData, WeightClient, WeightStatus, WeightTrend } from "@/lib/types/slimming-weight";

export function useSlimmingWeight() {
  const { data, isFetching, error } = useQuery<SlimmingWeightData>({
    queryKey: ["slimming-weight"],
    queryFn: async () => {
      const res = await fetch("/api/sales/slimming-weight");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Failed to fetch weight data (${res.status})`,
        );
      }
      return res.json() as Promise<SlimmingWeightData>;
    },
    staleTime: 30 * 60 * 1000,   // 30 min — sheet doesn't change that often
    retry: 1,
  });

  return {
    data:       data ?? null,
    isFetching,
    error:      error ? (error as Error).message : null,
  };
}
