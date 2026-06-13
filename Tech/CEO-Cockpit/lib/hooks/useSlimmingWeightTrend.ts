"use client";

import { useQuery } from "@tanstack/react-query";
import type { SlimmingWeightTrendData } from "@/lib/types/slimming-weight";

export type { SlimmingWeightTrendData, WeeklyTrendPoint } from "@/lib/types/slimming-weight";

export function useSlimmingWeightTrend() {
  const { data, isFetching, error } = useQuery<SlimmingWeightTrendData>({
    queryKey: ["slimming-weight-trend"],
    queryFn: async () => {
      const res = await fetch("/api/sales/slimming-weight-trend");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            `Failed to fetch weight trend (${res.status})`,
        );
      }
      return res.json() as Promise<SlimmingWeightTrendData>;
    },
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  return {
    data:       data ?? null,
    isFetching,
    error:      error ? (error as Error).message : null,
  };
}
