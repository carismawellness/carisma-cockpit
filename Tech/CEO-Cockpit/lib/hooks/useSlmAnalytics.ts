"use client";

import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlmStaff {
  name:      string;
  revenue:   number;
  txn_count: number;
}

export interface SlmProgram {
  program:   string;
  revenue:   number;
  txn_count: number;
}

export interface SlmAnalyticsResult {
  total_revenue:     number;
  package_revenue:   number;
  treatment_revenue: number;
  staff:             SlmStaff[];
  programs:          SlmProgram[];
  isFetching:        boolean;
  error:             string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ApiResponse {
  total_revenue:     number;
  package_revenue:   number;
  treatment_revenue: number;
  staff:             SlmStaff[];
  programs:          SlmProgram[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSlmAnalytics(dateFrom: Date, dateTo: Date): SlmAnalyticsResult {
  const dateFromStr = toDateStr(dateFrom);
  const dateToStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<ApiResponse>({
    queryKey: ["slm-analytics", dateFromStr, dateToStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/cockpit/slm-analytics?date_from=${dateFromStr}&date_to=${dateToStr}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch slimming analytics");
      return json;
    },
    staleTime: 300_000,
  });

  return {
    total_revenue:     data?.total_revenue     ?? 0,
    package_revenue:   data?.package_revenue   ?? 0,
    treatment_revenue: data?.treatment_revenue ?? 0,
    staff:             data?.staff             ?? [],
    programs:          data?.programs          ?? [],
    isFetching,
    error: error ? (error as Error).message : null,
  };
}
