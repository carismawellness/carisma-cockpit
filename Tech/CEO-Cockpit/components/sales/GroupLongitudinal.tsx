// components/sales/GroupLongitudinal.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { GroupMonthlyPoint } from "@/lib/hooks/useGroupRevenue";

const BRAND_COLORS = {
  spa:        "#8C7A5A",
  aesthetics: "#6366f1",
  slimming:   "#3D6B3D",
} as const;

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
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: unknown) => fmtK(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="spa"        name="Spa"        stackId="a" fill={BRAND_COLORS.spa}        />
              <Bar dataKey="aesthetics" name="Aesthetics" stackId="a" fill={BRAND_COLORS.aesthetics} />
              <Bar dataKey="slimming"   name="Slimming"   stackId="a" fill={BRAND_COLORS.slimming}   radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v: unknown) => fmtK(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="spa"        name="Spa 26"        stroke={BRAND_COLORS.spa}        strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="aesthetics" name="Aesthetics 26" stroke={BRAND_COLORS.aesthetics} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="slimming"   name="Slimming 26"   stroke={BRAND_COLORS.slimming}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="spa_ly"        name="Spa 25"        stroke={BRAND_COLORS.spa}        strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="aesthetics_ly" name="Aesthetics 25" stroke={BRAND_COLORS.aesthetics} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="slimming_ly"   name="Slimming 25"   stroke={BRAND_COLORS.slimming}   strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">
        Rolling 13 months · Same period last year shown as dashed lines in Trend view
      </p>
    </Card>
  );
}
