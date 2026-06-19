"use client";

import { useQuery } from "@tanstack/react-query";
import type { SpaServicesMixResponse } from "@/app/api/sales/spa/services-mix/route";

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useSpaServicesMix(dateFrom: Date, dateTo: Date) {
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const query = useQuery<SpaServicesMixResponse>({
    queryKey: ["spa-services-mix", fromStr, toStr],
    queryFn: async () => {
      const qs  = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/spa/services-mix?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  return {
    byService:  query.data?.byService ?? [],
    byGroup:    query.data?.byGroup ?? [],
    totals:     query.data?.totals ?? { revenue: 0, tx_count: 0 },
    qc:         query.data?.qc,
    isLoading:  query.isLoading,
    isFetching: query.isFetching,
    error:      query.error,
  };
}

export type { SpaServicesMixResponse };
