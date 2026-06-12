"use client";
// Returns last 6 full calendar months of monthly commission + revenue aggregates
// for a single employee. Calls /api/sales/employee-stats once per month in parallel.

import { useQuery } from "@tanstack/react-query";
import type { BrandSlug } from "@/lib/sales-employees/types";
import type { EmployeeStatsResponse } from "@/lib/sales-employees/types";

export interface MonthlyEmployeeStat {
  month: string;       // "2026-01", "2026-02", etc.
  monthLabel: string;  // "Jan 2026"
  service_revenue: number;
  retail_revenue: number;
  total_revenue: number;
  service_commission: number;
  retail_commission: number;
  total_commission: number;
  active_days: number;
}

export interface UseSalesEmployeeMonthlyResult {
  months: MonthlyEmployeeStat[];
  isLoading: boolean;
  isError: boolean;
}

/** Returns the last day of a given year+month (1-indexed). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Build an array of { year, month (1-12) } for the 6 full months preceding today. */
function getLast6FullMonths(): Array<{ year: number; month: number }> {
  const now = new Date();
  const results: Array<{ year: number; month: number }> = [];
  for (let i = 6; i >= 1; i--) {
    // Subtract i months from "current month" to get full past months
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    results.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return results;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function fetchMonthStats(
  brand: BrandSlug,
  slug: string,
  year: number,
  month: number,
): Promise<MonthlyEmployeeStat> {
  const from = `${year}-${pad2(month)}-01`;
  const last = lastDayOfMonth(year, month);
  const to = `${year}-${pad2(month)}-${pad2(last)}`;

  const url = `/api/sales/employee-stats?brand=${brand}&slug=${encodeURIComponent(slug)}&from=${from}&to=${to}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Non-fatal: return zero row so the chart still renders the other months
    const monthKey = `${year}-${pad2(month)}`;
    const monthLabel = new Intl.DateTimeFormat("en-MT", {
      month: "short",
      year: "numeric",
    }).format(new Date(year, month - 1, 1));
    return {
      month: monthKey,
      monthLabel,
      service_revenue: 0,
      retail_revenue: 0,
      total_revenue: 0,
      service_commission: 0,
      retail_commission: 0,
      total_commission: 0,
      active_days: 0,
    };
  }

  const data: EmployeeStatsResponse = await res.json();

  const serviceRate = data.rates?.service_rate ?? 0;
  const retailRate = data.rates?.retail_rate ?? 0;

  const service_revenue = data.totals.service_revenue;
  const retail_revenue = data.totals.retail_revenue;
  const total_revenue = data.totals.total_revenue;

  // Use pre-computed commission totals from the API when rates were set;
  // fall back to manual calculation using the period-end rate snapshot.
  const service_commission =
    data.totals.commission_service > 0
      ? data.totals.commission_service
      : service_revenue * serviceRate;
  const retail_commission =
    data.totals.commission_retail > 0
      ? data.totals.commission_retail
      : retail_revenue * retailRate;
  const total_commission = service_commission + retail_commission;

  const monthKey = `${year}-${pad2(month)}`;
  const monthLabel = new Intl.DateTimeFormat("en-MT", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));

  return {
    month: monthKey,
    monthLabel,
    service_revenue,
    retail_revenue,
    total_revenue,
    service_commission: +service_commission.toFixed(2),
    retail_commission: +retail_commission.toFixed(2),
    total_commission: +total_commission.toFixed(2),
    active_days: data.totals.active_days,
  };
}

export function useSalesEmployeeMonthly(
  brand: BrandSlug,
  slug: string,
): UseSalesEmployeeMonthlyResult {
  const { data, isLoading, isError } = useQuery<MonthlyEmployeeStat[]>({
    queryKey: ["sales-employee-monthly", brand, slug],
    enabled: Boolean(slug),
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const periods = getLast6FullMonths();
      const results = await Promise.all(
        periods.map(({ year, month }) =>
          fetchMonthStats(brand, slug, year, month),
        ),
      );
      // Already oldest→newest from getLast6FullMonths, but sort by key to be safe
      return results.sort((a, b) => a.month.localeCompare(b.month));
    },
  });

  return {
    months: data ?? [],
    isLoading,
    isError,
  };
}
