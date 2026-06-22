"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

export type FunnelMode = "cohort" | "flow" | "snapshot";
export type FunnelSource = "all" | "meta";

export interface GhlFunnelData {
  dateFrom: string;
  dateTo: string;
  mode: FunnelMode;
  subtitle?: string;
  sourceFilter?: FunnelSource;
  brands: Record<string, Record<string, number>>;
}

export function useGhlFunnel(
  dateFrom: Date,
  dateTo: Date,
  mode: FunnelMode = "cohort",
  source: FunnelSource = "all",
) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to   = format(dateTo,   "yyyy-MM-dd");

  const { data, isLoading } = useQuery<GhlFunnelData>({
    queryKey: ["ghl-funnel", from, to, mode, source],
    queryFn: async () => {
      const res = await fetch(
        `/api/crm/ghl-funnel?dateFrom=${from}&dateTo=${to}&mode=${mode}&source=${source}`,
      );
      if (!res.ok) throw new Error(`GHL funnel ${res.status}`);
      return res.json() as Promise<GhlFunnelData>;
    },
    staleTime:       5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  return { data, isLoading };
}
