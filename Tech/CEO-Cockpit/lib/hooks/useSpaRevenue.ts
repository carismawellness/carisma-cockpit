"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Location display metadata (shared with useSpaEbitda) ──────────────────────
export const SPA_LOCATION_META: Record<string, { name: string; color: string }> = {
  1: { name: "InterContinental", color: "#1B3A4B" },
  2: { name: "Hugos",            color: "#96B2B2" },
  3: { name: "Hyatt",            color: "#B79E61" },
  4: { name: "Ramla",            color: "#8EB093" },
  5: { name: "Labranda",         color: "#E07A5F" },
  6: { name: "Sunny Coast",      color: "#4A90D9" },
  7: { name: "Excelsior",        color: "#7C3AED" },
  8: { name: "Novotel",          color: "#DC2626" },
};

export interface SpaRevenueLocation {
  location_id:      number;
  name:             string;
  color:            string;
  // Lapis
  services:         number;
  product_phytomer: number;
  product_purest:   number;
  product_other:    number;
  product_total:    number;
  // Zoho
  wholesale:        number;
  sales_discount:   number;
  sales_refund:     number;
  // Derived
  net_revenue:      number;
  lapis_synced_at:  string | null;
  zoho_synced_at:   string | null;
}

export interface SpaRevenueTotals {
  services:         number;
  product_phytomer: number;
  product_purest:   number;
  product_other:    number;
  product_total:    number;
  wholesale:        number;
  sales_discount:   number;
  sales_refund:     number;
  net_revenue:      number;
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

  const fromStr   = toDateStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toStr     = toDateStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const allMonths = monthsInRange(dateFrom, dateTo);

  // ── 1. Fetch from Supabase ────────────────────────────────────────────────
  const { data: rawRows, isFetching } = useQuery({
    queryKey: ["spa-revenue", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_revenue_monthly")
        .select("*")
        .gte("month", fromStr)
        .lte("month", toStr)
        .order("month");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 2. Detect missing months ──────────────────────────────────────────────
  const presentMonths  = new Set((rawRows ?? []).map((r: { month: string }) => r.month));
  const missingMonths  = allMonths.filter((m) => !presentMonths.has(m));

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
      const res = await fetch("/api/etl/lapis-revenue", {
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
      queryClient.invalidateQueries({ queryKey: ["spa-revenue", fromStr, toStr] });
    },
  });

  // ── 4. Auto-trigger sync ─────────────────────────────────────────────────
  const autoRefreshFiredRef = useRef(false);

  // Current + previous month boundaries (staff enter service dates retroactively)
  const today          = new Date();
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const curMonthEnd    = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const curMonthStr    = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const prevMonthStr   = toDateStr(prevMonthStart);
  // Only auto-refresh if the current or previous month is within the queried range
  const recentInRange  = rawRows !== undefined && (
    (curMonthStr  >= fromStr && curMonthStr  <= toStr) ||
    (prevMonthStr >= fromStr && prevMonthStr <= toStr)
  );

  const missingKey = missingMonths.join(",");
  if (!isFetching && !syncMutation.isPending) {
    if (missingMonths.length > 0 && missingKey !== lastFiredRef.current) {
      // Priority 1: fetch missing months (first-time, no force)
      lastFiredRef.current = missingKey;
      setTimeout(() => syncMutation.mutate({ force: false }), 0);
    } else if (recentInRange && !autoRefreshFiredRef.current) {
      // Priority 2: once per mount, force-refresh current + previous month
      // so data entered retroactively in Lapis is always picked up
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
    services:         number;
    product_phytomer: number;
    product_purest:   number;
    product_other:    number;
    wholesale:        number;
    sales_discount:   number;
    sales_refund:     number;
    lapis_synced_at:  string | null;
    zoho_synced_at:   string | null;
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
        wholesale:        0,
        sales_discount:   0,
        sales_refund:     0,
        net_revenue:      0,
        lapis_synced_at:  null,
        zoho_synced_at:   null,
      });
    }

    const agg = locMap.get(row.location_id)!;
    agg.services         += row.services         ?? 0;
    agg.product_phytomer += row.product_phytomer ?? 0;
    agg.product_purest   += row.product_purest   ?? 0;
    agg.product_other    += row.product_other    ?? 0;
    agg.wholesale        += row.wholesale        ?? 0;
    agg.sales_discount   += row.sales_discount   ?? 0;
    agg.sales_refund     += row.sales_refund     ?? 0;
    if (row.lapis_synced_at && (!agg.lapis_synced_at || row.lapis_synced_at > agg.lapis_synced_at)) {
      agg.lapis_synced_at = row.lapis_synced_at;
    }
    if (row.zoho_synced_at && (!agg.zoho_synced_at || row.zoho_synced_at > agg.zoho_synced_at)) {
      agg.zoho_synced_at = row.zoho_synced_at;
    }
  }

  // Round, compute product_total and net_revenue, sort by services desc
  const locations: SpaRevenueLocation[] = Array.from(locMap.values())
    .map((loc) => {
      const pt = loc.product_phytomer + loc.product_purest + loc.product_other;
      const net = loc.services + pt + loc.wholesale - loc.sales_discount - loc.sales_refund;
      return {
        ...loc,
        services:         Math.round(loc.services),
        product_phytomer: Math.round(loc.product_phytomer),
        product_purest:   Math.round(loc.product_purest),
        product_other:    Math.round(loc.product_other),
        product_total:    Math.round(pt),
        wholesale:        Math.round(loc.wholesale),
        sales_discount:   Math.round(loc.sales_discount),
        sales_refund:     Math.round(loc.sales_refund),
        net_revenue:      Math.round(net),
      };
    })
    .sort((a, b) => b.net_revenue - a.net_revenue);

  // ── 6. Totals ─────────────────────────────────────────────────────────────
  const totals: SpaRevenueTotals = locations.reduce(
    (acc, loc) => ({
      services:         acc.services         + loc.services,
      product_phytomer: acc.product_phytomer + loc.product_phytomer,
      product_purest:   acc.product_purest   + loc.product_purest,
      product_other:    acc.product_other    + loc.product_other,
      product_total:    acc.product_total    + loc.product_total,
      wholesale:        acc.wholesale        + loc.wholesale,
      sales_discount:   acc.sales_discount   + loc.sales_discount,
      sales_refund:     acc.sales_refund     + loc.sales_refund,
      net_revenue:      acc.net_revenue      + loc.net_revenue,
    }),
    {
      services: 0, product_phytomer: 0, product_purest: 0, product_other: 0,
      product_total: 0, wholesale: 0, sales_discount: 0, sales_refund: 0, net_revenue: 0,
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
