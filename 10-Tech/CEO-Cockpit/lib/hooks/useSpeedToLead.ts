"use client";

import { useQuery } from "@tanstack/react-query";
import { toLocalDateStr } from "@/lib/utils/dates";
import type { StlBucket } from "@/lib/utils/business-hours";

export interface StlSummary {
  total: number;
  responded: number;
  pending: number;
  approx: number;
  median_min: number;
  mean_min: number;
  within_sla_pct: number;
  buckets: Record<StlBucket, number>;
}

export interface StlAgentSummary extends StlSummary {
  agent_name: string;
}

export interface SpeedToLeadData {
  dateFrom: string;
  dateTo: string;
  bucketOrder: StlBucket[];
  brands: Record<string, StlSummary>;
  agents: StlAgentSummary[];
}

export function useSpeedToLead(dateFrom: Date, dateTo: Date, brandFilter: string | null) {
  const from = toLocalDateStr(dateFrom);
  const to = toLocalDateStr(dateTo);

  const { data, isLoading, isError, error } = useQuery<SpeedToLeadData>({
    queryKey: ["speed-to-lead", from, to, brandFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to });
      if (brandFilter) params.set("brand", brandFilter);
      const res = await fetch(`/api/crm/speed-to-lead?${params.toString()}`);
      if (!res.ok) throw new Error(`speed-to-lead ${res.status}`);
      return res.json() as Promise<SpeedToLeadData>;
    },
    staleTime: 5 * 60 * 1000,
  });

  return { data, isLoading, isError, error: error instanceof Error ? error.message : null };
}
