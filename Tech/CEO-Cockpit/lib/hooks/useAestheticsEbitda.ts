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
  salesRevenue: number;
  zohoRevenue: number;
  otherIncome: number;
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

// ── Fallback thresholds (mirrored from old monthly ETL) ──────────────────────
const WAGE_ZERO_THRESHOLD = 100;
const WAGE_LOW_FRACTION   = 0.35;
const RENT_ZERO_THRESHOLD = 1;

const DEPTS = ["aesthetics", "slimming"] as const;
type Dept = (typeof DEPTS)[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

function periodDayCount(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function overlapDaysInMonth(periodFrom: Date, periodTo: Date, year: number, month: number): number {
  const mStart = new Date(year, month - 1, 1);
  const mEnd   = new Date(year, month - 1, daysInMonth(year, month));
  const lo = mStart > periodFrom ? mStart : periodFrom;
  const hi = mEnd   < periodTo   ? mEnd   : periodTo;
  if (hi < lo) return 0;
  return periodDayCount(lo, hi);
}

const TOP_SERVICES = 8;

// ── Types ────────────────────────────────────────────────────────────────────

type DeptTotals = {
  revenue: number; cogs: number; wages: number; advertising: number;
  rent: number; utilities: number; sga: number;
};

function emptyDeptTotals(): DeptTotals {
  return { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 };
}

type DailyRow = {
  date: string; department: string;
  revenue: number; cogs: number; wages: number; advertising: number;
  rent: number; utilities: number; sga: number;
  zoho_synced_at: string | null;
};

function aggregateByDept(rows: DailyRow[]): { totals: Record<Dept, DeptTotals>; lastSyncedAt: Record<Dept, string | null> } {
  const totals: Record<Dept, DeptTotals> = { aesthetics: emptyDeptTotals(), slimming: emptyDeptTotals() };
  const lastSyncedAt: Record<Dept, string | null> = { aesthetics: null, slimming: null };
  for (const r of rows) {
    const dept = r.department as Dept;
    if (dept !== "aesthetics" && dept !== "slimming") continue;
    totals[dept].revenue     += r.revenue     ?? 0;
    totals[dept].cogs        += r.cogs        ?? 0;
    totals[dept].wages       += r.wages       ?? 0;
    totals[dept].advertising += r.advertising ?? 0;
    totals[dept].rent        += r.rent        ?? 0;
    totals[dept].utilities   += r.utilities   ?? 0;
    totals[dept].sga         += r.sga         ?? 0;
    if (r.zoho_synced_at && (!lastSyncedAt[dept] || r.zoho_synced_at > lastSyncedAt[dept]!)) {
      lastSyncedAt[dept] = r.zoho_synced_at;
    }
  }
  return { totals, lastSyncedAt };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAestheticsEbitda(dateFrom: Date, dateTo: Date): UseAestheticsEbitdaResult {
  const supabase     = createClient();
  const queryClient  = useQueryClient();
  const lastFiredRef = useRef("");

  const fromDateFull = toDateStr(dateFrom);
  const toDateFull   = toDateStr(dateTo);
  const periodDays   = periodDayCount(dateFrom, dateTo);

  const priorFrom = addDays(dateFrom, -periodDays);
  const priorTo   = addDays(dateFrom, -1);
  const priorFromStr = toDateStr(priorFrom);
  const priorToStr   = toDateStr(priorTo);

  const allMonths    = monthsInRange(dateFrom, dateTo);

  // ── 1a. Current-period dept daily rows ────────────────────────────────────
  const { data: curRows, isFetching: isFetchingCur } = useQuery({
    queryKey: ["aesth-ebitda-daily", fromDateFull, toDateFull],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aesthetics_ebitda_daily")
        .select("date, department, revenue, cogs, wages, advertising, rent, utilities, sga, zoho_synced_at")
        .gte("date", fromDateFull)
        .lte("date", toDateFull);
      if (error) throw error;
      return (data ?? []) as unknown as DailyRow[];
    },
    staleTime: 0,
  });

  // ── 1b. Prior-period dept daily rows ──────────────────────────────────────
  const { data: priorRows, isFetching: isFetchingPrior } = useQuery({
    queryKey: ["aesth-ebitda-prior", priorFromStr, priorToStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aesthetics_ebitda_daily")
        .select("date, department, revenue, cogs, wages, advertising, rent, utilities, sga, zoho_synced_at")
        .gte("date", priorFromStr)
        .lte("date", priorToStr);
      if (error) throw error;
      return (data ?? []) as unknown as DailyRow[];
    },
    staleTime: 0,
  });

  // ── 2a. Aesthetics sales (revenue + breakdown) ────────────────────────────
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

  // ── 2b. Slimming sales ────────────────────────────────────────────────────
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

  // ── 2c. Salary supplement (frozen) for each month overlapping period ──────
  const supplementMonths = [
    ...allMonths,
    `${priorFrom.getFullYear()}-${String(priorFrom.getMonth() + 1).padStart(2, "0")}-01`,
  ];
  const { data: suppRowsRaw } = useQuery({
    queryKey: ["aesth-supp", supplementMonths.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_supplement_monthly")
        .select("month, spa_slug, amount, is_frozen")
        .in("month", supplementMonths)
        .in("spa_slug", ["aesthetics", "slimming"])
        .eq("is_frozen", true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  const isFetching = isFetchingCur || isFetchingPrior || isFetchingAesthSales || isFetchingSlimSales;

  // ── 3. Aggregate current + prior dept costs ───────────────────────────────
  const { totals: curTotals, lastSyncedAt } = aggregateByDept(curRows ?? []);
  const { totals: priorTotals }             = aggregateByDept(priorRows ?? []);

  // ── 4. Sales revenue per dept (NOT prorated — sales_daily is already daily) ─
  type SalesRow     = { date_of_service: string; service_product:   string | null; price_ex_vat: number };
  type SlimSalesRow = { date_of_service: string; service_description: string | null; price_ex_vat: number };
  const aesthSalesTotal = ((aesthSales ?? []) as SalesRow[]).reduce(    (s, r) => s + (r.price_ex_vat ?? 0), 0);
  const slimSalesTotal  = ((slimSales  ?? []) as SlimSalesRow[]).reduce((s, r) => s + (r.price_ex_vat ?? 0), 0);
  const salesByDept: Record<Dept, number> = {
    aesthetics: aesthSalesTotal,
    slimming:   slimSalesTotal,
  };

  // ── 5. Apply wages fallback (per dept, period-aware) ──────────────────────
  for (const dept of DEPTS) {
    const cur   = curTotals[dept].wages;
    const prior = priorTotals[dept].wages;
    const useFallback =
      cur < WAGE_ZERO_THRESHOLD ||
      (prior > 0 && cur < prior * WAGE_LOW_FRACTION);
    if (useFallback && prior > 0) {
      curTotals[dept].wages = prior;
    }
  }

  // ── 6. Apply rent fallback (per dept, period-aware) ───────────────────────
  for (const dept of DEPTS) {
    const cur   = curTotals[dept].rent;
    const prior = priorTotals[dept].rent;
    if (cur < RENT_ZERO_THRESHOLD && prior > 0) {
      curTotals[dept].rent = prior;
    }
    // (No benchmark configured for aesthetics depts — BENCHMARK_RENT was {aesthetics:0, slimming:0})
  }

  // ── 7. Salary supplement (per month overlap) ──────────────────────────────
  type SuppRow = { month: string; spa_slug: string; amount: number; is_frozen: boolean };
  const suppByMonth = new Map<string, SuppRow[]>();
  for (const sr of (suppRowsRaw ?? []) as SuppRow[]) {
    if (!suppByMonth.has(sr.month)) suppByMonth.set(sr.month, []);
    suppByMonth.get(sr.month)!.push(sr);
  }

  for (const monthKey of allMonths) {
    const y = parseInt(monthKey.slice(0, 4)), m = parseInt(monthKey.slice(5, 7));
    let monthRows = suppByMonth.get(monthKey);
    let suppDays  = daysInMonth(y, m);
    if (!monthRows || !monthRows.length) {
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const prevKey = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
      monthRows = suppByMonth.get(prevKey);
      suppDays  = daysInMonth(prevY, prevM);
    }
    if (!monthRows || !monthRows.length) continue;

    const overlap = overlapDaysInMonth(dateFrom, dateTo, y, m);
    if (overlap === 0) continue;
    for (const sr of monthRows) {
      const prorated = (Number(sr.amount) ?? 0) * overlap / suppDays;
      if (sr.spa_slug === "aesthetics" || sr.spa_slug === "slimming") {
        curTotals[sr.spa_slug as Dept].wages += prorated;
      }
    }
  }

  // ── 8. Revenue breakdown by service (top N + "Other") ─────────────────────
  const byServiceAesth = new Map<string, number>();
  const byServiceSlim  = new Map<string, number>();
  for (const r of ((aesthSales ?? []) as SalesRow[])) {
    const svc = (r.service_product ?? "Unknown").trim() || "Unknown";
    byServiceAesth.set(svc, (byServiceAesth.get(svc) ?? 0) + (r.price_ex_vat ?? 0));
  }
  for (const r of ((slimSales ?? []) as SlimSalesRow[])) {
    const svc = (r.service_description ?? "Unknown").trim() || "Unknown";
    byServiceSlim.set(svc, (byServiceSlim.get(svc) ?? 0) + (r.price_ex_vat ?? 0));
  }
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
  for (const svc of rankedServices.slice(0, TOP_SERVICES)) {
    revenueBreakdown.push({
      name: svc.name,
      aesthetics: Math.round(svc.aesthetics),
      slimming:   Math.round(svc.slimming),
      total:      Math.round(svc.total),
    });
  }
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

  // CoA-mapped Zoho income → "Other revenue" row
  const aesthZohoRev = Math.round(curTotals.aesthetics.revenue);
  const slimZohoRev  = Math.round(curTotals.slimming.revenue);
  if (aesthZohoRev + slimZohoRev > 10) {
    revenueBreakdown.push({
      name:       "Other Revenue (Zoho CoA)",
      aesthetics: aesthZohoRev,
      slimming:   slimZohoRev,
      total:      aesthZohoRev + slimZohoRev,
      isOther:    true,
    });
  }

  // ── 9. Build final dept array ─────────────────────────────────────────────
  const depts: AestheticsDeptData[] = DEPTS.map((dept) => {
    const meta = AESTH_DEPT_META[dept];
    const t    = curTotals[dept];
    const salesRev    = Math.round(salesByDept[dept] ?? 0);
    const zohoRev     = Math.round(t.revenue);
    const revenue     = salesRev + zohoRev;
    const costs       = t.cogs + t.wages + t.advertising + t.rent + t.utilities + t.sga;
    return {
      dept,
      name:         meta.name,
      color:        meta.color,
      revenue,
      salesRevenue: salesRev,
      zohoRevenue:  zohoRev,
      otherIncome:  zohoRev,
      cogs:         Math.round(t.cogs),
      wages:        Math.round(t.wages),
      advertising:  Math.round(t.advertising),
      rent:         Math.round(t.rent),
      utilities:    Math.round(t.utilities),
      sga:          Math.round(t.sga),
      ebitda:       Math.round(revenue - costs),
      lastSyncedAt: lastSyncedAt[dept],
    };
  });

  // ── 10. Missing months + auto-sync trigger ─────────────────────────────────
  const presentMonthSet = new Set<string>();
  for (const r of (curRows ?? [])) presentMonthSet.add(`${r.date.slice(0, 7)}-01`);
  const missingMonths = allMonths.filter(m => !presentMonthSet.has(m));

  const syncMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean }) => {
      const res = await fetch("/api/etl/zoho-aesthetics-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: fromDateFull, date_to: toDateFull, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aesth-ebitda-daily", fromDateFull, toDateFull] });
      queryClient.invalidateQueries({ queryKey: ["hq-ebitda",          fromDateFull, toDateFull] });
    },
  });

  const missingKey = missingMonths.join(",");
  if (missingMonths.length > 0 && !isFetching && !syncMutation.isPending && missingKey !== lastFiredRef.current) {
    lastFiredRef.current = missingKey;
    setTimeout(() => syncMutation.mutate({ force: false }), 0);
  }

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
