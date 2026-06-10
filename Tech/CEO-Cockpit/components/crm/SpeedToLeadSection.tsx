"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { formatMinutes } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";

// Canonical brand palette — `dark` for left-border accents.
const BRAND_BORDER: Record<string, string> = {
  spa:        BRAND.spa.dark,
  aesthetics: BRAND.aesthetics.dark,
  slimming:   BRAND.slimming.dark,
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CrmDailyRow {
  date: string;
  brand_id: number;
  speed_to_lead_median_min: number | null;
  speed_to_lead_mean_min: number | null;
  total_leads: number | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BUCKET_ORDER = ["<1min", "1-3min", "3-5min", "5-15min", "15-30min", "30min+"];
const BUCKET_COLORS = ["#16A34A", "#22C55E", "#86EFAC", "#FDE047", "#FB923C", "#DC2626"];
const STL_TARGET_MIN = 5;

const TIME_PRESETS = [
  { label: "All Hours", from: 0, to: 24 },
  { label: "Business Hours (8-18)", from: 8, to: 18 },
  { label: "Morning (8-12)", from: 8, to: 12 },
  { label: "Afternoon (12-18)", from: 12, to: 18 },
  { label: "Extended (7-20)", from: 7, to: 20 },
];

const BRANDS = ["spa", "aesthetics", "slimming"] as const;
const BRAND_LABELS: Record<string, string> = { spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming" };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function calcMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stlColor(minutes: number): string {
  if (minutes <= 0) return "text-muted-foreground";
  if (minutes <= 3) return "text-emerald-600";
  if (minutes <= 5) return "text-emerald-500";
  if (minutes <= 10) return "text-amber-500";
  if (minutes <= 15) return "text-orange-500";
  return "text-red-600";
}

function stlGrade(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes <= 1) return "A+";
  if (minutes <= 3) return "A";
  if (minutes <= 5) return "B";
  if (minutes <= 10) return "C";
  if (minutes <= 15) return "D";
  return "F";
}

function gradeColor(g: string): string {
  const colors: Record<string, string> = {
    "A+": "bg-emerald-100 text-emerald-800",
    A: "bg-emerald-100 text-emerald-700",
    B: "bg-green-100 text-green-700",
    C: "bg-amber-100 text-amber-700",
    D: "bg-orange-100 text-orange-700",
    F: "bg-red-100 text-red-700",
    "—": "bg-gray-100 text-gray-400",
  };
  return colors[g] ?? "bg-gray-100 text-gray-500";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SpeedToLeadSection({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const [businessHoursFrom, setBusinessHoursFrom] = useState(8);
  const [businessHoursTo, setBusinessHoursTo] = useState(18);
  const [activePreset, setActivePreset] = useState("Business Hours (8-18)");
  const [showTimeFilter, setShowTimeFilter] = useState(false);

  const { brandMap } = useLookups();

  const { data: crmDaily, loading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  const visibleBrands = brandFilter ? BRANDS.filter((b) => b === brandFilter) : [...BRANDS];

  const brandData = useMemo(() => {
    return visibleBrands.map((slug) => {
      const bid = brandMap[slug];
      const brandRows = crmDaily.filter((r) => r.brand_id === bid);
      const meds = brandRows
        .map((r) => r.speed_to_lead_median_min)
        .filter((v): v is number => v !== null && v > 0);
      const means = brandRows
        .map((r) => r.speed_to_lead_mean_min)
        .filter((v): v is number => v !== null && v > 0);
      const median = calcMedian(meds);
      const mean = calcMean(means);
      const totalLeads = brandRows.reduce((s, r) => s + (r.total_leads ?? 0), 0);
      return { slug, median, mean, totalLeads, grade: stlGrade(median) };
    });
  }, [crmDaily, brandMap, visibleBrands]);

  const hasData = brandData.some((b) => b.median > 0);

  if (loading) {
    return <div className="h-32 rounded-xl bg-gray-100 animate-pulse" />;
  }

  return (
    <>
      {/* Speed to Lead by Brand */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-foreground">Speed to Lead by Brand</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTimeFilter(!showTimeFilter)}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border hover:bg-muted transition-colors"
            >
              <Clock className="h-3 w-3" />
              {businessHoursFrom}:00–{businessHoursTo}:00
              {showTimeFilter ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Median response time per brand — target: under {STL_TARGET_MIN}min
        </p>

        {showTimeFilter && (
          <div className="mb-5 p-3 bg-gray-50 rounded-lg border">
            <div className="flex flex-wrap gap-2 mb-3">
              {TIME_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => { setBusinessHoursFrom(preset.from); setBusinessHoursTo(preset.to); setActivePreset(preset.label); }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    activePreset === preset.label ? "bg-foreground text-white border-foreground" : "bg-white text-foreground border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasData ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
            <p className="text-sm font-medium">Speed-to-lead data not yet available</p>
            <p className="text-xs max-w-sm">
              This metric requires first-response timestamps from GHL conversations.
              The ETL does not yet collect this field — it will appear here once wired.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {brandData.map((b) => (
              <div
                key={b.slug}
                className="p-4 rounded-xl border-l-4"
                style={{ borderLeftColor: BRAND_BORDER[b.slug] ?? "#888" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
                    {BRAND_LABELS[b.slug]}
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${gradeColor(b.grade)}`}>{b.grade}</span>
                </div>

                <div className="text-center mb-3">
                  <p className={`text-3xl font-black ${stlColor(b.median)}`}>
                    {b.median > 0 ? formatMinutes(b.median) : "—"}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Median</p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Mean</p>
                    <p className={`text-sm font-bold ${stlColor(b.mean)}`}>
                      {b.mean > 0 ? formatMinutes(b.mean) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">&lt;5min</p>
                    <p className="text-sm font-bold text-muted-foreground">—</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Leads</p>
                    <p className="text-sm font-bold text-foreground">{b.totalLeads}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-center text-[10px] text-text-secondary flex-wrap mt-3">
          {BUCKET_ORDER.map((b, i) => (
            <div key={b} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BUCKET_COLORS[i] }} />
              <span>{b}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Speed to Lead by Rep — not yet available */}
      <Card className="p-4 md:p-5">
        <h3 className="text-base font-semibold text-foreground mb-1">Speed to Lead by Rep</h3>
        <p className="text-xs text-muted-foreground mb-4">Per-rep median response time</p>
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-2">
          <p className="text-sm font-medium">Per-rep STL data not yet available</p>
          <p className="text-xs max-w-sm">
            Individual rep response timestamps are not yet tracked by the ETL.
            This section will be populated once rep-level GHL conversation data is collected.
          </p>
        </div>
      </Card>
    </>
  );
}
