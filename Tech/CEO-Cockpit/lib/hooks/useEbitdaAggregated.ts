"use client";

import { useQuery } from "@tanstack/react-query";

// Shape of /api/finance/ebitda-aggregated. Mirrors the route's response.
type Brand = "SPA" | "AES" | "SLIM" | "HQ";

export interface CategoryCell {
  value:                  number;
  has_fallback:           boolean;
  fallback_account_count: number;
}

export interface EbitdaAggregatedResponse {
  date_from:        string;
  date_to:          string;
  days_in_period:   number;
  brands:           Brand[];
  categories:       string[];
  totals:           Record<Brand, Record<string, CategoryCell>>;
  fallback_applied: Array<{
    brand:         Brand;
    account_code:  string;
    account_name:  string;
    rule_type:     string;
    period_value:  number;
    method_detail: string;
  }>;
  warnings: string[];
}

// Per-brand summary derived from the API. All values in EUR.
// Sign convention: API returns category totals as positive numbers; expenses
// subtract from revenue to compute ebitda.
export interface BrandAggregatedSummary {
  revenue:     number;
  cogs:        number;
  wages:       number;
  advertising: number;
  rent:        number;
  utilities:   number;
  sga:         number;
  ebitda:      number;
  ebitdaPct:   number;
  hasFallback: boolean;
}

function pick(brand: Record<string, CategoryCell> | undefined, key: string): number {
  return brand?.[key]?.value ?? 0;
}

function brandHasFallback(brand: Record<string, CategoryCell> | undefined): boolean {
  if (!brand) return false;
  for (const k in brand) if (brand[k].has_fallback) return true;
  return false;
}

export function brandSummaryFromTotals(
  totals: EbitdaAggregatedResponse["totals"] | undefined,
  brand: Brand,
): BrandAggregatedSummary {
  const b           = totals?.[brand];
  const revenue     = pick(b, "revenue");
  const cogs        = pick(b, "cogs");
  const wages       = pick(b, "wages");
  const advertising = pick(b, "advertising");
  const rent        = pick(b, "rent");
  const utilities   = pick(b, "utilities");
  const sga         = pick(b, "sga");
  const ebitda      = revenue - (cogs + wages + advertising + rent + utilities + sga);
  return {
    revenue, cogs, wages, advertising, rent, utilities, sga, ebitda,
    ebitdaPct:   revenue > 0 ? Math.round((ebitda / revenue) * 100) : 0,
    hasFallback: brandHasFallback(b),
  };
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface UseEbitdaAggregatedResult {
  data:        EbitdaAggregatedResponse | undefined;
  isLoading:   boolean;
  isFetching:  boolean;
  error:       Error | null;
  // Derived per-brand summaries — undefined while loading.
  spa:         BrandAggregatedSummary;
  aes:         BrandAggregatedSummary;
  slim:        BrandAggregatedSummary;
  hq:          BrandAggregatedSummary;
  anyFallback: boolean;
  warnings:    string[];
}

const EMPTY_SUMMARY: BrandAggregatedSummary = {
  revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0,
  ebitda: 0, ebitdaPct: 0, hasFallback: false,
};

export function useEbitdaAggregated(dateFrom: Date, dateTo: Date): UseEbitdaAggregatedResult {
  const df = toIso(dateFrom);
  const dt = toIso(dateTo);

  const q = useQuery<EbitdaAggregatedResponse>({
    queryKey: ["ebitda-aggregated", df, dt],
    queryFn: async () => {
      const res = await fetch(
        `/api/finance/ebitda-aggregated?date_from=${df}&date_to=${dt}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(body || `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const totals = q.data?.totals;
  return {
    data:        q.data,
    isLoading:   q.isLoading,
    isFetching:  q.isFetching,
    error:       (q.error as Error | null) ?? null,
    spa:         totals ? brandSummaryFromTotals(totals, "SPA")  : EMPTY_SUMMARY,
    aes:         totals ? brandSummaryFromTotals(totals, "AES")  : EMPTY_SUMMARY,
    slim:        totals ? brandSummaryFromTotals(totals, "SLIM") : EMPTY_SUMMARY,
    hq:          totals ? brandSummaryFromTotals(totals, "HQ")   : EMPTY_SUMMARY,
    anyFallback: q.data
      ? q.data.brands.some(b => brandHasFallback(totals?.[b]))
      : false,
    warnings:    q.data?.warnings ?? [],
  };
}
