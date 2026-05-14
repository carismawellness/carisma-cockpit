"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Location display metadata ─────────────────────────────────────────────
export const SPA_LOCATION_META: Record<string, { name: string; color: string }> = {
  inter:     { name: "InterContinental", color: "#1B3A4B" },
  hugos:     { name: "Hugo's",           color: "#96B2B2" },
  hyatt:     { name: "Hyatt",            color: "#B79E61" },
  ramla:     { name: "Ramla",            color: "#8EB093" },
  labranda:  { name: "Labranda",         color: "#E07A5F" },
  odycy:     { name: "Sunny Coast",      color: "#4A90D9" }, // DB slug is odycy, displayed as Sunny Coast
  excelsior: { name: "Excelsior",        color: "#7C3AED" },
  novotel:   { name: "Novotel",          color: "#DC2626" },
};

export interface SpaLocationData {
  id: number;
  slug: string;
  name: string;
  color: string;
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

export interface UseSpaEbitdaResult {
  locations: SpaLocationData[];
  isFetching: boolean;
  isSyncing: boolean;
  syncError: string | null;
  missingMonths: string[];
  triggerSync: (force?: boolean) => void;
}

// Generate every YYYY-MM-01 string in [dateFrom, dateTo]
function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}-01`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

// Use local date parts to avoid UTC offset shifting the date (Malta is UTC+1)
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useSpaEbitda(dateFrom: Date, dateTo: Date): UseSpaEbitdaResult {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const lastFiredRef = useRef("");

  const fromStr = toDateStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toStr   = toDateStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const allMonths = monthsInRange(dateFrom, dateTo);

  // ── 1a. Fetch cost rows from spa_ebitda_monthly ──────────────────────
  const { data: rawRows, isFetching: isFetchingCosts } = useQuery({
    queryKey: ["spa-ebitda", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_ebitda_monthly")
        .select("*, locations(id, slug, name)")
        .gte("month", fromStr)
        .lte("month", toStr)
        .order("month");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 1b. Fetch Lapis net revenue from spa_revenue_monthly ─────────────
  // Net revenue = services + products + wholesale - discount - refund
  const { data: revenueRows, isFetching: isFetchingRevenue } = useQuery({
    queryKey: ["spa-revenue-for-ebitda", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_revenue_monthly")
        .select("location_id, month, services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund")
        .gte("month", fromStr)
        .lte("month", toStr);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // Aggregate Lapis net revenue per location_id across all months in range
  const lapisRevByLoc = new Map<number, number>();
  for (const r of (revenueRows ?? []) as {
    location_id: number; services: number; product_phytomer: number;
    product_purest: number; product_other: number; wholesale: number;
    sales_discount: number; sales_refund: number;
  }[]) {
    const net = (r.services ?? 0) + (r.product_phytomer ?? 0) + (r.product_purest ?? 0)
              + (r.product_other ?? 0) + (r.wholesale ?? 0)
              - (r.sales_discount ?? 0) - (r.sales_refund ?? 0);
    lapisRevByLoc.set(r.location_id, (lapisRevByLoc.get(r.location_id) ?? 0) + net);
  }

  const isFetching = isFetchingCosts || isFetchingRevenue;

  // ── 2. Determine which months are missing from Supabase ───────────────
  const presentMonths = new Set((rawRows ?? []).map((r: { month: string }) => r.month));
  const missingMonths = allMonths.filter((m) => !presentMonths.has(m));

  // ── 3. Sync mutation (calls Next.js API route → Python ETL) ──────────
  const syncMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean }) => {
      const res = await fetch("/api/etl/zoho-spa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_from: toDateStr(dateFrom),  // actual selected date, not month start
          date_to:   toDateStr(dateTo),    // actual selected date, not month end
          force,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spa-ebitda", fromStr, toStr] });
    },
  });

  // ── 4. Auto-trigger sync when missing months detected ─────────────────
  // Guard: skip while initial fetch is in flight (rawRows undefined = all months appear missing)
  const missingKey = missingMonths.join(",");
  if (missingMonths.length > 0 && !isFetching && !syncMutation.isPending && missingKey !== lastFiredRef.current) {
    lastFiredRef.current = missingKey;
    setTimeout(() => syncMutation.mutate({ force: false }), 0);
  }

  // ── 5. Aggregate Supabase rows per location ───────────────────────────
  type Row = {
    location_id: number;
    month: string;
    revenue: number;
    cogs: number;
    wages: number;
    advertising: number;
    rent: number;
    utilities: number;
    sga: number;
    zoho_synced_at: string | null;
    locations: { id: number; slug: string; name: string } | null;
  };

  const locMap = new Map<number, SpaLocationData>();

  for (const row of (rawRows ?? []) as Row[]) {
    const loc = row.locations;
    if (!loc) continue;
    const meta = SPA_LOCATION_META[loc.slug] ?? { name: loc.name, color: "#6B7280" };

    if (!locMap.has(loc.id)) {
      locMap.set(loc.id, {
        id: loc.id, slug: loc.slug, name: meta.name, color: meta.color,
        revenue: 0, cogs: 0, wages: 0, advertising: 0,
        rent: 0, utilities: 0, sga: 0, ebitda: 0,
        lastSyncedAt: null,
      });
    }
    const agg = locMap.get(loc.id)!;
    agg.revenue     += row.revenue     ?? 0;
    agg.cogs        += row.cogs        ?? 0;
    agg.wages       += row.wages       ?? 0;
    agg.advertising += row.advertising ?? 0;
    agg.rent        += row.rent        ?? 0;
    agg.utilities   += row.utilities   ?? 0;
    agg.sga         += row.sga         ?? 0;
    if (row.zoho_synced_at && (!agg.lastSyncedAt || row.zoho_synced_at > agg.lastSyncedAt)) {
      agg.lastSyncedAt = row.zoho_synced_at;
    }
  }

  // Compute EBITDA and round all values
  const locations: SpaLocationData[] = Array.from(locMap.values())
    .map((loc) => {
      // Use Lapis net revenue if available; fall back to Zoho revenue from spa_ebitda_monthly
      const lapRev = lapisRevByLoc.get(loc.id);
      const revenue = lapRev !== undefined ? lapRev : loc.revenue;
      const costs = loc.cogs + loc.wages + loc.advertising + loc.rent + loc.utilities + loc.sga;
      return {
        ...loc,
        revenue:     Math.round(revenue),
        cogs:        Math.round(loc.cogs),
        wages:       Math.round(loc.wages),
        advertising: Math.round(loc.advertising),
        rent:        Math.round(loc.rent),
        utilities:   Math.round(loc.utilities),
        sga:         Math.round(loc.sga),
        ebitda:      Math.round(revenue - costs),
      };
    })
    .sort((a, b) => b.revenue - a.revenue); // largest revenue first

  return {
    locations,
    isFetching,
    isSyncing: syncMutation.isPending,
    syncError: syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync: (force = false) => syncMutation.mutate({ force }),
  };
}
