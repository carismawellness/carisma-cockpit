"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Department display metadata ───────────────────────────────────────────────
export const AESTH_DEPT_META: Record<string, { name: string; color: string }> = {
  aesthetics: { name: "Aesthetics", color: "#B79E61" },
  slimming:   { name: "Slimming",   color: "#4A90D9" },
};

export interface AestheticsDeptData {
  dept: string;
  name: string;
  color: string;
  revenue: number;       // primary = sales_daily; fallback = Zoho
  salesRevenue: number;  // from aesthetics/slimming_sales_daily
  zohoRevenue: number;   // from aesthetics_ebitda_monthly
  otherIncome: number;   // Zoho income not captured in sales_daily (max 0)
  cogs: number;
  wages: number;
  advertising: number;
  rent: number;
  utilities: number;
  sga: number;
  ebitda: number;
  lastSyncedAt: string | null;
}

export interface RevenueBreakdownRow {
  name: string;
  aesthetics: number;
  slimming: number;
  total: number;
  isOther?: boolean;
}

export interface UseAestheticsEbitdaResult {
  depts: AestheticsDeptData[];
  revenueBreakdown: RevenueBreakdownRow[];
  isFetching: boolean;
  isSyncing: boolean;
  syncError: string | null;
  missingMonths: string[];
  triggerSync: (force?: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d   = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1);
  while (d <= end) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const TOP_SERVICES = 8; // show top N services before collapsing the rest into "Other"

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAestheticsEbitda(dateFrom: Date, dateTo: Date): UseAestheticsEbitdaResult {
  const supabase     = createClient();
  const queryClient  = useQueryClient();
  const lastFiredRef = useRef("");

  const fromStr    = toDateStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toStr      = toDateStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const fromDateFull = toDateStr(dateFrom);
  const toDateFull   = toDateStr(dateTo);
  const allMonths  = monthsInRange(dateFrom, dateTo);

  // ── 1. Fetch cost rows from aesthetics_ebitda_monthly ────────────────────
  const { data: ebitdaRows, isFetching: isFetchingEbitda } = useQuery({
    queryKey: ["aesth-ebitda", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aesthetics_ebitda_monthly")
        .select("month, department, revenue, cogs, wages, advertising, rent, utilities, sga, zoho_synced_at")
        .gte("month", fromStr)
        .lte("month", toStr)
        .order("month");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 2a. Fetch Aesthetics sales revenue (ex-VAT) from sales_daily ─────────
  const { data: aesthSales, isFetching: isFetchingAesthSales } = useQuery({
    queryKey: ["aesth-sales-rev", fromDateFull, toDateFull],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aesthetics_sales_daily")
        .select("date_of_service, service_product, price_ex_vat")
        .gte("date_of_service", fromDateFull)
        .lte("date_of_service", toDateFull);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 2b. Fetch Slimming sales revenue (ex-VAT) from slimming_sales_daily ──
  // Note: slimming_sales_daily uses "service_description" not "service_product"
  const { data: slimSales, isFetching: isFetchingSlimSales } = useQuery({
    queryKey: ["slim-sales-rev", fromDateFull, toDateFull],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slimming_sales_daily")
        .select("date_of_service, service_description, price_ex_vat")
        .gte("date_of_service", fromDateFull)
        .lte("date_of_service", toDateFull);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  const isFetching = isFetchingEbitda || isFetchingAesthSales || isFetchingSlimSales;

  // ── 3. Determine missing months ────────────────────────────────────────────
  type EbitdaRow = {
    month: string; department: string;
    revenue: number; cogs: number; wages: number; advertising: number;
    rent: number; utilities: number; sga: number; zoho_synced_at: string | null;
  };
  type SalesRow     = { date_of_service: string; service_product:   string | null; price_ex_vat: number };
  type SlimSalesRow = { date_of_service: string; service_description: string | null; price_ex_vat: number };

  const presentMonths = new Set(
    (ebitdaRows ?? []).map((r: EbitdaRow) => r.month)
  );
  const missingMonths = allMonths.filter((m) => !presentMonths.has(m));

  // ── 4. Sync mutation ───────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean }) => {
      const res = await fetch("/api/etl/zoho-aesthetics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_from: fromDateFull,
          date_to:   toDateFull,
          force,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aesth-ebitda", fromStr, toStr] });
    },
  });

  // Auto-trigger sync when months are missing
  const missingKey = missingMonths.join(",");
  if (missingMonths.length > 0 && !isFetching && !syncMutation.isPending && missingKey !== lastFiredRef.current) {
    lastFiredRef.current = missingKey;
    setTimeout(() => syncMutation.mutate({ force: false }), 0);
  }

  // ── 5. Aggregate EBITDA costs per department ───────────────────────────────
  const deptCosts = new Map<string, Omit<AestheticsDeptData, "revenue" | "salesRevenue" | "zohoRevenue" | "otherIncome" | "ebitda"> & { zohoRevenue: number }>();

  for (const row of (ebitdaRows ?? []) as EbitdaRow[]) {
    const dept = row.department ?? "aesthetics";
    if (!deptCosts.has(dept)) {
      const meta = AESTH_DEPT_META[dept] ?? { name: dept, color: "#6B7280" };
      deptCosts.set(dept, {
        dept, name: meta.name, color: meta.color,
        zohoRevenue: 0, cogs: 0, wages: 0, advertising: 0,
        rent: 0, utilities: 0, sga: 0, lastSyncedAt: null,
      });
    }
    const agg = deptCosts.get(dept)!;
    agg.zohoRevenue  += row.revenue     ?? 0;
    agg.cogs         += row.cogs        ?? 0;
    agg.wages        += row.wages       ?? 0;
    agg.advertising  += row.advertising ?? 0;
    agg.rent         += row.rent        ?? 0;
    agg.utilities    += row.utilities   ?? 0;
    agg.sga          += row.sga         ?? 0;
    if (row.zoho_synced_at && (!agg.lastSyncedAt || row.zoho_synced_at > agg.lastSyncedAt)) {
      agg.lastSyncedAt = row.zoho_synced_at;
    }
  }

  // ── 6. Aggregate sales revenue from sales_daily tables ────────────────────
  const aesthSalesTotal = (aesthSales ?? []).reduce(
    (s: number, r: SalesRow) => s + (r.price_ex_vat ?? 0), 0
  );
  const slimSalesTotal = (slimSales ?? []).reduce(
    (s: number, r: SlimSalesRow) => s + (r.price_ex_vat ?? 0), 0
  );
  const salesByDept: Record<string, number> = {
    aesthetics: aesthSalesTotal,
    slimming:   slimSalesTotal,
  };

  // ── 7. Build revenue breakdown by service/product ─────────────────────────
  // Aggregate both dept sales by service_product
  const byServiceAesth = new Map<string, number>();
  const byServiceSlim  = new Map<string, number>();

  for (const r of (aesthSales ?? []) as SalesRow[]) {
    const svc = (r.service_product ?? "Unknown").trim() || "Unknown";
    byServiceAesth.set(svc, (byServiceAesth.get(svc) ?? 0) + (r.price_ex_vat ?? 0));
  }
  for (const r of (slimSales ?? []) as SlimSalesRow[]) {
    const svc = (r.service_description ?? "Unknown").trim() || "Unknown";
    byServiceSlim.set(svc, (byServiceSlim.get(svc) ?? 0) + (r.price_ex_vat ?? 0));
  }

  // Merge all service names, rank by combined total
  const allServices = new Set([...byServiceAesth.keys(), ...byServiceSlim.keys()]);
  const rankedServices = Array.from(allServices)
    .map((svc) => ({
      name:       svc,
      aesthetics: byServiceAesth.get(svc) ?? 0,
      slimming:   byServiceSlim.get(svc)  ?? 0,
      total:      (byServiceAesth.get(svc) ?? 0) + (byServiceSlim.get(svc) ?? 0),
    }))
    .sort((a, b) => b.total - a.total);

  const revenueBreakdown: RevenueBreakdownRow[] = [];

  // Top N individual services
  for (const svc of rankedServices.slice(0, TOP_SERVICES)) {
    revenueBreakdown.push({
      name: svc.name,
      aesthetics: Math.round(svc.aesthetics),
      slimming:   Math.round(svc.slimming),
      total:      Math.round(svc.total),
    });
  }

  // "Other services" bucket
  if (rankedServices.length > TOP_SERVICES) {
    const rest = rankedServices.slice(TOP_SERVICES);
    revenueBreakdown.push({
      name:       "Other services & products",
      aesthetics: Math.round(rest.reduce((s, r) => s + r.aesthetics, 0)),
      slimming:   Math.round(rest.reduce((s, r) => s + r.slimming,   0)),
      total:      Math.round(rest.reduce((s, r) => s + r.total,      0)),
      isOther:    true,
    });
  }

  // CoA-mapped Zoho income — only accounts explicitly set as "revenue" in CoA settings
  const aesthZohoRev = Math.round(deptCosts.get("aesthetics")?.zohoRevenue ?? 0);
  const slimZohoRev  = Math.round(deptCosts.get("slimming")?.zohoRevenue  ?? 0);
  if (aesthZohoRev + slimZohoRev > 10) {
    revenueBreakdown.push({
      name:       "Other Revenue (Zoho CoA)",
      aesthetics: aesthZohoRev,
      slimming:   slimZohoRev,
      total:      aesthZohoRev + slimZohoRev,
      isOther:    true,
    });
  }

  // ── 8. Build final dept objects ────────────────────────────────────────────
  // Ensure both depts always present (even if no data)
  for (const dept of ["aesthetics", "slimming"]) {
    if (!deptCosts.has(dept)) {
      const meta = AESTH_DEPT_META[dept];
      deptCosts.set(dept, {
        dept, name: meta.name, color: meta.color,
        zohoRevenue: 0, cogs: 0, wages: 0, advertising: 0,
        rent: 0, utilities: 0, sga: 0, lastSyncedAt: null,
      });
    }
  }

  const depts: AestheticsDeptData[] = Array.from(deptCosts.entries())
    .sort(([a], [b]) => (a === "aesthetics" ? -1 : 1) - (b === "aesthetics" ? -1 : 1))
    .map(([dept, agg]) => {
      const salesRev    = Math.round(salesByDept[dept] ?? 0);
      const zohoRev     = Math.round(agg.zohoRevenue);
      // Revenue = booking-system sales + only CoA-mapped Zoho income (additive, not fallback)
      const revenue     = salesRev + zohoRev;
      const otherIncome = zohoRev;
      const costs = agg.cogs + agg.wages + agg.advertising + agg.rent + agg.utilities + agg.sga;
      return {
        dept,
        name:         agg.name,
        color:        agg.color,
        revenue,
        salesRevenue: salesRev,
        zohoRevenue:  zohoRev,
        otherIncome:  Math.round(otherIncome),
        cogs:         Math.round(agg.cogs),
        wages:        Math.round(agg.wages),
        advertising:  Math.round(agg.advertising),
        rent:         Math.round(agg.rent),
        utilities:    Math.round(agg.utilities),
        sga:          Math.round(agg.sga),
        ebitda:       Math.round(revenue - costs),
        lastSyncedAt: agg.lastSyncedAt,
      };
    });

  return {
    depts,
    revenueBreakdown,
    isFetching,
    isSyncing:    syncMutation.isPending,
    syncError:    syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync:  (force = false) => syncMutation.mutate({ force }),
  };
}
