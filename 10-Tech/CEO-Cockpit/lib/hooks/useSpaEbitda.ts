"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ── Location display metadata ─────────────────────────────────────────────
export const SPA_LOCATION_META: Record<string, { name: string; color: string }> = {
  inter:     { name: "InterContinental", color: "#1B3A4B" },
  hugos:     { name: "Hugos",            color: "#96B2B2" },
  hyatt:     { name: "Hyatt",            color: "#B79E61" },
  ramla:     { name: "Ramla",            color: "#8EB093" },
  labranda:  { name: "Riviera",         color: "#E07A5F" },
  odycy:     { name: "Sunny Coast",      color: "#4A90D9" },
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

// ── Fallback constants (preserved from runSpaEbitdaMonth) ────────────────────

const BENCHMARK_RENT_MONTHLY: Record<number, number> = {
  1: 5100.00, 2: 1000.00, 3: 1407.00, 4: 1000.00,
  5: 1000.00, 6:  944.44, 7: 2500.00, 8:    0.00,
};

const SUPP_SLUG_TO_LOC: Record<string, number> = {
  inter:     1, hugos:     2, hyatt:     3, ramla:     4,
  labranda:  5, odycy:     6, excelsior: 7, novotel:   8,
};

const ALL_LOC_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const WAGE_ZERO_THRESHOLD    = 100;
const WAGE_LOW_FRACTION      = 0.35;
const RENT_ZERO_THRESHOLD    = 1;
const LAUNDRY_ZERO_THRESHOLD = 10;
const LAUNDRY_LOW_FRACTION   = 0.35;

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
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function periodDayCount(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// Number of days in [periodFrom, periodTo] that fall inside the calendar month
function overlapDaysInMonth(periodFrom: Date, periodTo: Date, year: number, month: number): number {
  const mStart = new Date(year, month - 1, 1);
  const mEnd   = new Date(year, month - 1, daysInMonth(year, month));
  const lo     = mStart > periodFrom ? mStart : periodFrom;
  const hi     = mEnd   < periodTo   ? mEnd   : periodTo;
  if (hi < lo) return 0;
  return periodDayCount(lo, hi);
}

// ── Types ────────────────────────────────────────────────────────────────────

type DailyRow = {
  date: string;
  location_id: number;
  revenue: number;
  cogs: number;
  wages: number;
  advertising: number;
  rent: number;
  utilities: number;
  sga: number;
  laundry: number;
  zoho_synced_at: string | null;
  locations: { id: number; slug: string; name: string } | null;
};

type LineTotals = { revenue: number; cogs: number; wages: number; advertising: number; rent: number; utilities: number; sga: number };
type LocTotalsMap = Record<number, LineTotals & { laundry: number }>;

function emptyTotals(): LineTotals & { laundry: number } {
  return { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0, laundry: 0 };
}

function aggregateByLocation(rows: DailyRow[]): LocTotalsMap {
  const out: LocTotalsMap = {};
  for (const id of ALL_LOC_IDS) out[id] = emptyTotals();
  for (const r of rows) {
    const id = r.location_id;
    if (!(id in out)) continue;
    out[id].revenue     += r.revenue     ?? 0;
    out[id].cogs        += r.cogs        ?? 0;
    out[id].wages       += r.wages       ?? 0;
    out[id].advertising += r.advertising ?? 0;
    out[id].rent        += r.rent        ?? 0;
    out[id].utilities   += r.utilities   ?? 0;
    out[id].sga         += r.sga         ?? 0;
    out[id].laundry     += r.laundry     ?? 0;
  }
  return out;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSpaEbitda(dateFrom: Date, dateTo: Date): UseSpaEbitdaResult {
  const supabase     = createClient();
  const queryClient  = useQueryClient();
  const lastFiredRef = useRef("");

  const fromDateFull = toDateStr(dateFrom);
  const toDateFull   = toDateStr(dateTo);
  const periodDays   = periodDayCount(dateFrom, dateTo);

  // Prior period of same length immediately preceding [dateFrom, dateTo]
  const priorFrom = addDays(dateFrom, -periodDays);
  const priorTo   = addDays(dateFrom, -1);
  const priorFromStr = toDateStr(priorFrom);
  const priorToStr   = toDateStr(priorTo);

  const allMonths    = monthsInRange(dateFrom, dateTo);

  // ── 1a. Current-period daily cost rows ────────────────────────────────────
  const { data: curRows, isFetching: isFetchingCur } = useQuery({
    queryKey: ["spa-ebitda-daily", fromDateFull, toDateFull],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_ebitda_daily")
        .select("date, location_id, revenue, cogs, wages, advertising, rent, utilities, sga, laundry, zoho_synced_at, locations(id, slug, name)")
        .gte("date", fromDateFull)
        .lte("date", toDateFull)
        .order("date");
      if (error) throw error;
      return (data ?? []) as unknown as DailyRow[];
    },
    staleTime: 0,
  });

  // ── 1b. Prior-period daily rows (for wage / laundry fallback) ─────────────
  const { data: priorRows, isFetching: isFetchingPrior } = useQuery({
    queryKey: ["spa-ebitda-prior", priorFromStr, priorToStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_ebitda_daily")
        .select("date, location_id, revenue, cogs, wages, advertising, rent, utilities, sga, laundry, zoho_synced_at, locations(id, slug, name)")
        .gte("date", priorFromStr)
        .lte("date", priorToStr);
      if (error) throw error;
      return (data ?? []) as unknown as DailyRow[];
    },
    staleTime: 0,
  });

  // ── 1c. Cockpit net revenue (still monthly — prorate by overlap days) ───────
  const fromMonthStr = `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, "0")}-01`;
  const toMonthStr   = `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: revenueRows, isFetching: isFetchingRevenue } = useQuery({
    queryKey: ["spa-revenue-for-ebitda", fromMonthStr, toMonthStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spa_revenue_monthly")
        .select("location_id, month, services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund")
        .gte("month", fromMonthStr)
        .lte("month", toMonthStr);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // ── 1d. Salary supplement (per month, frozen entries) ─────────────────────
  // We need: each month overlapping [dateFrom, dateTo], plus the prior month
  // (used when the current month has no frozen entry, mirroring the old ETL).
  const supplementMonths = [
    ...allMonths,
    `${priorFrom.getFullYear()}-${String(priorFrom.getMonth() + 1).padStart(2, "0")}-01`,
  ];
  const { data: suppRowsRaw } = useQuery({
    queryKey: ["spa-supp", supplementMonths.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salary_supplement_monthly")
        .select("month, spa_slug, amount, is_frozen")
        .in("month", supplementMonths)
        .eq("is_frozen", true);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  const isFetching = isFetchingCur || isFetchingPrior || isFetchingRevenue;

  // ── 2. Aggregate current + prior period costs per venue ───────────────────
  const curByLoc   = aggregateByLocation(curRows   ?? []);
  const priorByLoc = aggregateByLocation(priorRows ?? []);

  // Build location slug + last-synced map from current rows (or empty)
  const locMeta = new Map<number, { slug: string; name: string; lastSyncedAt: string | null }>();
  for (const r of (curRows ?? [])) {
    if (r.locations && !locMeta.has(r.location_id)) {
      locMeta.set(r.location_id, {
        slug: r.locations.slug,
        name: r.locations.name,
        lastSyncedAt: r.zoho_synced_at,
      });
    } else if (r.zoho_synced_at) {
      const m = locMeta.get(r.location_id);
      if (m && (!m.lastSyncedAt || r.zoho_synced_at > m.lastSyncedAt)) m.lastSyncedAt = r.zoho_synced_at;
    }
  }

  // ── 3. Cockpit net revenue per location, prorated by overlap ────────────────
  const cockpitByLoc = new Map<number, number>();
  for (const r of (revenueRows ?? []) as {
    location_id: number; month: string;
    services: number; product_phytomer: number; product_purest: number; product_other: number;
    wholesale: number; sales_discount: number; sales_refund: number;
  }[]) {
    const monthStart = new Date(r.month);
    const y = monthStart.getFullYear(), m = monthStart.getMonth() + 1;
    const md = daysInMonth(y, m);
    const overlap = overlapDaysInMonth(dateFrom, dateTo, y, m);
    if (overlap === 0) continue;
    // services + product_* columns hold inc-VAT (migration 073). Divide by 1.18
    // to reconstruct ex-VAT for the EBITDA net calculation. wholesale, discount
    // and refund come from Zoho and are already ex-VAT — leave them alone.
    const grossInc = (r.services ?? 0) + (r.product_phytomer ?? 0)
                   + (r.product_purest ?? 0) + (r.product_other ?? 0);
    const net = grossInc / 1.18
              + (r.wholesale ?? 0)
              - (r.sales_discount ?? 0) - (r.sales_refund ?? 0);
    const prorated = net * overlap / md;
    cockpitByLoc.set(r.location_id, (cockpitByLoc.get(r.location_id) ?? 0) + prorated);
  }

  // ── 4. Salary supplement (prorate by month overlap) ───────────────────────
  type SuppRow = { month: string; spa_slug: string; amount: number; is_frozen: boolean };
  const suppByLoc: Record<number, number> = Object.fromEntries(ALL_LOC_IDS.map(id => [id, 0]));
  let suppCentre = 0;

  // Group supplement rows by month for fallback (use prior month if current month has none)
  const suppByMonth = new Map<string, SuppRow[]>();
  for (const sr of (suppRowsRaw ?? []) as SuppRow[]) {
    if (!suppByMonth.has(sr.month)) suppByMonth.set(sr.month, []);
    suppByMonth.get(sr.month)!.push(sr);
  }

  for (const monthKey of allMonths) {
    const [y, m] = [parseInt(monthKey.slice(0, 4)), parseInt(monthKey.slice(5, 7))];
    let monthRows = suppByMonth.get(monthKey);
    let suppDays = daysInMonth(y, m);
    if (!monthRows || !monthRows.length) {
      // Fallback to prior month
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const prevKey = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
      monthRows = suppByMonth.get(prevKey);
      suppDays = daysInMonth(prevY, prevM);
    }
    if (!monthRows || !monthRows.length) continue;

    const overlap = overlapDaysInMonth(dateFrom, dateTo, y, m);
    if (overlap === 0) continue;

    for (const sr of monthRows) {
      const prorated = (Number(sr.amount) ?? 0) * overlap / suppDays;
      if (sr.spa_slug in SUPP_SLUG_TO_LOC) {
        suppByLoc[SUPP_SLUG_TO_LOC[sr.spa_slug]] += prorated;
      } else if (sr.spa_slug === "hq") {
        suppCentre += prorated;
      }
    }
  }

  // ── 5. Apply wages fallback (period-aware) ────────────────────────────────
  // Subtract supplement from prior wages so we compare apples to apples
  const totalCurWages = ALL_LOC_IDS.reduce((s, id) => s + curByLoc[id].wages, 0);
  const totalPriorWages = ALL_LOC_IDS.reduce((s, id) => s + priorByLoc[id].wages, 0);

  const useWageFallback =
    totalCurWages < WAGE_ZERO_THRESHOLD ||
    (totalPriorWages > 0 && totalCurWages < totalPriorWages * WAGE_LOW_FRACTION);

  if (useWageFallback && totalPriorWages > 0) {
    for (const id of ALL_LOC_IDS) {
      // Same period length, so no proration needed; use prior wages directly
      curByLoc[id].wages = priorByLoc[id].wages;
    }
  }

  // ── 6. Apply rent fallback ─────────────────────────────────────────────────
  // For each venue: if current rent < threshold AND prior > 0 → use prior; else if both 0 AND benchmark > 0 → use benchmark proration.
  // For partial-month windows where current rent is already non-zero, prorate by overlap/month_days.
  for (const id of ALL_LOC_IDS) {
    const curRent   = curByLoc[id].rent;
    const priorRent = priorByLoc[id].rent;
    const benchmark = BENCHMARK_RENT_MONTHLY[id] ?? 0;
    if (curRent < RENT_ZERO_THRESHOLD && priorRent > 0) {
      curByLoc[id].rent = priorRent;
    } else if (curRent < RENT_ZERO_THRESHOLD && priorRent <= 0 && benchmark > 0) {
      // Benchmark is monthly. Scale by total period days / avg month days (30.44).
      curByLoc[id].rent = benchmark * (periodDays / 30.44);
    }
    // No partial-month proration here; the daily data is already date-bounded.
  }

  // ── 7. Apply laundry fallback ──────────────────────────────────────────────
  const totalCurLaundry   = ALL_LOC_IDS.reduce((s, id) => s + curByLoc[id].laundry, 0);
  const totalPriorLaundry = ALL_LOC_IDS.reduce((s, id) => s + priorByLoc[id].laundry, 0);
  const useLaundryFallback =
    totalCurLaundry < LAUNDRY_ZERO_THRESHOLD ||
    (totalPriorLaundry > 0 && totalCurLaundry < totalPriorLaundry * LAUNDRY_LOW_FRACTION);
  if (useLaundryFallback && totalPriorLaundry > 0) {
    for (const id of ALL_LOC_IDS) {
      const delta = priorByLoc[id].laundry - curByLoc[id].laundry;
      curByLoc[id].sga     += delta;       // laundry sits inside SGA
      curByLoc[id].laundry  = priorByLoc[id].laundry;
    }
  }

  // ── 8. Apply salary supplement ─────────────────────────────────────────────
  // Direct-assigned supplements
  for (const id of ALL_LOC_IDS) curByLoc[id].wages += suppByLoc[id];
  // Centre supplement → distribute by salary ratio (using direct-account totals
  // already in cur wages). Falls back to equal split when no salary base.
  if (suppCentre > 0) {
    const salaryBase = ALL_LOC_IDS.reduce((s, id) => s + curByLoc[id].wages, 0);
    if (salaryBase > 0) {
      for (const id of ALL_LOC_IDS) curByLoc[id].wages += suppCentre * curByLoc[id].wages / salaryBase;
    } else {
      for (const id of ALL_LOC_IDS) curByLoc[id].wages += suppCentre / ALL_LOC_IDS.length;
    }
  }

  // ── 9. Build final SpaLocationData[] ──────────────────────────────────────
  const locations: SpaLocationData[] = ALL_LOC_IDS.map((id) => {
    const meta = locMeta.get(id);
    const slug = meta?.slug ?? "";
    const display = SPA_LOCATION_META[slug] ?? { name: meta?.name ?? "", color: "#6B7280" };

    const cockpitRev = cockpitByLoc.get(id);
    const t = curByLoc[id];
    const revenue = cockpitRev !== undefined ? cockpitRev : t.revenue;
    const costs = t.cogs + t.wages + t.advertising + t.rent + t.utilities + t.sga;

    return {
      id,
      slug,
      name:         display.name,
      color:        display.color,
      revenue:      Math.round(revenue),
      cogs:         Math.round(t.cogs),
      wages:        Math.round(t.wages),
      advertising:  Math.round(t.advertising),
      rent:         Math.round(t.rent),
      utilities:    Math.round(t.utilities),
      sga:          Math.round(t.sga),
      ebitda:       Math.round(revenue - costs),
      lastSyncedAt: meta?.lastSyncedAt ?? null,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // ── 10. Missing months + auto-sync trigger ────────────────────────────────
  // Detect missing months by checking which calendar months have ANY data
  const presentMonthSet = new Set<string>();
  for (const r of (curRows ?? [])) {
    presentMonthSet.add(`${r.date.slice(0, 7)}-01`);
  }
  const missingMonths = allMonths.filter(m => !presentMonthSet.has(m));

  const syncMutation = useMutation({
    mutationFn: async ({ force = false }: { force?: boolean }) => {
      const res = await fetch("/api/etl/zoho-spa-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_from: fromDateFull, date_to: toDateFull, force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spa-ebitda-daily", fromDateFull, toDateFull] });
      queryClient.invalidateQueries({ queryKey: ["hq-ebitda",        fromDateFull, toDateFull] });
    },
  });

  // Auto-sync only fires when current OR previous calendar month is missing.
  // Historical months stay visible in the badge but need a manual Sync click —
  // otherwise opening any back-period kicks off a Zoho ETL on every page load.
  const now = new Date();
  const curMonthIso  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthIso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-01`;
  const autoSyncable = missingMonths.filter(m => m === curMonthIso || m === prevMonthIso);
  const missingKey = autoSyncable.join(",");
  if (autoSyncable.length > 0 && !isFetching && !syncMutation.isPending && missingKey !== lastFiredRef.current) {
    lastFiredRef.current = missingKey;
    setTimeout(() => syncMutation.mutate({ force: false }), 0);
  }

  return {
    locations,
    isFetching,
    isSyncing:    syncMutation.isPending,
    syncError:    syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync:  (force = false) => syncMutation.mutate({ force }),
  };
}
