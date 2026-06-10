"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Location display metadata (shared with useSpaEbitda) ──────────────────────
// IDs 11 and 12 are closed historic branches surfaced by the 2014-2023 backfill
// (Tools/spa-historical-backfill.ts) — they only appear when the date filter
// reaches back into the historic period.
export const SPA_LOCATION_META: Record<string, { name: string; color: string }> = {
  1:  { name: "Inter",                color: "#1B3A4B" },
  2:  { name: "Hugos",                color: "#96B2B2" },
  3:  { name: "Hyatt",                color: "#B79E61" },
  4:  { name: "Ramla",                color: "#8EB093" },
  5:  { name: "Riviera",              color: "#E07A5F" },
  6:  { name: "Odycy",                color: "#4A90D9" },
  7:  { name: "Excelsior",            color: "#7C3AED" },
  8:  { name: "Novotel",              color: "#DC2626" },
  11: { name: "Qawra (closed)",       color: "#9CA3AF" },
  12: { name: "Seashells (closed)",   color: "#6B7280" },
};

// Gross sales = services + products only. Wholesale/discount/refund live in
// spa_revenue_monthly and are reserved for EBITDA — every customer-facing
// sales surface shows the blunt gross figure straight from the Cockpit datasheet.

export interface SpaRevenueLocation {
  location_id:      number;
  name:             string;
  color:            string;
  services:         number;
  product_phytomer: number;
  product_purest:   number;
  product_other:    number;
  product_total:    number;
  gross_revenue:    number;
  lapis_synced_at:  string | null;
}

export interface SpaRevenueTotals {
  services:         number;
  product_phytomer: number;
  product_purest:   number;
  product_other:    number;
  product_total:    number;
  gross_revenue:    number;
}

export interface UseSpaRevenueResult {
  locations:     SpaRevenueLocation[];
  totals:        SpaRevenueTotals;
  isFetching:    boolean;
  isSyncing:     boolean;
  syncError:     string | null;
  missingMonths: string[];
  triggerSync:   (force?: boolean) => void;
}

