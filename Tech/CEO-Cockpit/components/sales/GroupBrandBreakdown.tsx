// components/sales/GroupBrandBreakdown.tsx
"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GroupPeriod, GroupLocationRow } from "@/lib/hooks/useGroupRevenue";
import { BRAND } from "@/lib/constants/design-tokens";
import { SPA_LOCATION_COLOR_BY_NAME, SPA_LOCATION_FALLBACK_COLOR } from "@/lib/constants/spa-locations";

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

type Row = {
  name:    string;
  current: number;
  ly:      number;       // 0 when LY unavailable (Spa locations); LY bar will be hidden via hasLy
  dark:    string;
  soft:    string;
  hasLy:   boolean;
};

export function GroupBrandBreakdown({ period, ly, spaLocations, isFetching }: Props) {
  const [spaExpanded, setSpaExpanded] = useState(false);

  // Build the chart rows. Collapsed: 3 brand rows. Expanded: 8 Spa hotels + Aes + Slim.
  // Aes & Slim always carry LY; Spa locations don't (API returns LY only at brand level).
  const chartData = useMemo<Row[]>(() => {
    if (!spaExpanded) {
      return [
        { name: "Spa",        current: period.spa,        ly: ly.spa,         dark: BRAND.spa.dark,         soft: BRAND.spa.soft,        hasLy: true },
        { name: "Aesthetics", current: period.aesthetics, ly: ly.aesthetics,  dark: BRAND.aesthetics.dark,  soft: BRAND.aesthetics.soft, hasLy: true },
        { name: "Slimming",   current: period.slimming,   ly: ly.slimming,    dark: BRAND.slimming.dark,    soft: BRAND.slimming.soft,   hasLy: true },
      ];
    }
    return [
      ...spaLocations.map<Row>((l) => ({
        name:    l.name,
        current: l.revenue,
        ly:      0,
        dark:    SPA_LOCATION_COLOR_BY_NAME[l.name] ?? SPA_LOCATION_FALLBACK_COLOR,
        soft:    BRAND.spa.soft,
        hasLy:   false,
      })),
      { name: "Aesthetics", current: period.aesthetics, ly: ly.aesthetics, dark: BRAND.aesthetics.dark, soft: BRAND.aesthetics.soft, hasLy: true },
      { name: "Slimming",   current: period.slimming,   ly: ly.slimming,   dark: BRAND.slimming.dark,   soft: BRAND.slimming.soft,   hasLy: true },
    ];
  }, [spaExpanded, period, ly, spaLocations]);

  const isWide = chartData.length > 5;

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
        <button
          type="button"
          onClick={() => setSpaExpanded((v) => !v)}
          aria-expanded={spaExpanded}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
        >
          {spaExpanded ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Collapse Spa
            </>
          ) : (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              Expand Spa ({spaLocations.length} locations)
            </>
          )}
        </button>
      </div>

      {/* Chart */}
      <div className={isWide ? "h-[380px] md:h-[460px]" : "h-[320px] md:h-[400px]"}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 48, right: 16, left: 16, bottom: isWide ? 40 : 8 }}
            barCategoryGap={isWide ? "12%" : "22%"}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: isWide ? 11 : 13, fill: "#374151", fontWeight: 500 }}
              angle={isWide ? -28 : 0}
              textAnchor={isWide ? "end" : "middle"}
              interval={0}
              tickMargin={isWide ? 8 : 4}
            />
            <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={64} />
            <Tooltip
              formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
            />
            {/* LY companion bar — only rendered in collapsed (3-brand) view. In
                expanded mode Spa locations have no LY data anyway, and keeping
                a zero-height LY bar around just steals half of every column's
                width and makes the current bars look skinny. */}
            {!isWide && (
              <Bar
                dataKey={(d: Row) => (d.hasLy ? d.ly : 0)}
                name="Same Period LY"
                barSize={84}
                radius={[4, 4, 0, 0]}
              >
                {chartData.map((d, i) => (
                  <Cell key={`ly-${i}`} fill={d.hasLy ? d.soft : "transparent"} />
                ))}
                <LabelList
                  content={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                    const i = props.index ?? -1;
                    if (i < 0) return null;
                    const row = chartData[i];
                    if (!row || !row.hasLy || row.ly <= 0) return null;
                    const x = Number(props.x ?? 0);
                    const y = Number(props.y ?? 0);
                    const w = Number(props.width ?? 0);
                    return (
                      <text
                        x={x + w / 2}
                        y={y - 5}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="500"
                        fill="#9ca3af"
                      >
                        {fmtK(row.ly)}
                      </text>
                    );
                  }}
                />
              </Bar>
            )}
            {/* Current bar — soft brand color, with value + YoY label on top */}
            <Bar dataKey="current" name="This Period" barSize={isWide ? 80 : 84} radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => <Cell key={`cur-${i}`} fill={d.soft} />)}
              <LabelList
                content={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                  const i = props.index ?? -1;
                  if (i < 0) return null;
                  const row = chartData[i];
                  if (!row) return null;
                  const x = Number(props.x ?? 0);
                  const y = Number(props.y ?? 0);
                  const w = Number(props.width ?? 0);
                  const cx = x + w / 2;
                  const valueTxt = fmtK(row.current);
                  const pctTxt = row.hasLy ? fmtPct(row.current, row.ly) : null;
                  const positive = row.current - row.ly >= 0;
                  return (
                    <g>
                      <text
                        x={cx}
                        y={pctTxt ? y - 22 : y - 8}
                        textAnchor="middle"
                        fontSize={isWide ? "11" : "13"}
                        fontWeight="700"
                        fill="#111827"
                      >
                        {valueTxt}
                      </text>
                      {pctTxt && (
                        <text
                          x={cx}
                          y={y - 7}
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
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BRAND.spa.soft }} />
          <span>This Period</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "#9CA3AF" }} />
          <span>Same Period Last Year</span>
        </div>
        {spaExpanded && (
          <span className="text-muted-foreground/80">
            · LY not available per Spa location (only at brand level)
          </span>
        )}
      </div>
    </Card>
  );
}
