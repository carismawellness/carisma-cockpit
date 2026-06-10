"use client";

import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { CrmDailyRow } from "@/lib/types/crm";
import {
  formatMinutes,
} from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";

// Canonical brand palette — `dark` for left-border accents.
const BRAND_BORDER: Record<string, string> = {
  spa:        BRAND.spa.dark,
  aesthetics: BRAND.aesthetics.dark,
  slimming:   BRAND.slimming.dark,
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BRANDS = [
  { slug: "spa", label: "Spa" },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "slimming", label: "Slimming" },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stlGrade(minutes: number): string {
  if (minutes <= 1) return "A+";
  if (minutes <= 3) return "A";
  if (minutes <= 5) return "B";
  if (minutes <= 10) return "C";
  if (minutes <= 15) return "D";
  return "F";
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A+":
    case "A":
      return "text-emerald-600";
    case "B":
      return "text-amber-500";
    case "C":
      return "text-orange-500";
    case "D":
    case "F":
      return "text-red-600";
    default:
      return "text-gray-500";
  }
}

function gradeBgColor(grade: string): string {
  switch (grade) {
    case "A+":
    case "A":
      return "bg-emerald-100 text-emerald-800";
    case "B":
      return "bg-amber-100 text-amber-700";
    case "C":
      return "bg-orange-100 text-orange-700";
    case "D":
    case "F":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-500";
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function STLByBrand({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { brandMap } = useLookups();

  const { data, loading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  if (loading) {
    return (
      <div className="animate-pulse text-text-secondary">Loading...</div>
    );
  }

  // Build brand_id -> slug lookup
  const brandIdToSlug: Record<number, string> = {};
  for (const [slug, id] of Object.entries(brandMap)) {
    brandIdToSlug[id] = slug;
  }

  // --- Per-brand computations ---
  const brandSummaries = BRANDS.map((brand) => {
    const bid = brandMap[brand.slug];
    const brandRows = data.filter((r) => r.brand_id === bid);
    const stlValues = brandRows
      .map((r) => r.speed_to_lead_median_min)
      .filter((v): v is number => v !== null && v > 0);
    const medianSTL = median(stlValues);
    const totalLeads = brandRows.reduce(
      (sum, r) => sum + (r.total_leads ?? 0),
      0
    );
    const under5Count = stlValues.filter((v) => v <= 5).length;
    const pctUnder5 =
      stlValues.length > 0 ? (under5Count / stlValues.length) * 100 : 0;
    const grade = medianSTL > 0 ? stlGrade(medianSTL) : "-";

    return {
      slug: brand.slug,
      label: brand.label,
      medianSTL,
      grade,
      totalLeads,
      pctUnder5,
    };
  });

  // Visible brands
  const visibleBrands = brandFilter
    ? brandSummaries.filter((b) => b.slug === brandFilter)
    : brandSummaries;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {visibleBrands.map((b) => (
        <Card
          key={b.slug}
          className="p-5 border-l-4"
          style={{
            borderLeftColor: BRAND_BORDER[b.slug] ?? "#888",
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
              {b.label}
            </h3>
            {b.grade !== "-" ? (
              <span
                className={`text-2xl font-bold px-3 py-1 rounded ${gradeBgColor(b.grade)}`}
              >
                {b.grade}
              </span>
            ) : (
              <span className="text-2xl font-bold text-gray-400">-</span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Median STL</span>
              <span
                className={`text-sm font-bold ${
                  b.medianSTL > 0 ? gradeColor(b.grade) : "text-gray-400"
                }`}
              >
                {b.medianSTL > 0 ? formatMinutes(b.medianSTL) : "-"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Total Leads</span>
              <span className="text-sm font-semibold text-foreground">
                {b.totalLeads.toLocaleString()}
              </span>
            </div>
            {/* Progress bar: % under 5 minutes */}
            <div className="mt-2">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-secondary">Under 5min</span>
                <span className="text-xs font-semibold text-foreground">
                  {b.pctUnder5.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(b.pctUnder5, 100)}%`,
                    backgroundColor:
                      b.pctUnder5 >= 80
                        ? "#16A34A"
                        : b.pctUnder5 >= 50
                        ? "#F59E0B"
                        : "#DC2626",
                  }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-text-secondary">0%</span>
                <span className="text-xs text-text-secondary">Target: 80%</span>
                <span className="text-xs text-text-secondary">100%</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
