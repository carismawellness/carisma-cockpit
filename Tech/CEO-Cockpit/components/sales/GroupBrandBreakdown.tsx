// components/sales/GroupBrandBreakdown.tsx
"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import type { GroupPeriod, GroupLocationRow } from "@/lib/hooks/useGroupRevenue";

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

function yoyBadge(curr: number, ly: number) {
  if (!ly) return null;
  const pct = ((curr - ly) / ly) * 100;
  const sign = pct >= 0 ? "+" : "";
  const cls = pct >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50";
  return (
    <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${cls}`}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

interface Props {
  period:       GroupPeriod;
  ly:           GroupPeriod;
  spaLocations: GroupLocationRow[];
  isFetching:   boolean;
}

export function GroupBrandBreakdown({ period, ly, spaLocations, isFetching }: Props) {
  const [view, setView] = useState<"brand" | "location">("brand");

  const brandData = useMemo(() => [
    { name: "Spa",        revenue: period.spa,        color: BRAND_COLORS.spa },
    { name: "Aesthetics", revenue: period.aesthetics, color: BRAND_COLORS.aesthetics },
    { name: "Slimming",   revenue: period.slimming,   color: BRAND_COLORS.slimming },
  ], [period]);

  const locationData = useMemo(() => [
    ...spaLocations.map((l) => ({ name: l.name, revenue: l.revenue, color: l.color })),
    { name: "Aesthetics", revenue: period.aesthetics, color: BRAND_COLORS.aesthetics },
    { name: "Slimming",   revenue: period.slimming,   color: BRAND_COLORS.slimming },
  ], [spaLocations, period]);

  const chartData = view === "brand" ? brandData : locationData;

  const tableRows = [
    { label: "Spa",         curr: period.spa,        ly_val: ly.spa        },
    { label: "Aesthetics",  curr: period.aesthetics, ly_val: ly.aesthetics },
    { label: "Slimming",    curr: period.slimming,   ly_val: ly.slimming   },
    { label: "Group Total", curr: period.total,      ly_val: ly.total, isBold: true },
  ];

  if (isFetching) {
    return (
      <Card className="p-6 h-48 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading brand breakdown…
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Revenue by Brand</h3>
        <Tabs value={view} onValueChange={(v) => setView(v as "brand" | "location")}>
          <TabsList className="h-7">
            <TabsTrigger value="brand"    className="text-xs px-3 h-6">By Brand</TabsTrigger>
            <TabsTrigger value="location" className="text-xs px-3 h-6">By Location</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="h-[220px] md:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: view === "location" ? 32 : 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              angle={view === "location" ? -30 : 0}
              textAnchor={view === "location" ? "end" : "middle"}
              interval={0}
            />
            <YAxis tickFormatter={(v) => fmtK(v)} tick={{ fontSize: 11 }} width={56} />
            <Tooltip formatter={(v: unknown) => fmtK(Number(v))} />
            <Bar dataKey="revenue" barSize={view === "location" ? 28 : 48} radius={[3, 3, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left py-1.5 pr-4 font-medium">Brand</th>
              <th className="text-right py-1.5 px-4 font-medium">This Period</th>
              <th className="text-right py-1.5 px-4 font-medium">Same Period LY</th>
              <th className="text-right py-1.5 pl-4 font-medium">vs LY</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr
                key={row.label}
                className={`border-b last:border-0 ${row.isBold ? "font-semibold bg-muted/30" : ""}`}
              >
                <td className="py-2 pr-4">{row.label}</td>
                <td className="py-2 px-4 text-right tabular-nums">{fmtK(row.curr)}</td>
                <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">{fmtK(row.ly_val)}</td>
                <td className="py-2 pl-4 text-right">{yoyBadge(row.curr, row.ly_val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
