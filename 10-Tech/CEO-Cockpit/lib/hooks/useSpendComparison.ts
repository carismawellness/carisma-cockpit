import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

export interface MonthlySpend {
  month: string;     // "Jan '26"
  metaTY: number;    // EUR
  metaLY: number;
  googleTY: number;
  googleLY: number;
}

export function useSpendComparison(brand: string, dateFrom: Date, dateTo: Date) {
  const from = format(dateFrom, "yyyy-MM-dd");
  const to   = format(dateTo,   "yyyy-MM-dd");

  return useQuery<MonthlySpend[]>({
    queryKey: ["spend-comparison", brand, from, to],
    queryFn: async () => {
      const res = await fetch(`/api/ads/spend-comparison?brand=${brand}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`spend-comparison: ${res.status}`);
      return res.json() as Promise<MonthlySpend[]>;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
