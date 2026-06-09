"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { chartColors } from "@/lib/charts/config";

/* ------------------------------------------------------------------ */
/*  Mock hourly lead distribution data per brand                       */
/* ------------------------------------------------------------------ */

const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Realistic distribution: low overnight, ramps up 7-9am, peaks mid-morning,
// lunch dip, afternoon plateau, drops off after 6pm
const SPA_HOURLY = [0, 0, 0, 0, 0, 0, 1, 3, 8, 12, 14, 11, 7, 9, 10, 8, 6, 4, 2, 1, 1, 0, 0, 0];
const AES_HOURLY = [0, 0, 0, 0, 0, 0, 0, 2, 5, 9, 11, 13, 8, 10, 12, 10, 7, 5, 3, 2, 1, 1, 0, 0];
const SLIM_HOURLY = [0, 0, 0, 0, 0, 0, 0, 1, 3, 6, 8, 7, 5, 7, 8, 6, 4, 3, 2, 1, 1, 0, 0, 0];

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LeadsPerHour({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const chartData = useMemo(() => {
    return HOURS.map((h) => {
      const entry: Record<string, unknown> = { hour: formatHour(h) };
      if (!brandFilter || brandFilter === "spa") entry.spa = SPA_HOURLY[h];
      if (!brandFilter || brandFilter === "aesthetics") entry.aesthetics = AES_HOURLY[h];
      if (!brandFilter || brandFilter === "slimming") entry.slimming = SLIM_HOURLY[h];
      return entry;
    });
  }, [brandFilter]);

  const visibleBrands = brandFilter
    ? [brandFilter]
    : ["spa", "aesthetics", "slimming"];

  const brandLabels: Record<string, string> = {
    spa: "Spa",
    aesthetics: "Aesthetics",
    slimming: "Slimming",
  };

  // Peak hour per brand
  const peaks = useMemo(() => {
    const result: { brand: string; hour: number; count: number }[] = [];
    const datasets: Record<string, number[]> = { spa: SPA_HOURLY, aesthetics: AES_HOURLY, slimming: SLIM_HOURLY };
    for (const b of visibleBrands) {
      const data = datasets[b];
      if (!data) continue;
      let maxIdx = 0;
      for (let i = 1; i < data.length; i++) {
        if (data[i] > data[maxIdx]) maxIdx = i;
      }
      result.push({ brand: b, hour: maxIdx, count: data[maxIdx] });
    }
    return result;
  }, [visibleBrands]);

  // Business hours (8-18) vs outside
  const businessHoursStats = useMemo(() => {
    const datasets: Record<string, number[]> = { spa: SPA_HOURLY, aesthetics: AES_HOURLY, slimming: SLIM_HOURLY };
    const stats: { brand: string; businessPct: number; total: number }[] = [];
    for (const b of visibleBrands) {
      const data = datasets[b];
      if (!data) continue;
      const total = data.reduce((s, v) => s + v, 0);
      const businessTotal = data.slice(8, 18).reduce((s, v) => s + v, 0);
      stats.push({ brand: b, businessPct: total > 0 ? (businessTotal / total) * 100 : 0, total });
    }
    return stats;
  }, [visibleBrands]);

  return (
    <Card className="p-4 md:p-6 relative">
      <span className="absolute top-4 right-4 text-[10px] uppercase tracking-wider text-text-secondary bg-gray-100 px-1.5 py-0.5 rounded">
        sample
      </span>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">Leads per Hour</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Hourly lead volume distribution by brand</p>
      </div>

      {/* Chart */}
      <div className="h-[240px] md:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10 }}
              interval={1}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            {visibleBrands.map((b) => (
              <Bar
                key={b}
                dataKey={b}
                name={brandLabels[b] ?? b}
                fill={chartColors[b as keyof typeof chartColors] ?? "#888"}
                radius={[2, 2, 0, 0]}
                stackId="leads"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary row */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Peak hours */}
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Peak Hours</p>
          <div className="space-y-1.5">
            {peaks.map((p) => (
              <div key={p.brand} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: chartColors[p.brand as keyof typeof chartColors] ?? "#888" }}
                  />
                  <span className="font-medium text-gray-700">{brandLabels[p.brand]}</span>
                </span>
                <span className="font-semibold text-gray-900">{formatHour(p.hour)} ({p.count} leads)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Business hours concentration */}
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Business Hours (8am-6pm)</p>
          <div className="space-y-1.5">
            {businessHoursStats.map((s) => (
              <div key={s.brand} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: chartColors[s.brand as keyof typeof chartColors] ?? "#888" }}
                  />
                  <span className="font-medium text-gray-700">{brandLabels[s.brand]}</span>
                </span>
                <span className="font-semibold text-gray-900">{s.businessPct.toFixed(0)}% of {s.total} leads</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
