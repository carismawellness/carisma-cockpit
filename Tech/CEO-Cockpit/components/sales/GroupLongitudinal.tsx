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
import type { GroupMonthlyPoint } from "@/lib/hooks/useGroupRevenue";

// Canonical Carisma brand palette
const BRAND = {
  spa:        { dark: "#8C7A5A", soft: "#EFE7D7" },
  aesthetics: { dark: "#3B7676", soft: "#DEEBEB" },
  slimming:   { dark: "#3D6B3D", soft: "#C9D8C1" },
} as const;

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

  const chartData = monthly.map((p) => ({
    label:         monthLabel(p.month),
    spa:           p.spa,
    aesthetics:    p.aesthetics,
    slimming:      p.slimming,
    spa_ly:        p.spa_ly,
    aesthetics_ly: p.aesthetics_ly,
    slimming_ly:   p.slimming_ly,
    total:         p.total,
    total_ly:      p.total_ly,
  }));

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
        <Tabs value={view} onValueChange={(v) => setView(v as "bars" | "lines")}>
          <TabsList className="h-7">
            <TabsTrigger value="bars"  className="text-xs px-3 h-6">Monthly Bars</TabsTrigger>
            <TabsTrigger value="lines" className="text-xs px-3 h-6">Trend Lines</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="h-[280px] md:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          {view === "bars" ? (
            <ComposedChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
              <Tooltip
                formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="spa"        name="Spa"        stackId="a" fill={BRAND.spa.dark}        />
              <Bar dataKey="aesthetics" name="Aesthetics" stackId="a" fill={BRAND.aesthetics.dark} />
              <Bar dataKey="slimming"   name="Slimming"   stackId="a" fill={BRAND.slimming.dark}   radius={[3, 3, 0, 0]}>
                {/* Total label sits above the topmost stacked segment */}
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={(v: unknown) => fmtK(Number(v))}
                  style={{ fontSize: 9, fontWeight: 600, fill: "#111827" }}
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
      </p>
    </Card>
  );
}
