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
import { format, startOfMonth, subDays, parseISO } from "date-fns";

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

interface GoogleReviewRow {
  date: string;
  location_id: number;
  total_reviews: number | null;
  avg_rating: number | string | null;
}

export function useGoogleReviews(dateTo: Date) {
  const lookup = useLocationsLookup();
  const toStr = format(dateTo, "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["google_reviews_latest", toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();
      const select = "date, location_id, total_reviews, avg_rating";

      // Latest snapshots with date ≤ dateTo. 600 rows ≈ 60 days × 10 locations,
      // enough to also find the ~1-month-earlier snapshot per location.
      let { data, error } = await supabase
        .from("google_reviews")
        .select(select)
        .lte("date", toStr)
        .order("date", { ascending: false })
        .limit(600);
      if (error) throw new Error(error.message);

      // Fallback: nothing on/before dateTo — use latest available snapshot.
      if (!data || data.length === 0) {
        const fb = await supabase
          .from("google_reviews")
          .select(select)
          .order("date", { ascending: false })
          .limit(600);
        if (fb.error) throw new Error(fb.error.message);
        data = fb.data;
      }

      const rows = (data ?? []) as GoogleReviewRow[];
      if (rows.length === 0) {
        return { snapshots: [] as ReviewSnapshot[], snapshotDate: null as string | null };
      }

      const snapshotDate = rows[0].date;

      // Latest row per location (rows are date-desc).
      const latestByLoc = new Map<number, GoogleReviewRow>();
      for (const row of rows) {
        if (!latestByLoc.has(row.location_id)) latestByLoc.set(row.location_id, row);
      }

      // Previous snapshot ≈ 1 month earlier (latest row ≥ 21 days older).
      const prevCutoff = format(subDays(parseISO(snapshotDate), 21), "yyyy-MM-dd");
      const prevByLoc = new Map<number, GoogleReviewRow>();
      for (const row of rows) {
        if (row.date <= prevCutoff && !prevByLoc.has(row.location_id)) {
          prevByLoc.set(row.location_id, row);
        }
      }

      const byId = lookup.data!.byId;
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

      return { snapshots, snapshotDate };
    },
  });

  return {
    snapshots: queryResult.data?.snapshots ?? [],
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

export function useDiligenceAudit(dateFrom: Date, dateTo: Date) {
  const lookup = useLocationsLookup();
  const fromMonth = format(startOfMonth(dateFrom), "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["diligence_audit_latest", fromMonth, toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();
      const select =
        "month, location_id, total_sales, deleted_cancelled, complimentary, cash_sales, discounted_cash, unattended_count";

      // Latest month within [startOfMonth(dateFrom), dateTo].
      let { data, error } = await supabase
        .from("diligence_audit")
        .select(select)
        .gte("month", fromMonth)
        .lte("month", toStr)
        .order("month", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);

      // Fallback: no month in range — use the latest available month.
      if (!data || data.length === 0) {
        const fb = await supabase
          .from("diligence_audit")
          .select(select)
          .order("month", { ascending: false })
          .limit(60);
        if (fb.error) throw new Error(fb.error.message);
        data = fb.data;
      }

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

      // Stable order: by total sales descending (largest venue first).
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

export function useStandardsScores(
  standardType: "facility" | "front_desk" | "mystery_guest",
  dateFrom: Date,
  dateTo: Date,
) {
  const lookup = useLocationsLookup();
  const fromMonth = format(startOfMonth(dateFrom), "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["brand_standards_scores", standardType, fromMonth, toStr],
    enabled: !!lookup.data,
    queryFn: async () => {
      const supabase = createClient();

      // Latest month with data in range (each standard type independently).
      let monthRes = await supabase
        .from("brand_standards")
        .select("month")
        .eq("standard_type", standardType)
        .gte("month", fromMonth)
        .lte("month", toStr)
        .order("month", { ascending: false })
        .limit(1);
      if (monthRes.error) throw new Error(monthRes.error.message);

      let month: string | null = monthRes.data?.[0]?.month ?? null;
      if (!month) {
        // Fallback: latest month with data overall.
        monthRes = await supabase
          .from("brand_standards")
          .select("month")
          .eq("standard_type", standardType)
          .order("month", { ascending: false })
          .limit(1);
        if (monthRes.error) throw new Error(monthRes.error.message);
        month = monthRes.data?.[0]?.month ?? null;
      }
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

      // Aggregate per location: score = passed/total, issues = result=false items.
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
