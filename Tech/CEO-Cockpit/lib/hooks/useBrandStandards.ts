"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { format, startOfMonth } from "date-fns";

// ── Row type ────────────────────────────────────────────────────────────────

export interface BrandStandardsRow {
  id: string;
  month: string;
  standard_type: string;
  category: string;
  item: string;
  location: string;
  result: boolean;
}

// ── Aggregation interfaces ──────────────────────────────────────────────────

export interface LocationScore {
  location: string;
  total: number;
  passed: number;
  score: number;
}

export interface CategoryScore {
  category: string;
  total: number;
  passed: number;
  score: number;
}

export interface ChecklistItem {
  item: string;
  category: string;
  locations: Record<string, boolean>;
  passRate: number;
}

// ── Aggregation helpers ─────────────────────────────────────────────────────

export function computeLocationScores(data: BrandStandardsRow[]): LocationScore[] {
  const map = new Map<string, { total: number; passed: number }>();

  for (const row of data) {
    const entry = map.get(row.location) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (row.result) entry.passed += 1;
    map.set(row.location, entry);
  }

  return Array.from(map.entries())
    .map(([location, { total, passed }]) => ({
      location,
      total,
      passed,
      score: total > 0 ? Math.round((passed / total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function computeCategoryScores(data: BrandStandardsRow[]): CategoryScore[] {
  const map = new Map<string, { total: number; passed: number }>();

  for (const row of data) {
    const entry = map.get(row.category) ?? { total: 0, passed: 0 };
    entry.total += 1;
    if (row.result) entry.passed += 1;
    map.set(row.category, entry);
  }

  return Array.from(map.entries())
    .map(([category, { total, passed }]) => ({
      category,
      total,
      passed,
      score: total > 0 ? Math.round((passed / total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function computeChecklistItems(data: BrandStandardsRow[]): ChecklistItem[] {
  const map = new Map<string, { category: string; locations: Record<string, boolean> }>();

  for (const row of data) {
    const entry = map.get(row.item) ?? { category: row.category, locations: {} };
    entry.locations[row.location] = row.result;
    map.set(row.item, entry);
  }

  return Array.from(map.entries()).map(([item, { category, locations }]) => {
    const values = Object.values(locations);
    const passRate = values.length > 0
      ? Math.round((values.filter(Boolean).length / values.length) * 100)
      : 0;
    return { item, category, locations, passRate };
  });
}

export function computeOverallScore(data: BrandStandardsRow[]): number {
  if (data.length === 0) return 0;
  const passed = data.filter((row) => row.result).length;
  return Math.round((passed / data.length) * 100);
}

// ── Hook options ────────────────────────────────────────────────────────────

interface UseBrandStandardsOptions {
  standardType: string;
  month: Date;
  location: string | null;
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function useBrandStandards({
  standardType,
  month,
  location,
}: UseBrandStandardsOptions) {
  const monthStr = format(startOfMonth(month), "yyyy-MM-dd");

  const queryResult = useQuery({
    queryKey: ["brand_standards", standardType, monthStr, location],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("brand_standards")
        .select("*")
        .eq("standard_type", standardType)
        .eq("month", monthStr)
        .order("category", { ascending: true })
        .order("item", { ascending: true });

      if (location) {
        query = query.eq("location", location);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data as BrandStandardsRow[]) || [];
    },
  });

  const monthsResult = useQuery({
    queryKey: ["brand_standards_months", standardType],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("brand_standards")
        .select("month")
        .eq("standard_type", standardType);

      if (error) throw new Error(error.message);

      const unique = [...new Set((data || []).map((r: { month: string }) => r.month))];
      return unique
        .sort()
        .map((m) => new Date(m));
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    data: queryResult.data || [],
    loading: queryResult.isLoading,
    error: queryResult.error?.message || null,
    availableMonths: monthsResult.data || [],
  };
}
