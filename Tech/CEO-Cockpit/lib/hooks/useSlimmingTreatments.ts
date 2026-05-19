"use client";

import { useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SlimmingTreatmentRow {
  id:              number;
  sheet_tab:       string;
  month:           string;
  date_of_service: string | null;
  client:          string | null;
  treatment:       string | null;
  price_inc_vat:   number | null;
  vat_rate:        number | null;
  price_ex_vat:    number | null;
  therapist:       string | null;
  synced_at:       string;
}

export interface TreatmentStaffBreakdown {
  staff:       string;
  tx_count:    number;
  revenue_ex:  number;
  revenue_inc: number;
}

export interface SlimmingTreatmentsTotals {
  revenue_ex:  number;
  revenue_inc: number;
  vat_amount:  number;
  tx_count:    number;
  last_synced: string | null;
}

export interface UseSlimmingTreatmentsResult {
  rows:          SlimmingTreatmentRow[];
  byStaff:       TreatmentStaffBreakdown[];
  totals:        SlimmingTreatmentsTotals;
  isFetching:    boolean;
  isSyncing:     boolean;
  syncError:     string | null;
  missingMonths: string[];
  triggerSync:   () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (d <= end) {
    months.push(toMonthStr(d));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useSlimmingTreatments(dateFrom: Date, dateTo: Date): UseSlimmingTreatmentsResult {
  const supabase     = createClient();
  const queryClient  = useQueryClient();
  const lastFiredRef = useRef("");

  const fromMonth   = toMonthStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toMonth     = toMonthStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const fromDateStr = toDateStr(dateFrom);
  const toDateStr_  = toDateStr(dateTo);

  // 1. Fetch rows
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["slimming-treatments", fromDateStr, toDateStr_],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("slimming_treatments_daily")
        .select("*")
        .gte("month", fromMonth)
        .lte("month", toMonth)
        .order("date_of_service", { ascending: true });
      if (error) throw error;
      const all = (data ?? []) as SlimmingTreatmentRow[];
      return all.filter(r =>
        !r.date_of_service ||
        (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr_)
      );
    },
    staleTime: 0,
  });

  // 2. Sync mutation
  const syncMutation = useMutation({
    mutationFn: async ({ syncFrom, syncTo }: { syncFrom?: Date; syncTo?: Date } = {}) => {
      const res = await fetch("/api/etl/slimming-treatments", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          date_from: toDateStr(syncFrom ?? dateFrom),
          date_to:   toDateStr(syncTo   ?? dateTo),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slimming-treatments", fromDateStr, toDateStr_] }),
  });

  // 3. Auto-sync: fill missing months + refresh current/previous month
  const allMonths     = monthsInRange(dateFrom, dateTo);
  const presentMonths = new Set(rows.map((r: SlimmingTreatmentRow) => r.month));
  const missingMonths = allMonths.filter(m => !presentMonths.has(m));

  const autoRefreshFiredRef = useRef(false);
  const today        = new Date();
  const curMonthStr  = toMonthStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const prevMonthStr = toMonthStr(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const recentInRange = !isFetching && (
    (curMonthStr  >= fromMonth && curMonthStr  <= toMonth) ||
    (prevMonthStr >= fromMonth && prevMonthStr <= toMonth)
  );

  const missingKey = missingMonths.join(",");
  if (!isFetching && !syncMutation.isPending) {
    if (missingMonths.length > 0 && missingKey !== lastFiredRef.current) {
      lastFiredRef.current = missingKey;
      setTimeout(() => syncMutation.mutate({}), 0);
    } else if (recentInRange && !autoRefreshFiredRef.current) {
      autoRefreshFiredRef.current = true;
      setTimeout(() => syncMutation.mutate({}), 0);
    }
  }

  // 4. By Staff (Therapist)
  const byStaff = useMemo<TreatmentStaffBreakdown[]>(() => {
    const map = new Map<string, TreatmentStaffBreakdown>();
    for (const r of rows) {
      const raw   = r.therapist?.trim() || "(Unassigned)";
      const key   = raw.toLowerCase();
      const label = raw === "(Unassigned)" ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const ex    = r.price_ex_vat  ?? 0;
      const inc   = r.price_inc_vat ?? 0;
      if (!map.has(key)) map.set(key, { staff: label, tx_count: 0, revenue_ex: 0, revenue_inc: 0 });
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex  += ex;
      agg.revenue_inc += inc;
    }
    return Array.from(map.values())
      .map(s => ({ ...s, revenue_ex: Math.round(s.revenue_ex), revenue_inc: Math.round(s.revenue_inc) }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  // 5. Totals
  const totals = useMemo<SlimmingTreatmentsTotals>(() => {
    const ex  = rows.reduce((s, r) => s + (r.price_ex_vat  ?? 0), 0);
    const inc = rows.reduce((s, r) => s + (r.price_inc_vat ?? 0), 0);
    const last = rows.reduce((best, r) => {
      if (!r.synced_at) return best;
      return (!best || r.synced_at > best) ? r.synced_at : best;
    }, null as string | null);
    return {
      revenue_ex:  Math.round(ex),
      revenue_inc: Math.round(inc),
      vat_amount:  Math.round(inc - ex),
      tx_count:    rows.length,
      last_synced: last,
    };
  }, [rows]);

  return {
    rows,
    byStaff,
    totals,
    isFetching,
    isSyncing:     syncMutation.isPending,
    syncError:     syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync:   () => syncMutation.mutate({}),
  };
}
