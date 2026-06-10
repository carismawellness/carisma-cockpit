"use client";

import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AesStaff {
  name:    string;
  revenue: number; // ex-VAT
  count:   number;
}

export interface AesService {
  service: string;
  revenue: number; // ex-VAT
  count:   number;
}

export interface AesPaymentType {
  type:    string;
  revenue: number; // ex-VAT
  count:   number;
}

export interface AesAnalyticsResult {
  total_revenue_ex_vat: number;
  transaction_count:    number;
  staff:                AesStaff[];
  services:             AesService[];
  paymentTypes:         AesPaymentType[];
  isFetching:           boolean;
  error:                string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ApiResponse {
  total_revenue_ex_vat: number;
  transaction_count:    number;
  staff_performance:    AesStaff[];
  service_breakdown:    AesService[];
  payment_types:        AesPaymentType[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAesAnalytics(dateFrom: Date, dateTo: Date): AesAnalyticsResult {
  const dateFromStr = toDateStr(dateFrom);
  const dateToStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<ApiResponse>({
    queryKey: ["aes-analytics", dateFromStr, dateToStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/cockpit/aes-analytics?date_from=${dateFromStr}&date_to=${dateToStr}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch aesthetics analytics");
      return json;
    },
    staleTime: 300_000,
  });

  return {
    total_revenue_ex_vat: data?.total_revenue_ex_vat ?? 0,
    transaction_count:    data?.transaction_count    ?? 0,
    staff:                data?.staff_performance    ?? [],
    services:             data?.service_breakdown    ?? [],
    paymentTypes:         data?.payment_types        ?? [],
    isFetching,
    error: error ? (error as Error).message : null,
  };
}
