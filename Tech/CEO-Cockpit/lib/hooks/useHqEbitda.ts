"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface HqEbitdaData {
  revenue: number;
  cogs: number;
  wages: number;
  advertising: number;
  rent: number;
  utilities: number;
  sga: number;
  ebitda: number;
  lastSyncedAt: string | null;
}

export interface UseHqEbitdaResult {
  data: HqEbitdaData;
  isFetching: boolean;
  isSyncing: boolean;
  syncError: string | null;
  missingMonths: string[];
  triggerSync: (force?: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY: HqEbitdaData = {
  revenue: 0, cogs: 0, wages: 0, advertising: 0,
  rent: 0, utilities: 0, sga: 0, ebitda: 0, lastSyncedAt: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useHqEbitda(dateFrom: Date, dateTo: Date): UseHqEbitdaResult {
  const supabase = createClient();

  const fromDateFull = toDateStr(dateFrom);
  const toDateFull   = toDateStr(dateTo);

  // ── Fetch raw daily rows for the period from hq_ebitda_daily ──────────────
  // Sums across all `source` values (e.g. 'spa', 'aesthetics') so the HQ figure
  // captures both orgs' HQ-tagged amounts.
  const { data: rows, isFetching } = useQuery({
    queryKey: ["hq-ebitda", fromDateFull, toDateFull],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hq_ebitda_daily")
        .select("date, source, revenue, cogs, wages, advertising, rent, utilities, sga, zoho_synced_at")
        .gte("date", fromDateFull)
        .lte("date", toDateFull);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  type HqDailyRow = {
    date: string; source: string;
    revenue: number; cogs: number; wages: number;
    advertising: number; rent: number; utilities: number; sga: number;
    zoho_synced_at: string | null;
  };

  // ── Aggregate ─────────────────────────────────────────────────────────────
  // Sync is owned by useSpaEbitda for SPA-source rows; aesthetics-source rows
  // are owned by useAestheticsEbitda. This hook only reads.
  const data = (rows ?? []).reduce<HqEbitdaData>((acc, row: HqDailyRow) => {
    acc.revenue     += row.revenue     ?? 0;
    acc.cogs        += row.cogs        ?? 0;
    acc.wages       += row.wages       ?? 0;
    acc.advertising += row.advertising ?? 0;
    acc.rent        += row.rent        ?? 0;
    acc.utilities   += row.utilities   ?? 0;
    acc.sga         += row.sga         ?? 0;
    if (row.zoho_synced_at && (!acc.lastSyncedAt || row.zoho_synced_at > acc.lastSyncedAt)) {
      acc.lastSyncedAt = row.zoho_synced_at;
    }
    return acc;
  }, { ...EMPTY });

  const costs  = data.cogs + data.wages + data.advertising + data.rent + data.utilities + data.sga;
  data.ebitda  = Math.round(data.revenue - costs);
  data.revenue = Math.round(data.revenue);
  data.cogs    = Math.round(data.cogs);
  data.wages   = Math.round(data.wages);
  data.advertising = Math.round(data.advertising);
  data.rent    = Math.round(data.rent);
  data.utilities = Math.round(data.utilities);
  data.sga     = Math.round(data.sga);

  return {
    data: rows?.length ? data : EMPTY,
    isFetching,
    isSyncing:    false,
    syncError:    null,
    missingMonths: [],
    triggerSync:  () => { /* no-op: handled by useSpaEbitda + useAestheticsEbitda */ },
  };
}
