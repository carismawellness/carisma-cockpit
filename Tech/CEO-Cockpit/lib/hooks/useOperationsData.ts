"use client";

/**
 * Live data hooks for the Operations dashboard (app/operations/page.tsx).
 *
 * Sources (all RLS: authenticated read):
 *   google_reviews   — daily snapshot per location (date, total_reviews, avg_rating)
 *   diligence_audit  — monthly per-location audit figures (UNIQUE month, location_id)
 *   brand_standards  — per-item checklist results (month, standard_type, location slug)
 *   locations        — id → slug / display-name lookup
 */

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format, subDays, subMonths, parseISO } from "date-fns";

/* ── Shared location lookup ──────────────────────────────────────────────── */

export interface LocationInfo {
  id: number;
  slug: string;
  name: string;
}

function useLocationsLookup() {
  return useQuery({
    queryKey: ["operations_locations_lookup"],
    staleTime: 60 * 60 * 1000, // 1 hour — locations rarely change
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("locations")
        .select("id, slug, name");
      if (error) throw new Error(error.message);
      const byId = new Map<number, LocationInfo>();
      const bySlug = new Map<string, LocationInfo>();
      for (const row of data ?? []) {
        const info: LocationInfo = {
          id: row.id as number,
          slug: row.slug as string,
          name: row.name as string,
        };
        byId.set(info.id, info);
        bySlug.set(info.slug, info);
      }
      return { byId, bySlug };
    },
  });
}

/* ── Reviews ─────────────────────────────────────────────────────────────── */

export interface ReviewSnapshot {
  locationId: number;
  slug: string;
  name: string;
  totalReviews: number;
  avgRating: number;
  /** Rating from a snapshot ~1 month earlier — null when none exists. */
  prevRating: number | null;
}

export interface WeeklyReviewSummary {
  weekStart: string;    // "YYYY-MM-DD" Monday of the week
  weekLabel: string;    // "2 Jun"
  totalReviews: number; // company-wide sum
  avgRating: number;    // company-wide weighted average
}

interface GoogleReviewRow {
  date: string;
  location_id: number;
  total_reviews: number | null;
  avg_rating: number | string | null;
}

export function useGoogleReviews(dateTo: Date) {
  const lookup = useLocationsLookup();
  const toStr = format(dateTo, "yyyy-MM-dd");
  // Fetch up to 11 weeks back for trend (77 days × 10 locations = ~770 rows)
  const fromStr = format(subDays(dateTo, 77), "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["google_reviews_trend", toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();
      const select = "date, location_id, total_reviews, avg_rating";

      let { data, error } = await supabase
        .from("google_reviews")
        .select(select)
        .lte("date", toStr)
        .gte("date", fromStr)
        .order("date", { ascending: false })
        .limit(1100);
      if (error) throw new Error(error.message);

      // Fallback: no data in range — show latest available
      if (!data || data.length === 0) {
        const fb = await supabase
          .from("google_reviews")
          .select(select)
          .lte("date", toStr)
          .order("date", { ascending: false })
          .limit(200);
        if (fb.error) throw new Error(fb.error.message);
        data = fb.data;
      }

      const rows = (data ?? []) as GoogleReviewRow[];
      if (rows.length === 0) {
        return {
          snapshots: [] as ReviewSnapshot[],
          weekly: [] as WeeklyReviewSummary[],
          snapshotDate: null as string | null,
        };
      }

      const byId = lookup.data!.byId;
      const snapshotDate = rows[0].date;

      // Current snapshot: latest row per location
      const latestByLoc = new Map<number, GoogleReviewRow>();
      for (const row of rows) {
        if (!latestByLoc.has(row.location_id)) latestByLoc.set(row.location_id, row);
      }

      // Previous snapshot ≈ 1 month earlier for trend arrow
      const prevCutoff = format(subDays(parseISO(snapshotDate), 21), "yyyy-MM-dd");
      const prevByLoc = new Map<number, GoogleReviewRow>();
      for (const row of rows) {
        if (row.date <= prevCutoff && !prevByLoc.has(row.location_id)) {
          prevByLoc.set(row.location_id, row);
        }
      }

      const snapshots: ReviewSnapshot[] = [];
      for (const [locationId, row] of latestByLoc) {
        const info = byId.get(locationId);
        if (!info) continue;
        const prev = prevByLoc.get(locationId);
        snapshots.push({
          locationId,
          slug: info.slug,
          name: info.name,
          totalReviews: Number(row.total_reviews ?? 0),
          avgRating: Number(row.avg_rating ?? 0),
          prevRating: prev ? Number(prev.avg_rating ?? 0) : null,
        });
      }

      // Weekly buckets: group by ISO week (Monday start)
      const weekBuckets = new Map<string, Map<number, GoogleReviewRow>>();
      for (const row of rows) {
        const d = parseISO(row.date);
        const dow = d.getDay(); // 0=Sun … 6=Sat
        const daysToMon = dow === 0 ? 6 : dow - 1;
        const monday = format(new Date(d.getTime() - daysToMon * 86_400_000), "yyyy-MM-dd");
        if (!weekBuckets.has(monday)) weekBuckets.set(monday, new Map());
        const bucket = weekBuckets.get(monday)!;
        const existing = bucket.get(row.location_id);
        // Keep latest snapshot within each week
        if (!existing || row.date >= existing.date) bucket.set(row.location_id, row);
      }

      // Last 10 weekly periods, oldest-first for chart
      const sortedWeeks = Array.from(weekBuckets.keys()).sort().reverse().slice(0, 10).reverse();

      const weekly: WeeklyReviewSummary[] = sortedWeeks.map((weekStart) => {
        const bucket = weekBuckets.get(weekStart)!;
        let total = 0, weightedRating = 0;
        for (const row of bucket.values()) {
          const rev = Number(row.total_reviews ?? 0);
          total += rev;
          weightedRating += Number(row.avg_rating ?? 0) * rev;
        }
        return {
          weekStart,
          weekLabel: format(parseISO(weekStart), "d MMM"),
          totalReviews: total,
          avgRating: total > 0 ? +(weightedRating / total).toFixed(2) : 0,
        };
      });

      return { snapshots, weekly, snapshotDate };
    },
  });

  return {
    snapshots: queryResult.data?.snapshots ?? [],
    weekly: queryResult.data?.weekly ?? [],
    snapshotDate: queryResult.data?.snapshotDate ?? null,
    loading: queryResult.isLoading || lookup.isLoading,
    error: queryResult.error?.message || lookup.error?.message || null,
  };
}

