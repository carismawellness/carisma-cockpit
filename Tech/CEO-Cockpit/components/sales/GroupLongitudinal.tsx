// components/sales/GroupLongitudinal.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ComposedChart, Bar, Line,
  LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GroupMonthlyPoint } from "@/lib/hooks/useGroupRevenue";

// Canonical Carisma brand palette
const BRAND = {
  spa:        { dark: "#8C7A5A", soft: "#EFE7D7" },
  aesthetics: { dark: "#3B7676", soft: "#DEEBEB" },
  slimming:   { dark: "#3D6B3D", soft: "#C9D8C1" },
} as const;

// 8 cream/taupe shades — same fixed assignment used by GroupBrandBreakdown so
// each hotel reads with the same identity across both charts.
const SPA_LOCATION_PALETTE: Record<string, string> = {
  Inter:     "#5C4D32",
  Hyatt:     "#6B5C42",
  Excelsior: "#7A6A4F",
  Ramla:     "#8C7A5A",
  Hugos:     "#9F8E6F",
  Riviera:   "#B2A186",
  Odycy:     "#C5B69D",
  Novotel:   "#D9CDB2",
};
// Render order = stack order (bottom → top). Darkest at the bottom of each column.
const SPA_HOTEL_ORDER = ["Inter", "Hyatt", "Excelsior", "Ramla", "Hugos", "Riviera", "Odycy", "Novotel"];

