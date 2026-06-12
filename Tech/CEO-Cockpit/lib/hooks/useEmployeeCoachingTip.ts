"use client";
import { useQuery } from "@tanstack/react-query";

export interface TipParams {
  slug: string;
  brand: string;
  from: string;
  to: string;
  commissionTotal: number;
  retailRevenue: number;
  avgTicket: number;
  activeDays: number;
  prevCommissionTotal?: number;
}

export function useEmployeeCoachingTip(params: TipParams | null) {
  return useQuery<string | null>({
    queryKey: ["coaching-tip", params?.slug, params?.brand, params?.from],
    enabled: Boolean(params?.slug),
    staleTime: 60 * 60 * 1000, // re-fetch after 1 hour
    queryFn: async () => {
      if (!params) return null;
      const sp = new URLSearchParams({
        slug: params.slug,
        brand: params.brand,
        from: params.from,
        to: params.to,
        commission_total: String(params.commissionTotal),
        retail_revenue: String(params.retailRevenue),
        avg_ticket: String(params.avgTicket),
        active_days: String(params.activeDays),
      });
      if (params.prevCommissionTotal !== undefined) {
        sp.set("prev_commission_total", String(params.prevCommissionTotal));
      }
      const res = await fetch(`/api/cockpit/employee-coaching-tip?${sp}`);
      if (!res.ok) return null;
      const data = await res.json() as { tip?: string };
      return data.tip ?? null;
    },
  });
}