/* ── Diligence audit ─────────────────────────────────────────────────────── */

export interface DiligenceRow {
  locationId: number;
  slug: string;
  name: string;
  totalSales: number;
  /** Source report combines deleted + cancelled into one figure. */
  deletedCancelled: number;
  complimentary: number;
  cashSales: number;
  discountedCash: number;
  unattended: number;
}

interface DiligenceDbRow {
  month: string;
  location_id: number;
  total_sales: number | string | null;
  deleted_cancelled: number | string | null;
  complimentary: number | string | null;
  cash_sales: number | string | null;
  discounted_cash: number | string | null;
  unattended_count: number | null;
}

export function useDiligenceAudit(dateTo: Date) {
  const lookup = useLocationsLookup();
  const toStr = format(dateTo, "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["diligence_audit_latest", toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();
      const select =
        "month, location_id, total_sales, deleted_cancelled, complimentary, cash_sales, discounted_cash, unattended_count";

      // Latest available month on or before dateTo — no lower bound so the
      // filter is always meaningful: "Last 7 days" ending Jun 11 shows May,
      // a range ending Apr 30 shows April, etc.
      const { data, error } = await supabase
        .from("diligence_audit")
        .select(select)
        .lte("month", toStr)
        .order("month", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);

      const dbRows = (data ?? []) as DiligenceDbRow[];
      if (dbRows.length === 0) {
        return { rows: [] as DiligenceRow[], month: null as string | null };
      }

      const month = dbRows[0].month;
      const byId = lookup.data!.byId;
      const rows: DiligenceRow[] = [];
      for (const r of dbRows.filter((r) => r.month === month)) {
        const info = byId.get(r.location_id);
        if (!info) continue;
        rows.push({
          locationId: r.location_id,
          slug: info.slug,
          name: info.name,
          totalSales: Number(r.total_sales ?? 0),
          deletedCancelled: Number(r.deleted_cancelled ?? 0),
          complimentary: Number(r.complimentary ?? 0),
          cashSales: Number(r.cash_sales ?? 0),
          discountedCash: Number(r.discounted_cash ?? 0),
          unattended: Number(r.unattended_count ?? 0),
        });
      }

      rows.sort((a, b) => b.totalSales - a.totalSales);
      return { rows, month };
    },
  });

  return {
    rows: queryResult.data?.rows ?? [],
    month: queryResult.data?.month ?? null,
    loading: queryResult.isLoading || lookup.isLoading,
    error: queryResult.error?.message || lookup.error?.message || null,
  };
}

