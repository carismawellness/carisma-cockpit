import { useQuery } from "@tanstack/react-query";

export interface WixMonthlyPoint {
  month: string;
  label: string;
  current: number;
  ly: number;
  orders: number;
  lyOrders: number;
  yoyPct: number | null;
}

export interface WixWeeklyPoint {
  weekStart: string;
  label: string;
  current: number;
  ly: number;
  orders: number;
  lyOrders: number;
  yoyDelta: number;
  yoyPct: number | null;
}

export interface WixOrdersStats {
  monthly: WixMonthlyPoint[];
  weekly: WixWeeklyPoint[];
}

export function useWixOrdersStats() {
  return useQuery<WixOrdersStats>({
    queryKey: ["wix-orders-stats"],
    queryFn: () => fetch("/api/wix-orders-stats").then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
  });
}
