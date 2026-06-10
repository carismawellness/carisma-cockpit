// lib/hooks/useAestheticsRetention.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { NewReturningMonth, NewReturningPeriod } from "@/lib/analytics/retention";

export type ToxBucketKey = "onCycle" | "dueSoon" | "dueNow" | "lapsed" | "lost";

export interface ToxWorkItem {
  client:       string;
  lastToxDate:  string;
  daysOverdue:  number;          // negative = due in N days
  bucket:       ToxBucketKey;
  practitioner: string | null;
  ltv:          number;
  toxVisits:    number;
  totalVisits:  number;
}

export interface AestheticsRetentionData {
  asOf:         string;
  historyStart: string | null;
  lastDataDate: string | null;
  matchQuality: {
    totalTx:                  number;
    unmatchedTx:              number;
    matchedClients:           number;
    totalRevenue:             number;
    unmatchedRevenue:         number;
    unmatchedRevenueSharePct: number;
  };
  newReturning: {
    period:  NewReturningPeriod;
    monthly: NewReturningMonth[];
  };
  consults: {
    windowDays:             number;
    cohortSize:             number;
    matured:                number;
    converted:              number;
    pending:                number;
    conversionRatePct:      number | null;
    medianDaysToConvert:    number | null;
    avgRevenuePerConverted: number | null;
  };
  toxRecall: {
    cycleDays:       number;
    dueSoonDays:     number;
    totalToxClients: number;
    buckets:         Record<ToxBucketKey, { count: number; ltv: number }>;
    workList:        ToxWorkItem[];
    workListTotal:   number;
  };
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useAestheticsRetention(dateFrom: Date, dateTo: Date) {
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<AestheticsRetentionData>({
    queryKey: ["aesthetics-retention", fromStr, toStr],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: fromStr, to: toStr });
      const res = await fetch(`/api/sales/aesthetics-retention?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to fetch aesthetics retention (${res.status})`);
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
