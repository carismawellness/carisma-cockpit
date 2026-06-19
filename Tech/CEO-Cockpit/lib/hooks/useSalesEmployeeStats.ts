"use client";

// React-query hook for a single employee's revenue + commission stats
// (GET /api/sales/employee-stats?brand=&slug=&from=&to=).

import { useQuery } from "@tanstack/react-query";
import type { BrandSlug, EmployeeStatsResponse } from "@/lib/sales-employees/types";

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface UseSalesEmployeeStatsResult {
  stats: EmployeeStatsResponse | null;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  /** true when the employee slug doesn't exist for that brand */
  notFound: boolean;
}

export function useSalesEmployeeStats(
  brand: BrandSlug,
  slug: string,
  dateFrom: Date,
  dateTo: Date,
): UseSalesEmployeeStatsResult {
  const fromStr = toDateStr(dateFrom);
  const toStr = toDateStr(dateTo);

  const { data, isLoading, isError, error } = useQuery<EmployeeStatsResponse>({
    queryKey: ["sales-employee-stats", brand, slug, fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ brand, slug, from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/employee-stats?${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(
          (json as { error?: string }).error ?? `HTTP ${res.status}`,
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return json as EmployeeStatsResponse;
    },
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    stats: data ?? null,
    isLoading,
    isError,
    error: error ? (error as Error).message : null,
    notFound: (error as { status?: number } | null)?.status === 404,
  };
}
