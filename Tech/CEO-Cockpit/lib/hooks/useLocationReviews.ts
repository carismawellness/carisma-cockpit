"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format, parseISO, subMonths, startOfMonth } from "date-fns";

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ReviewDataPoint {
  date: string;
  total_reviews: number;
  avg_rating: number;
  /** Human-readable x-axis label, e.g. "Jun 2" */
  weekLabel: string;
}

export interface UseLocationReviewsResult {
  data: ReviewDataPoint[];
  currentRating: number | null;
  currentReviews: number | null;
  reviewsGainedThisMonth: number;
  isLoading: boolean;
  isError: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useLocationReviews(locationId: number | null): UseLocationReviewsResult {
  const sixMonthsAgo = format(subMonths(new Date(), 6), "yyyy-MM-dd");

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ["location_reviews", locationId],
    enabled: locationId != null,
    staleTime: 30 * 60 * 1000, // 30 minutes
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("google_reviews")
        .select("date, total_reviews, avg_rating")
        .eq("location_id", locationId!)
        .gte("date", sixMonthsAgo)
        .order("date", { ascending: true });

      if (error) throw new Error(error.message);
      return data as { date: string; total_reviews: number; avg_rating: number }[];
    },
  });

  if (!rows || rows.length === 0 || locationId == null) {
    return {
      data: [],
      currentRating: null,
      currentReviews: null,
      reviewsGainedThisMonth: 0,
      isLoading,
      isError,
    };
  }

  // Map to display points
  const data: ReviewDataPoint[] = rows.map((r) => ({
    date: r.date,
    total_reviews: r.total_reviews,
    avg_rating: r.avg_rating,
    weekLabel: format(parseISO(r.date), "MMM d"),
  }));

  const latest = data[data.length - 1];
  const currentRating = latest?.avg_rating ?? null;
  const currentReviews = latest?.total_reviews ?? null;

  // Reviews gained this month: latest row this month minus latest row last month
  const thisMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const lastMonthStart = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd");

  const thisMonthRows = data.filter((r) => r.date >= thisMonthStart);
  const lastMonthRows = data.filter(
    (r) => r.date >= lastMonthStart && r.date < thisMonthStart,
  );

  const thisMonthLatest = thisMonthRows[thisMonthRows.length - 1]?.total_reviews ?? null;
  const lastMonthLatest = lastMonthRows[lastMonthRows.length - 1]?.total_reviews ?? null;

  let reviewsGainedThisMonth = 0;
  if (thisMonthLatest != null && lastMonthLatest != null) {
    reviewsGainedThisMonth = Math.max(0, thisMonthLatest - lastMonthLatest);
  }

  return {
    data,
    currentRating,
    currentReviews,
    reviewsGainedThisMonth,
    isLoading,
    isError,
  };
}
