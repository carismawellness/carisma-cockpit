"use client";

import { useQuery } from "@tanstack/react-query";

// Shape of /api/finance/ebitda-aggregated. Mirrors the route's response.
type Brand = "SPA" | "AES" | "SLIM" | "HQ";

export interface CategoryCell {
  value:                  number;
  has_fallback:           boolean;
  fallback_account_count: number;
}

export interface LineItem {
  brand:           Brand;
  zoho_org:        "spa" | "aesthetics";
  account_code:    string;
  account_name:    string;
  ebitda_category: string;
  venue:           string;
  contact:         string;
  allocation:      string;
  literal_sum:     number;
  period_value:    number;
  used_fallback:   boolean;
  rule_type:       string | null;
  method_detail:   string | null;
}

export interface EbitdaAggregatedResponse {
  date_from:        string;
  date_to:          string;
  days_in_period:   number;
  brands:           Brand[];
  categories:       string[];
  totals:           Record<Brand, Record<string, CategoryCell>>;
  venue_totals:     Record<Brand, Record<string, Record<string, CategoryCell>>>;
  fallback_applied: Array<{
    brand:         Brand;
    account_code:  string;
    account_name:  string;
    rule_type:     string;
    period_value:  number;
    method_detail: string;
  }>;
  line_items:       LineItem[];
  warnings: string[];
}

export interface VenueAggregatedSummary extends BrandAggregatedSummary {
  venueKey: string;     // raw column-E value as keyed by the API ("" allowed)
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
  return categorySummaryFromCells(totals?.[brand]);
}

// Build a {revenue, ebitda, …} summary from an arbitrary category-cell map.
// Shared by per-brand and per-venue derivation so the sign and EBITDA
// arithmetic only lives in one place.
function categorySummaryFromCells(
  b: Record<string, CategoryCell> | undefined,
): BrandAggregatedSummary {
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

/**
 * Per-venue summaries under a brand. SPA returns one entry per venue.
 * AES/SLIM/HQ collapse every venue into a single summary keyed by the brand
 * label since the existing dashboard shows them as one dept-level row.
 */
export function venueSummariesForBrand(
  venueTotals: EbitdaAggregatedResponse["venue_totals"] | undefined,
  brand: Brand,
  collapse: boolean,
): VenueAggregatedSummary[] {
  const bucket = venueTotals?.[brand];
  if (!bucket) return [];

  if (collapse) {
    // Sum every venue's category map into one collapsed cell map.
    const merged: Record<string, CategoryCell> = {};
    for (const venueKey in bucket) {
      const cats = bucket[venueKey];
      for (const cat in cats) {
        const cell = merged[cat] ?? { value: 0, has_fallback: false, fallback_account_count: 0 };
        cell.value += cats[cat].value;
        if (cats[cat].has_fallback) {
          cell.has_fallback = true;
          cell.fallback_account_count += cats[cat].fallback_account_count;
        }
        merged[cat] = cell;
      }
    }
    return [{ venueKey: "", ...categorySummaryFromCells(merged) }];
  }

  // Per-venue rows; skip rows with no revenue AND no expenses (empty).
  return Object.keys(bucket).map(venueKey => ({
    venueKey,
    ...categorySummaryFromCells(bucket[venueKey]),
  })).filter(v => v.revenue !== 0 || v.cogs !== 0 || v.wages !== 0 || v.rent !== 0
                  || v.utilities !== 0 || v.sga !== 0 || v.advertising !== 0);
}

// Format a Date as YYYY-MM-DD using LOCAL components, not UTC.
// `Date.toISOString()` would convert to UTC, which for users east of GMT
// pushes midnight-local back to the previous day's UTC date (e.g. Malta
// UTC+1: Jan 1 00:00 local → Dec 31 23:00 UTC → "2024-12-31"). The API's
// partial-period guard then sees a non-month-aligned range and applies
// fallback smoothing that zeroes real wages/advertising totals.
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  // Per-venue breakdowns. SPA is split by venue; AES, SLIM, HQ are each
  // collapsed into a single summary (one row per brand in the dept-level
  // venue P&L table).
  spaVenues:   VenueAggregatedSummary[];
  aesRow:      VenueAggregatedSummary;
  slimRow:     VenueAggregatedSummary;
  hqRow:       VenueAggregatedSummary;
  // Raw audit-trail rows — every account that contributed to totals.
  // Drives the real (non-allocated) breakdown rows under SG&A etc.
  lineItems:   LineItem[];
  anyFallback: boolean;
  warnings:    string[];
}

const EMPTY_SUMMARY: BrandAggregatedSummary = {
  revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0,
  ebitda: 0, ebitdaPct: 0, hasFallback: false,
};

const EMPTY_VENUE_ROW: VenueAggregatedSummary = { venueKey: "", ...EMPTY_SUMMARY };

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

  const totals      = q.data?.totals;
  const venueTotals = q.data?.venue_totals;
  return {
    data:        q.data,
    isLoading:   q.isLoading,
    isFetching:  q.isFetching,
    error:       (q.error as Error | null) ?? null,
    spa:         totals ? brandSummaryFromTotals(totals, "SPA")  : EMPTY_SUMMARY,
    aes:         totals ? brandSummaryFromTotals(totals, "AES")  : EMPTY_SUMMARY,
    slim:        totals ? brandSummaryFromTotals(totals, "SLIM") : EMPTY_SUMMARY,
    hq:          totals ? brandSummaryFromTotals(totals, "HQ")   : EMPTY_SUMMARY,
    spaVenues:   venueSummariesForBrand(venueTotals, "SPA",  false),
    aesRow:      venueSummariesForBrand(venueTotals, "AES",  true)[0]  ?? EMPTY_VENUE_ROW,
    slimRow:     venueSummariesForBrand(venueTotals, "SLIM", true)[0]  ?? EMPTY_VENUE_ROW,
    hqRow:       venueSummariesForBrand(venueTotals, "HQ",   true)[0]  ?? EMPTY_VENUE_ROW,
    lineItems:   q.data?.line_items ?? [],
    anyFallback: q.data
      ? q.data.brands.some(b => brandHasFallback(totals?.[b]))
      : false,
    warnings:    q.data?.warnings ?? [],
  };
}