const LY_TOTAL_LINE = "#9CA3AF"; // neutral gray for LY trajectory overlay

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function monthLabel(m: string) {
  // YYYY-MM-01 → "Jan 25" style. Parse as UTC to avoid timezone shift.
  const [yearStr, monthStr] = m.split("-");
  const year  = Number(yearStr);
  const month = Number(monthStr) - 1;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

interface Props {
  monthly:    GroupMonthlyPoint[];
  isFetching: boolean;
}

export function GroupLongitudinal({ monthly, isFetching }: Props) {
  const [view, setView] = useState<"bars" | "lines">("bars");
  const [spaExpanded, setSpaExpanded] = useState(false);

  // Expand is meaningful only in Monthly Bars view AND only when per-location data is present.
  const hasLocationData = monthly.some((p) => p.spa_by_location && Object.keys(p.spa_by_location).length > 0);
  const expanded = spaExpanded && view === "bars" && hasLocationData;

  if (isFetching) {
    return (
      <Card className="p-6 h-64 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading trend data…
      </Card>
    );
  }

  if (!monthly.length) {
    return (
      <Card className="p-6 h-40 flex items-center justify-center text-sm text-muted-foreground">
        No longitudinal data available.
      </Card>
    );
  }

  const latest = monthly[monthly.length - 1];
  const yoyDelta = latest && latest.total_ly > 0
    ? ((latest.total - latest.total_ly) / latest.total_ly * 100)
    : null;

  // Derive year suffixes from the data so labels stay correct over time.
  const curYearTwo = monthly[monthly.length - 1].month.substring(2, 4); // "YY" of latest current month
  const lyYearTwo  = monthly[monthly.length - 1].ly_month.substring(2, 4);

  // Treat 0 LY (all three brands zero) as a data gap so the dashed line shows
  // a hole instead of a misleading flat-zero stretch. Months before our LY
  // backfill exists fall into this category.
  const nullIfEmpty = (v: number, ...others: number[]) => {
    const allZero = v === 0 && others.every((o) => o === 0);
    return allZero ? null : v;
  };

  const chartData = monthly.map((p) => {
    const byLoc = p.spa_by_location ?? {};
    const hotelFields: Record<string, number> = {};
    for (const name of SPA_HOTEL_ORDER) {
      hotelFields[`spa_${name}`] = byLoc[name] ?? 0;
    }
    return {
      label:         monthLabel(p.month),
      spa:           p.spa,
      aesthetics:    p.aesthetics,
      slimming:      p.slimming,
      spa_ly:        nullIfEmpty(p.spa_ly,        p.aesthetics_ly, p.slimming_ly),
      aesthetics_ly: nullIfEmpty(p.aesthetics_ly, p.spa_ly,        p.slimming_ly),
      slimming_ly:   nullIfEmpty(p.slimming_ly,   p.spa_ly,        p.aesthetics_ly),
      total:         p.total,
      total_ly:      (p.spa_ly + p.aesthetics_ly + p.slimming_ly) > 0 ? p.total_ly : null,
      ...hotelFields,
    };
  });

  // How many of the 13 months are missing LY data — surface as a footer note.
  const lyGapMonths = chartData.filter((d) => d.total_ly === null).length;

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Revenue Over Time</h3>
          {yoyDelta !== null && (
            <span
              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                yoyDelta >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
              }`}
            >
              Latest month: {yoyDelta >= 0 ? "+" : ""}{yoyDelta.toFixed(1)}% vs LY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {view === "bars" && hasLocationData && (
            <button
              type="button"
              onClick={() => setSpaExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Collapse Spa
                </>
              ) : (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  Expand Spa (8 hotels)
                </>
              )}
            </button>
          )}
          <Tabs value={view} onValueChange={(v) => setView(v as "bars" | "lines")}>
            <TabsList className="h-7">
              <TabsTrigger value="bars"  className="text-xs px-3 h-6">Monthly Bars</TabsTrigger>
              <TabsTrigger value="lines" className="text-xs px-3 h-6">Trend Lines</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className={expanded ? "h-[360px] md:h-[440px]" : "h-[320px] md:h-[400px]"}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "bars" ? (
            <ComposedChart
              data={chartData}
              margin={{ top: 24, right: 12, left: 12, bottom: 4 }}
              barCategoryGap="14%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={60} />
              <Tooltip
                formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {expanded ? (
                // 8 stacked Spa hotel segments (bottom of stack), darkest at the bottom
                SPA_HOTEL_ORDER.map((hotel) => (
                  <Bar
                    key={hotel}
                    dataKey={`spa_${hotel}`}
                    name={`Spa · ${hotel}`}
                    stackId="a"
                    fill={SPA_LOCATION_PALETTE[hotel]}
                  />
                ))
              ) : (
                <Bar dataKey="spa" name="Spa" stackId="a" fill={BRAND.spa.dark} />
              )}
              <Bar dataKey="aesthetics" name="Aesthetics" stackId="a" fill={BRAND.aesthetics.dark} />
              <Bar dataKey="slimming"   name="Slimming"   stackId="a" fill={BRAND.slimming.dark}   radius={[3, 3, 0, 0]}>
                {/* Custom label renderer — uses chartData[index].total so labels show even
                    when Slimming = 0 (Recharts skips default LabelList on zero-height segments). */}
                <LabelList
                  content={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                    const i = props.index ?? -1;
                    if (i < 0) return null;
                    const row = chartData[i];
                    if (!row || row.total <= 0) return null;
                    const x = Number(props.x ?? 0);
                    const y = Number(props.y ?? 0);
                    const w = Number(props.width ?? 0);
                    return (
                      <text
                        x={x + w / 2}
                        y={y - 6}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="600"
                        fill="#111827"
                      >
                        {fmtK(row.total)}
                      </text>
                    );
                  }}
                />
              </Bar>
              {/* LY total trajectory overlay — neutral gray dashed line */}
              <Line
                type="monotone"
                dataKey="total_ly"
                name="Total LY"
                stroke={LY_TOTAL_LINE}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 2.5, fill: LY_TOTAL_LINE, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
              <Tooltip
                formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="spa"        name={`Spa ${curYearTwo}`}        stroke={BRAND.spa.dark}        strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="aesthetics" name={`Aesthetics ${curYearTwo}`} stroke={BRAND.aesthetics.dark} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="slimming"   name={`Slimming ${curYearTwo}`}   stroke={BRAND.slimming.dark}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="spa_ly"        name={`Spa ${lyYearTwo}`}        stroke={BRAND.spa.dark}        strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="aesthetics_ly" name={`Aesthetics ${lyYearTwo}`} stroke={BRAND.aesthetics.dark} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="slimming_ly"   name={`Slimming ${lyYearTwo}`}   stroke={BRAND.slimming.dark}   strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">
        Rolling 13 months · Dashed gray line = total revenue last year, brand bars = current year
        {lyGapMonths > 0 && (
          <span className="ml-1 text-amber-700">
            · LY data unavailable for {lyGapMonths} month{lyGapMonths === 1 ? "" : "s"} (gap in the dashed line)
          </span>
        )}
      </p>
    </Card>
  );
}
