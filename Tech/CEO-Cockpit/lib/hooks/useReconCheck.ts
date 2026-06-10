"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

/* ------------------------------------------------------------------ */
/*  Date helper                                                         */
/* ------------------------------------------------------------------ */

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Types — mirrors the exact shapes returned by the check routes      */
/* ------------------------------------------------------------------ */

export interface GapItem {
  code: string;
  name: string;
  amount: number;
  note?: string;
  category?: string;
}

export interface GapAnalysis {
  excluded_expenses:     GapItem[];
  not_linked_expenses:   GapItem[];
  not_in_db_expenses:    GapItem[];
  below_ebitda:          GapItem[];
  income_mapped_missing: GapItem[];
  totals: {
    excluded_total:     number;
    not_linked_total:   number;
    not_in_db_total:    number;
    below_ebitda_total: number;
  };
}

export interface SpaReconResult {
  period: { date_from: string; date_to: string };
  zoho: {
    revenue:      number;
    costs:        number;
    ebitda:       number;
    below_ebitda: { label: string; amount: number }[];
    below_total:  number;
  };
  salary_supplement: { total: number; by_slug: Record<string, number> };
  reconciliation: {
    zoho_ebitda:            number;
    salary_supplement:      number;
    expected_ebitda:        number;
    actual_ebitda_zoho_rev: number;
    cockpit_revenue:          number;
    zoho_revenue:           number;
    revenue_gap:            number;
    frontend_ebitda:        number;
    expected_with_cockpit:    number;
    difference:             number;
    status:                 "ok" | "mismatch";
  };
  gap_analysis: GapAnalysis;
}

export interface AesReconResult {
  period: { date_from: string; date_to: string };
  zoho: {
    total_income:    number;
    zoho_ebitda:     number;
    coa_income:      number;
    costs:           number;
    coa_ebitda:      number;
    below_ebitda:    { label: string; amount: number }[];
    below_total:     number;
  };
  sales_daily: { aesthetics: number; slimming: number; total: number };
  reconciliation: {
    zoho_coa_income:   number;
    zoho_costs:        number;
    zoho_coa_ebitda:   number;
    sales_daily_total: number;
    expected_ebitda:   number;
    frontend_ebitda:   number;
    difference:        number;
    status:            "ok" | "mismatch";
  };
  gap_analysis: GapAnalysis;
}

export type ReconStatus = "idle" | "loading" | "ok" | "warning" | "mismatch" | "error";

export interface UseReconCheckResult {
  status:            ReconStatus;
  isLoading:         boolean;
  isError:           boolean;
  spa:               SpaReconResult | undefined;
  aes:               AesReconResult | undefined;
  // aggregated for the badge label
  totalGapEur:       number;
  unmappedCount:     number;
  unmappedTotal:     number;
  belowEbitdaTotal:  number;
  refresh:           () => void;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useReconCheck(
  dateFrom: Date,
  dateTo:   Date,
  enabled:  boolean,
): UseReconCheckResult {
  const queryClient = useQueryClient();

  // Use month-start dates so the cache key is stable across re-renders
  const fromStr = toDateStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toStr   = toDateStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));

  const spaQuery = useQuery<SpaReconResult>({
    queryKey: ["recon-spa", fromStr, toStr],
    queryFn:  async () => {
      const res = await fetch("/api/ebitda/zoho-check", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ date_from: fromStr, date_to: toStr }),
      });
      if (!res.ok) throw new Error(`SPA recon failed (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 min — avoids hammering Zoho API
    retry: 1,
  });

  const aesQuery = useQuery<AesReconResult>({
    queryKey: ["recon-aes", fromStr, toStr],
    queryFn:  async () => {
      const res = await fetch("/api/ebitda/zoho-check-aesthetics", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ date_from: fromStr, date_to: toStr }),
      });
      if (!res.ok) throw new Error(`Aesthetics recon failed (${res.status})`);
      return res.json();
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const isLoading = spaQuery.isLoading || aesQuery.isLoading;
  const isError   = spaQuery.isError   || aesQuery.isError;
  const spa       = spaQuery.data;
  const aes       = aesQuery.data;

  /* ── Aggregated gap metrics ───────────────────────────────────── */
  const spaDiff      = spa?.reconciliation.difference  ?? 0;
  const aesDiff      = aes?.reconciliation.difference  ?? 0;
  const totalGapEur  = Math.abs(spaDiff) + Math.abs(aesDiff);

  const spaGap       = spa?.gap_analysis;
  const aesGap       = aes?.gap_analysis;
  const unmappedCount =
    (spaGap?.not_linked_expenses.length  ?? 0) +
    (spaGap?.not_in_db_expenses.length   ?? 0) +
    (aesGap?.not_linked_expenses.length  ?? 0) +
    (aesGap?.not_in_db_expenses.length   ?? 0);
  const unmappedTotal =
    (spaGap?.totals.not_linked_total  ?? 0) +
    (spaGap?.totals.not_in_db_total   ?? 0) +
    (aesGap?.totals.not_linked_total  ?? 0) +
    (aesGap?.totals.not_in_db_total   ?? 0);
  const belowEbitdaTotal =
    (spaGap?.totals.below_ebitda_total ?? 0) +
    (aesGap?.totals.below_ebitda_total ?? 0);

  /* ── Overall status ───────────────────────────────────────────── */
  let status: ReconStatus = "idle";
  if (enabled) {
    if (isError)                                              status = "error";
    else if (isLoading)                                       status = "loading";
    else if (spa && aes) {
      const spaMismatch = spa.reconciliation.status === "mismatch";
      const aesMismatch = aes.reconciliation.status === "mismatch";
      if (spaMismatch || aesMismatch)                         status = "mismatch";
      else if (unmappedTotal > 0)                             status = "warning";
      else                                                    status = "ok";
    }
  }

  return {
    status,
    isLoading,
    isError,
    spa,
    aes,
    totalGapEur,
    unmappedCount,
    unmappedTotal,
    belowEbitdaTotal,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ["recon-spa",  fromStr, toStr] });
      queryClient.invalidateQueries({ queryKey: ["recon-aes",  fromStr, toStr] });
    },
  };
}
