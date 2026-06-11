// lib/hooks/useGroupRevenue.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { GroupForecast } from "@/lib/analytics/revenue-forecast";

export interface GroupLocationRow {
  location_id: number;
  name:        string;
  color:       string;
  revenue:     number;
}

export interface GroupPeriod {
  spa:           number;
  /** Spa services (excluding retail) — optional; backfilled with 0 when absent. */
  spa_services?: number;
  /** Spa retail (product_*) — optional; backfilled with 0 when absent. */
  spa_retail?:   number;
  aesthetics:    number;
  slimming:      number;
  total:         number;
}

export interface GroupMonthlyPoint {
  month:            string;
  ly_month:         string;
  spa:              number;
  aesthetics:       number;
  slimming:         number;
  total:            number;
  spa_ly:           number;
  aesthetics_ly:    number;
  slimming_ly:      number;
  total_ly:         number;
  /** Per-hotel breakdown of the Spa total. Keys are hotel display names. */
  spa_by_location?: Record<string, number>;
}

export interface UseGroupRevenueResult {
  period:        GroupPeriod;
  ly:            GroupPeriod;
  spa_locations: GroupLocationRow[];
  monthly:       GroupMonthlyPoint[];
  /** Forward-looking projection (current month → Dec). null = not computable. */
  forecast:      GroupForecast | null;
  isFetching:    boolean;
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY_PERIOD: GroupPeriod = { spa: 0, aesthetics: 0, slimming: 0, total: 0 };

export function useGroupRevenue(dateFrom: Date, dateTo: Date): UseGroupRevenueResult {
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data, isFetching } = useQuery({
    queryKey: ["group-revenue", fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/group?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to fetch group revenue (${res.status})`);
      }
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  return {
    period:        data?.period        ?? EMPTY_PERIOD,
    ly:            data?.ly            ?? EMPTY_PERIOD,
    spa_locations: data?.spa_locations ?? [],
    monthly:       data?.monthly       ?? [],
    forecast:      data?.forecast      ?? null,
    isFetching,
  };
}