/* ── Brand standards (facility / mystery_guest) ──────────────────────────── */

export interface StandardsLocationRow {
  /** locations.slug — brand_standards stores slugs directly. */
  slug: string;
  name: string;
  score: number; // 0-100, count(result=true)/count(*)
  total: number;
  passed: number;
  issues: { category: string; item: string }[];
}

export interface MonthlyStandardScore {
  month: string;       // "YYYY-MM-DD"
  monthLabel: string;  // "Apr 26"
  avgScore: number;    // company-wide average 0-100
}

export function useStandardsScores(
  standardType: "facility" | "front_desk" | "mystery_guest",
  dateTo: Date,
) {
  const lookup = useLocationsLookup();
  const toStr = format(dateTo, "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["brand_standards_scores", standardType, toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();

      const monthRes = await supabase
        .from("brand_standards")
        .select("month")
        .eq("standard_type", standardType)
        .lte("month", toStr)
        .order("month", { ascending: false })
        .limit(1);
      if (monthRes.error) throw new Error(monthRes.error.message);

      const month: string | null = monthRes.data?.[0]?.month ?? null;
      if (!month) {
        return { rows: [] as StandardsLocationRow[], month: null as string | null };
      }

      const { data, error } = await supabase
        .from("brand_standards")
        .select("location, category, item, result")
        .eq("standard_type", standardType)
        .eq("month", month)
        .order("category", { ascending: true })
        .order("item", { ascending: true })
        .limit(2000);
      if (error) throw new Error(error.message);

      const agg = new Map<
        string,
        { total: number; passed: number; issues: { category: string; item: string }[] }
      >();
      for (const row of data ?? []) {
        const slug = row.location as string;
        const entry = agg.get(slug) ?? { total: 0, passed: 0, issues: [] };
        entry.total += 1;
        if (row.result) entry.passed += 1;
        else entry.issues.push({ category: row.category as string, item: row.item as string });
        agg.set(slug, entry);
      }

      const bySlug = lookup.data!.bySlug;
      const rows: StandardsLocationRow[] = Array.from(agg.entries()).map(
        ([slug, { total, passed, issues }]) => ({
          slug,
          name: bySlug.get(slug)?.name ?? slug,
          score: total > 0 ? Math.round((passed / total) * 100) : 0,
          total,
          passed,
          issues,
        }),
      );

      return { rows, month };
    },
  });

  return {
    rows: queryResult.data?.rows ?? [],
    month: queryResult.data?.month ?? null,
    loading: queryResult.isLoading || lookup.isLoading,
    error: queryResult.error?.message || lookup.error?.message || null,
  };
}

/**
 * Monthly aggregate trend for facility / mystery_guest standards.
 * Returns one score per month (company-wide avg) for up to numMonths periods
 * ending at dateTo. Data is immediately useful since brand_standards has
 * backfilled history from 2024.
 */
export function useStandardsTrend(
  standardType: "facility" | "front_desk" | "mystery_guest",
  dateTo: Date,
  numMonths = 12,
) {
  const toStr = format(dateTo, "yyyy-MM-dd");
  const fromStr = format(subMonths(dateTo, numMonths), "yyyy-MM-dd");

  return useQuery({
    queryKey: ["brand_standards_trend", standardType, toStr, numMonths],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("brand_standards")
        .select("month, result")
        .eq("standard_type", standardType)
        .gte("month", fromStr)
        .lte("month", toStr)
        .order("month", { ascending: true })
        .limit(20000);
      if (error) throw new Error(error.message);

      // Aggregate per month: company-wide avg score
      const monthMap = new Map<string, { total: number; passed: number }>();
      for (const row of data ?? []) {
        const m = row.month as string;
        const entry = monthMap.get(m) ?? { total: 0, passed: 0 };
        entry.total += 1;
        if (row.result) entry.passed += 1;
        monthMap.set(m, entry);
      }

      const trend: MonthlyStandardScore[] = Array.from(monthMap.entries()).map(
        ([month, { total, passed }]) => ({
          month,
          monthLabel: format(parseISO(month), "MMM yy"),
          avgScore: total > 0 ? Math.round((passed / total) * 100) : 0,
        }),
      );

      return trend;
    },
  });
}
