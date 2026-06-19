"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format, startOfWeek, addWeeks, differenceInWeeks } from "date-fns";

export interface CeoWeeklyPoint {
  weekLabel: string;
  weekStart: string;
  spa: number;
  aes: number;
  slim: number;
  total: number;
}

export interface UseCeoRevenueResult {
  spaRev: number;
  aesRev: number;
  slimRev: number;
  totalRev: number;
  weeklyData: CeoWeeklyPoint[];
  isLoading: boolean;
}

export function useCeoRevenue(dateFrom: Date, dateTo: Date): UseCeoRevenueResult {
  const supabase = createClient();
  const fromStr = format(dateFrom, "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  const { data: spaRows = [], isLoading: spaLoading } = useQuery({
    queryKey: ["ceo-spa-rev", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("spa_revenue_daily")
        .select("date, services, product_phytomer, product_purest, product_other")
        .gte("date", fromStr)
        .lte("date", toStr);
      return (data ?? []) as Array<{
        date: string;
        services: number;
        product_phytomer: number;
        product_purest: number;
        product_other: number;
      }>;
    },
    staleTime: 60_000,
  });

  const { data: aesRows = [], isLoading: aesLoading } = useQuery({
    queryKey: ["ceo-aes-rev", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("aesthetics_sales_daily")
        .select("date_of_service, price_inc_vat")
        .not("date_of_service", "is", null)
        .gte("date_of_service", fromStr)
        .lte("date_of_service", toStr);
      return (data ?? []) as Array<{ date_of_service: string; price_inc_vat: number }>;
    },
    staleTime: 60_000,
  });

  const { data: slimRows = [], isLoading: slimLoading } = useQuery({
    queryKey: ["ceo-slim-rev", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("slimming_sales_daily")
        .select("date_of_service, full_price")
        .not("date_of_service", "is", null)
        .gte("date_of_service", fromStr)
        .lte("date_of_service", toStr);
      return (data ?? []) as Array<{ date_of_service: string; full_price: number }>;
    },
    staleTime: 60_000,
  });

  const spaRev = Math.round(
    spaRows.reduce((s, r) =>
      s + (r.services ?? 0) + (r.product_phytomer ?? 0) + (r.product_purest ?? 0) + (r.product_other ?? 0), 0
    )
  );
  const aesRev = Math.round(aesRows.reduce((s, r) => s + (r.price_inc_vat ?? 0), 0));
  const slimRev = Math.round(slimRows.reduce((s, r) => s + (r.full_price ?? 0), 0));
  const totalRev = spaRev + aesRev + slimRev;

  // Weekly bucketing — ISO weeks starting Monday
  const weekStart = startOfWeek(dateFrom, { weekStartsOn: 1 });
  const numWeeks = Math.max(1, differenceInWeeks(dateTo, weekStart) + 1);

  const weeklyData: CeoWeeklyPoint[] = Array.from({ length: numWeeks }, (_, i) => {
    const wStart = format(addWeeks(weekStart, i), "yyyy-MM-dd");
    const wEnd = format(addWeeks(weekStart, i + 1), "yyyy-MM-dd");
    const wLabel = format(addWeeks(weekStart, i), "dd-MMM");

    const spa = Math.round(
      spaRows
        .filter(r => r.date >= wStart && r.date < wEnd)
        .reduce((s, r) => s + (r.services ?? 0) + (r.product_phytomer ?? 0) + (r.product_purest ?? 0) + (r.product_other ?? 0), 0)
    );
    const aes = Math.round(
      aesRows
        .filter(r => r.date_of_service >= wStart && r.date_of_service < wEnd)
        .reduce((s, r) => s + (r.price_inc_vat ?? 0), 0)
    );
    const slim = Math.round(
      slimRows
        .filter(r => r.date_of_service >= wStart && r.date_of_service < wEnd)
        .reduce((s, r) => s + (r.full_price ?? 0), 0)
    );

    return { weekLabel: wLabel, weekStart: wStart, spa, aes, slim, total: spa + aes + slim };
  });

  return {
    spaRev,
    aesRev,
    slimRev,
    totalRev,
    weeklyData,
    isLoading: spaLoading || aesLoading || slimLoading,
  };
}
