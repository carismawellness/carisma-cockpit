// lib/hooks/useSlimmingRetention.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { NewReturningMonth, NewReturningPeriod } from "@/lib/analytics/retention";

export interface SlimmingAtRiskItem {
  client:          string;
  lastSessionDate: string;
  daysSince:       number;
  lastTreatment:   string | null;
  lastTherapist:   string | null;
  totalSessions:   number;
  totalRevenue:    number;
}

export interface SlimmingRetentionData {
  asOf: string;
  treatments: {
    totalSessions:        number;
    namedSessions:        number;
    nameCoveragePct:      number;
    lastSessionDate:      string | null;
    lastNamedSessionDate: string | null;
  };
  census: {
    activeDays:    number;
    atRiskDays:    number;
    active:        number;
    atRisk:        number;
    inactive:      number;
    totalPatients: number;
    trend:         { month: string; monthEnd: string; active: number }[];
  };
  atRiskList:      SlimmingAtRiskItem[];
  atRiskListTotal: number;
  salesMatchQuality: {
    historyStart:             string | null;
    totalRevenue:             number;
    unmatchedRevenue:         number;
    unmatchedRevenueSharePct: number;
  };
  newReturning: {
    period:  NewReturningPeriod;
    monthly: NewReturningMonth[];
  };
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useSlimmingRetention(dateFrom: Date, dateTo: Date) {
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<SlimmingRetentionData>({
    queryKey: ["slimming-retention", fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/slimming-retention?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to fetch slimming retention (${res.status})`);
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    data:       data ?? null,
    isFetching,
    error:      error ? (error as Error).message : null,
  };
}
