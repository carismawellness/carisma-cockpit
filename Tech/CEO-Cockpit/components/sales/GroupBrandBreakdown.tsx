// components/sales/GroupBrandBreakdown.tsx
"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";
import type { GroupPeriod, GroupLocationRow } from "@/lib/hooks/useGroupRevenue";

// Canonical Carisma brand palette
const BRAND = {
  spa:        { dark: "#8C7A5A", soft: "#EFE7D7" },
  aesthetics: { dark: "#3B7676", soft: "#DEEBEB" },
  slimming:   { dark: "#3D6B3D", soft: "#C9D8C1" },
} as const;

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function fmtPct(curr: number, ly: number): string | null {
  if (!ly) return null;
  const pct = ((curr - ly) / ly) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

interface Props {
  period:       GroupPeriod;
  ly:           GroupPeriod;
  spaLocations: GroupLocationRow[];
  isFetching:   boolean;
}

export function GroupBrandBreakdown({ period, ly, spaLocations, isFetching }: Props) {
  const [view, setView] = useState<"brand" | "location">("brand");

  // Brand view — grouped bars: current + LY per brand
  const brandData = useMemo(() => [
    { name: "Spa",        current: period.spa,        ly: ly.spa,         dark: BRAND.spa.dark,         soft: BRAND.spa.soft         },
    { name: "Aesthetics", current: period.aesthetics, ly: ly.aesthetics,  dark: BRAND.aesthetics.dark,  soft: BRAND.aesthetics.soft  },
    { name: "Slimming",   current: period.slimming,   ly: ly.slimming,    dark: BRAND.slimming.dark,    soft: BRAND.slimming.soft    },
  ], [period, ly]);

  // Location view — single bars (LY not available per Spa location)
  const locationData = useMemo(() => [
    ...spaLocations.map((l) => ({ name: l.name, current: l.revenue, dark: BRAND.spa.dark })),
    { name: "Aesthetics", current: period.aesthetics, dark: BRAND.aesthetics.dark },
    { name: "Slimming",   current: period.slimming,   dark: BRAND.slimming.dark },
  ], [spaLocations, period]);

  const groupYoY = fmtPct(period.total, ly.total);
  const groupYoYPositive = (period.total - ly.total) >= 0;

  if (isFetching) {
    return (
      <Card className="p-6 h-48 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading brand breakdown…
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-6 space-y-4">
      {/* Header with group total callout + tabs */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">Revenue by Brand</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tabular-nums">{fmtK(period.total)}</span>
            <span className="text-xs text-muted-foreground">vs {fmtK(ly.total)} LY</span>
            {groupYoY && (
              <span
                className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                  groupYoYPositive ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
                }`}
              >
                {groupYoY}
              </span>
            )}
          </div>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "brand" | "location")}>
          <TabsList className="h-7">
            <TabsTrigger value="brand"    className="text-xs px-3 h-6">By Brand</TabsTrigger>
            <TabsTrigger value="location" className="text-xs px-3 h-6">By Location</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Chart */}
      <div className="h-[240px] md:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          {view === "brand" ? (
            <BarChart
              data={brandData}
              margin={{ top: 40, right: 8, left: 8, bottom: 4 }}
              barCategoryGap="25%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
              <Tooltip
                formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              {/* LY bar — soft brand color (rendered first, sits to the left in the group) */}
              <Bar dataKey="ly" name="Same Period LY" barSize={28} radius={[3, 3, 0, 0]}>
                {brandData.map((d, i) => <Cell key={`ly-${i}`} fill={d.soft} />)}
                <LabelList
                  dataKey="ly"
                  position="top"
                  formatter={(v: unknown) => fmtK(Number(v))}
                  style={{ fontSize: 10, fontWeight: 500, fill: "#9ca3af" }}
                />
              </Bar>
              {/* Current bar — dark brand color, with value + YoY label on top */}
              <Bar dataKey="current" name="This Period" barSize={28} radius={[3, 3, 0, 0]}>
                {brandData.map((d, i) => <Cell key={`cur-${i}`} fill={d.dark} />)}
                <LabelList
                  dataKey="current"
                  position="top"
                  content={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                    const i = props.index ?? 0;
                    const row = brandData[i];
                    if (!row) return null;
                    const x = Number(props.x ?? 0);
                    const y = Number(props.y ?? 0);
                    const w = Number(props.width ?? 0);
                    const cx = x + w / 2;
                    const valueTxt = fmtK(row.current);
                    const pctTxt = fmtPct(row.current, row.ly);
                    const positive = row.current - row.ly >= 0;
                    return (
                      <g>
                        <text
                          x={cx}
                          y={y - 20}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          fill="#111827"
                        >
                          {valueTxt}
                        </text>
                        {pctTxt && (
                          <text
                            x={cx}
                            y={y - 6}
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight="600"
                            fill={positive ? "#047857" : "#dc2626"}
                          >
                            {pctTxt}
                          </text>
                        )}
                      </g>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          ) : (
            <BarChart
              data={locationData}
              margin={{ top: 20, right: 8, left: 8, bottom: 32 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#374151" }}
                angle={-30}
                textAnchor="end"
                interval={0}
              />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
              <Tooltip formatter={(v: unknown) => fmtK(Number(v))} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar dataKey="current" name="Revenue" barSize={28} radius={[3, 3, 0, 0]}>
                {locationData.map((d, i) => <Cell key={i} fill={d.dark} />)}
                <LabelList
                  dataKey="current"
                  position="top"
                  formatter={(v: unknown) => fmtK(Number(v))}
                  style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Compact legend for "By Brand" view */}
      {view === "brand" && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BRAND.spa.dark }} />
            <span>This Period</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BRAND.spa.soft }} />
            <span>Same Period Last Year</span>
          </div>
        </div>
      )}
    </Card>
  );
}