function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (d <= end) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useSpaRevenue(dateFrom: Date, dateTo: Date): UseSpaRevenueResult {
  const supabase      = createClient();
  const queryClient   = useQueryClient();
  const lastFiredRef  = useRef("");

  const fromDateStr = toDateStr(dateFrom);
  const toDateStr_  = toDateStr(dateTo);
  const allMonths   = monthsInRange(dateFrom, dateTo);

  // ── 1. Fetch from Supabase (daily, exact date range) ──────────────────────
  const { data: rawRows, isFetching } = useQuery({
    queryKey: ["spa-revenue", fromDateStr, toDateStr_],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_revenue_daily")
        .select("location_id, date, services, product_phytomer, product_purest, product_other, lapis_synced_at")
        .gte("date", fromDateStr)
        .lte("date", toDateStr_)
        .order("date");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 2. Detect missing months (sync trigger still operates per-month) ──────
  // Live Cockpit Datasheet only knows 2025-01-01 onwards — months before that
  // are owned by the historic_sheet backfill (Tools/spa-historical-backfill.ts)
  // and are frozen. Never auto-fire the live ETL for them.
  const LIVE_ETL_FIRST_MONTH = "2025-01-01";
  const presentMonths = new Set(
    (rawRows ?? []).map((r: { date: string }) => r.date.slice(0, 7) + "-01"),
  );
  const missingMonths = allMonths.filter(
    (m) => !presentMonths.has(m) && m >= LIVE_ETL_FIRST_MONTH,
  );

  // ── 3. Sync mutation ──────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async ({
      force = false,
      syncFrom,
      syncTo,
    }: {
      force?: boolean;
      syncFrom?: Date;
      syncTo?: Date;
    }) => {
      const res = await fetch("/api/etl/cockpit-revenue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_from: toDateStr(syncFrom ?? dateFrom),
          date_to:   toDateStr(syncTo   ?? dateTo),
          force,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spa-revenue", fromDateStr, toDateStr_] });
    },
  });

  // ── 4. Auto-trigger sync ─────────────────────────────────────────────────
  const autoRefreshFiredRef = useRef(false);

  const today          = new Date();
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const curMonthEnd    = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const curMonthStr    = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const prevMonthStr   = toDateStr(prevMonthStart);
  const fromMonth      = fromDateStr.slice(0, 7) + "-01";
  const toMonth        = toDateStr_.slice(0, 7)  + "-01";
  // Suppress the current/prev-month auto-refresh when the user is viewing a
  // fully-historic range (pre-2025) — re-firing the live ETL would no-op
  // anyway and flash a spurious "Syncing…" banner.
  const rangeIsAllHistoric = toMonth < LIVE_ETL_FIRST_MONTH;
  const recentInRange  = !rangeIsAllHistoric && rawRows !== undefined && (
    (curMonthStr  >= fromMonth && curMonthStr  <= toMonth) ||
    (prevMonthStr >= fromMonth && prevMonthStr <= toMonth)
  );

  const missingKey = missingMonths.join(",");
  if (!isFetching && !syncMutation.isPending) {
    if (missingMonths.length > 0 && missingKey !== lastFiredRef.current) {
      lastFiredRef.current = missingKey;
      setTimeout(() => syncMutation.mutate({ force: false }), 0);
    } else if (recentInRange && !autoRefreshFiredRef.current) {
      autoRefreshFiredRef.current = true;
      setTimeout(() => syncMutation.mutate({
        force:    true,
        syncFrom: prevMonthStart,
        syncTo:   curMonthEnd,
      }), 0);
    }
  }

  // ── 5. Aggregate rows per location ────────────────────────────────────────
  type Row = {
    location_id:      number;
    date:             string;
    services:         number;
    product_phytomer: number;
    product_purest:   number;
    product_other:    number;
    lapis_synced_at:  string | null;
  };

  const locMap = new Map<number, SpaRevenueLocation>();

  for (const row of (rawRows ?? []) as Row[]) {
    const meta = SPA_LOCATION_META[row.location_id];
    if (!meta) continue;

    if (!locMap.has(row.location_id)) {
      locMap.set(row.location_id, {
        location_id:      row.location_id,
        name:             meta.name,
        color:            meta.color,
        services:         0,
        product_phytomer: 0,
        product_purest:   0,
        product_other:    0,
        product_total:    0,
        gross_revenue:    0,
        lapis_synced_at:  null,
      });
    }

    const agg = locMap.get(row.location_id)!;
    agg.services         += row.services         ?? 0;
    agg.product_phytomer += row.product_phytomer ?? 0;
    agg.product_purest   += row.product_purest   ?? 0;
    agg.product_other    += row.product_other    ?? 0;
    if (row.lapis_synced_at && (!agg.lapis_synced_at || row.lapis_synced_at > agg.lapis_synced_at)) {
      agg.lapis_synced_at = row.lapis_synced_at;
    }
  }

  // Round, compute product_total + gross_revenue, sort by gross desc
  const locations: SpaRevenueLocation[] = Array.from(locMap.values())
    .map((loc) => {
      const pt    = loc.product_phytomer + loc.product_purest + loc.product_other;
      const gross = loc.services + pt;
      return {
        ...loc,
        services:         Math.round(loc.services),
        product_phytomer: Math.round(loc.product_phytomer),
        product_purest:   Math.round(loc.product_purest),
        product_other:    Math.round(loc.product_other),
        product_total:    Math.round(pt),
        gross_revenue:    Math.round(gross),
      };
    })
    .sort((a, b) => b.gross_revenue - a.gross_revenue);

  // ── 6. Totals ─────────────────────────────────────────────────────────────
  const totals: SpaRevenueTotals = locations.reduce(
    (acc, loc) => ({
      services:         acc.services         + loc.services,
      product_phytomer: acc.product_phytomer + loc.product_phytomer,
      product_purest:   acc.product_purest   + loc.product_purest,
      product_other:    acc.product_other    + loc.product_other,
      product_total:    acc.product_total    + loc.product_total,
      gross_revenue:    acc.gross_revenue    + loc.gross_revenue,
    }),
    {
      services: 0, product_phytomer: 0, product_purest: 0, product_other: 0,
      product_total: 0, gross_revenue: 0,
    }
  );

  return {
    locations,
    totals,
    isFetching,
    isSyncing:   syncMutation.isPending,
    syncError:   syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync: (force = false) => syncMutation.mutate({ force }),
  };
}
