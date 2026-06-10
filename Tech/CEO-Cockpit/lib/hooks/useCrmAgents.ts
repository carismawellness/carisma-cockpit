"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CrmAgentTotals {
  total_sales: number;
  avg_conversion_rate: number;
  avg_booking_eff: number;
  avg_booking_rate: number;
  avg_deposit_pct: number;
  avg_aov: number;
  total_bookings: number;
  total_deposits: number;
  total_messages: number;
  active_days: number;
}

export interface CrmAgentRow {
  date: string;
  booking_eff_pct: number;
  booking_rate_pct: number;
  lc_sales: number;
  lc_messages: number;
  lc_booked: number;
  lc_deposit: number;
  crm_sales: number;
  crm_messages: number;
  crm_booked: number;
  crm_deposit: number;
  other_sales: number;
  other_messages: number;
  other_booked: number;
  other_deposit: number;
  total_messages: number;
  total_booked: number;
  total_deposit_count: number;
  conversion_rate_pct: number;
  total_sales: number;
  deposit_pct: number;
  aov: number;
}

export interface CrmAgent {
  slug: string;
  name: string;
  rows: CrmAgentRow[];
  totals: CrmAgentTotals;
}

export interface UseCrmAgentsResult {
  agents: CrmAgent[];
  isLoading: boolean;
  isError: boolean;
  error: string | null;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useCrmAgents(dateFrom: Date, dateTo: Date): UseCrmAgentsResult {
  const fromStr = format(dateFrom, "yyyy-MM-dd");
  const toStr   = format(dateTo,   "yyyy-MM-dd");

  const { data, isLoading, isError, error } = useQuery<CrmAgent[]>({
    queryKey: ["crm-agents", fromStr, toStr],
    queryFn:  async () => {
      const res = await fetch(
        `/api/crm/individual?from=${fromStr}&to=${toStr}`
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      // API returns { agents: CrmAgent[] } — extract the array
      const json = (await res.json()) as { agents: CrmAgent[] };
      return json.agents;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    agents:    data ?? [],
    isLoading,
    isError,
    error:     error ? (error as Error).message : null,
  };
}
