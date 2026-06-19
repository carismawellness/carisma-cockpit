"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format } from "date-fns";
import { useLookups } from "./useLookups";

interface UseKPIDataOptions {
  table: string;
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
  dateColumn?: string;
  brandColumn?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useKPIData<T = Record<string, any>>({
  table,
  dateFrom,
  dateTo,
  brandFilter,
  dateColumn = "date",
  brandColumn = "brand_id",
}: UseKPIDataOptions) {
  const { brandMap } = useLookups();

  const queryResult = useQuery({
    queryKey: [
      table,
      format(dateFrom, "yyyy-MM-dd"),
      format(dateTo, "yyyy-MM-dd"),
      brandFilter,
      dateColumn,
      brandColumn,
    ],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from(table)
        .select("*")
        .gte(dateColumn, format(dateFrom, "yyyy-MM-dd"))
        .lte(dateColumn, format(dateTo, "yyyy-MM-dd"))
        .order(dateColumn, { ascending: true });

      if (brandFilter && brandMap[brandFilter]) {
        query = query.eq(brandColumn, brandMap[brandFilter]);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data as T[]) || [];
    },
  });

  // Compute lastUpdated from data
  const lastUpdated = queryResult.data?.length
    ? (() => {
        const dates = queryResult.data
          .map((row: any) => row[dateColumn] as string)
          .filter(Boolean)
          .sort()
          .reverse();
        return dates.length > 0 ? new Date(dates[0]) : null;
      })()
    : null;

  return {
    data: queryResult.data || [],
    loading: queryResult.isLoading,
    error: queryResult.error?.message || null,
    lastUpdated,
  };
}
