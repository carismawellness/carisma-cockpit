"use client";

import { Card } from "@/components/ui/card";
import { useCrmAgents } from "@/lib/hooks/useCrmAgents";
import { AGENT_META_BY_SLUG } from "@/lib/constants/agents";
import { chartColors, formatCurrency, formatPercent } from "@/lib/charts/config";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Dummy data                                                         */
/* ------------------------------------------------------------------ */

interface RepRow {
  name: string;
  brandSlug: string;
  avgDaily: number;
  salesPerBooking: number;
  conversionPct: number;
  depositPct: number;
  missedPct: number;
  totalSales: number;
  totalBookings: number;
}

const DUMMY_REPS: RepRow[] = [
  { name: "Maria V.", brandSlug: "aesthetics", avgDaily: 891, salesPerBooking: 297, conversionPct: 34.2, depositPct: 78.5, missedPct: 8.2, totalSales: 12480, totalBookings: 42 },
  { name: "Katrina B.", brandSlug: "slimming", avgDaily: 782, salesPerBooking: 288, conversionPct: 31.5, depositPct: 72.1, missedPct: 10.4, totalSales: 10950, totalBookings: 38 },
  { name: "Sarah C.", brandSlug: "spa", avgDaily: 705, salesPerBooking: 282, conversionPct: 28.9, depositPct: 75.3, missedPct: 5.1, totalSales: 9870, totalBookings: 35 },
  { name: "Anna G.", brandSlug: "aesthetics", avgDaily: 617, salesPerBooking: 279, conversionPct: 26.1, depositPct: 69.8, missedPct: 11.7, totalSales: 8640, totalBookings: 31 },
  { name: "Elena F.", brandSlug: "slimming", avgDaily: 559, salesPerBooking: 279, conversionPct: 24.8, depositPct: 81.2, missedPct: 6.3, totalSales: 7820, totalBookings: 28 },
  { name: "Julia Z.", brandSlug: "spa", avgDaily: 496, salesPerBooking: 278, conversionPct: 22.3, depositPct: 66.4, missedPct: 14.8, totalSales: 6950, totalBookings: 25 },
  { name: "Lisa G.", brandSlug: "aesthetics", avgDaily: 443, salesPerBooking: 282, conversionPct: 20.7, depositPct: 73.6, missedPct: 7.5, totalSales: 6210, totalBookings: 22 },
  { name: "Diane A.", brandSlug: "slimming", avgDaily: 391, salesPerBooking: 288, conversionPct: 19.2, depositPct: 64.1, missedPct: 16.2, totalSales: 5480, totalBookings: 19 },
  { name: "Nicole M.", brandSlug: "spa", avgDaily: 337, salesPerBooking: 278, conversionPct: 17.4, depositPct: 71.9, missedPct: 9.8, totalSales: 4720, totalBookings: 17 },
  { name: "Claire S.", brandSlug: "aesthetics", avgDaily: 278, salesPerBooking: 278, conversionPct: 15.8, depositPct: 58.3, missedPct: 18.5, totalSales: 3890, totalBookings: 14 },
];

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4" style={{ color: entry.color }}>
          <span>{entry.name}</span>
          <span className="font-semibold">
            {entry.name.includes("%")
              ? formatPercent(entry.value)
              : formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function RepLeaderboard({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { agents, isLoading } = useCrmAgents(dateFrom, dateTo);

  if (isLoading) {
    return (
      <div className="h-96 rounded-xl bg-gray-100 animate-pulse" />
    );
  }

  const realData: RepRow[] = agents
    .map((a) => {
      const meta = AGENT_META_BY_SLUG[a.slug];
      const brandSlug = meta?.brand.toLowerCase() ?? "spa";
      const days = a.totals.active_days || 1;
      return {
        name: a.name,
        brandSlug,
        avgDaily: Math.round(a.totals.total_sales / days),
        salesPerBooking: a.totals.total_bookings > 0
          ? Math.round(a.totals.total_sales / a.totals.total_bookings)
          : 0,
        conversionPct: a.totals.avg_conversion_rate,
        depositPct: a.totals.avg_deposit_pct,
        missedPct: 0,
        totalSales: a.totals.total_sales,
        totalBookings: a.totals.total_bookings,
      };
    })
    .filter((r) => !brandFilter || r.brandSlug === brandFilter)
    .filter((r) => r.totalSales > 0)
    .sort((a, b) => b.totalSales - a.totalSales);

  const hasRealData = realData.length > 0;
  const repData = hasRealData
    ? realData
    : brandFilter
    ? DUMMY_REPS.filter((r) => r.brandSlug === brandFilter)
    : DUMMY_REPS;

  // Chart data — sorted by total sales desc.
  // `_salesTotal` is the stacked-bar topmost label target (Avg Daily + Sales/Booking).
  const chartData = repData.map((r) => ({
    name: r.name,
    "Avg Daily": r.avgDaily,
    "Sales/Booking": r.salesPerBooking,
    "Conv %": Number(r.conversionPct.toFixed(1)),
    "Deposit %": Number(r.depositPct.toFixed(1)),
    "Missed %": Number(r.missedPct.toFixed(1)),
    _salesTotal: r.avgDaily + r.salesPerBooking,
  }));

  return (
    <div className="space-y-6 relative">
      {!hasRealData && (
        <div className="absolute top-0 right-0 text-[10px] uppercase tracking-wider text-text-secondary bg-gray-100 px-1.5 py-0.5 rounded z-10">
          sample data
        </div>
      )}

      {/* Combo chart: bars for sales metrics, lines for percentages */}
      <Card className="p-3 md:p-6">
        <h3 className="text-base font-semibold text-foreground mb-4">
          Rep Performance Overview
        </h3>
        <div className="h-[300px] md:h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 24, right: 20, left: 0, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11 }}
              angle={-35}
              textAnchor="end"
              height={60}
            />
            {/* Left Y axis — EUR for sales bars */}
            <YAxis
              yAxisId="sales"
              orientation="left"
              tickFormatter={(v) => `€${v}`}
              tick={{ fontSize: 11 }}
              label={{ value: "EUR", angle: -90, position: "insideLeft", style: { fontSize: 10 } }}
            />
            {/* Right Y axis — % for rate lines */}
            <YAxis
              yAxisId="pct"
              orientation="right"
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 11 }}
              domain={[0, 100]}
              label={{ value: "%", angle: 90, position: "insideRight", style: { fontSize: 10 } }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: 12 }} />

            {/* Bars — stacked sales metrics. Topmost carries the total label. */}
            <Bar
              yAxisId="sales"
              dataKey="Avg Daily"
              name="Avg Daily"
              fill={chartColors.spa}
              stackId="sales"
              radius={[0, 0, 0, 0]}
              barSize={28}
            />
            <Bar
              yAxisId="sales"
              dataKey="Sales/Booking"
              name="Sales/Booking"
              fill={chartColors.aesthetics}
              stackId="sales"
              radius={[4, 4, 0, 0]}
              barSize={28}
            >
              <LabelList
                dataKey="_salesTotal"
                position="top"
                formatter={(v: unknown) => formatCurrency(Number(v))}
                style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
              />
            </Bar>

            {/* Lines — percentage metrics */}
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="Conv %"
              name="Conv %"
              stroke="#16A34A"
              strokeWidth={2}
              dot={{ r: 4, fill: "#16A34A" }}
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="Deposit %"
              name="Deposit %"
              stroke={chartColors.spa}
              strokeWidth={2}
              dot={{ r: 4, fill: chartColors.spa }}
              strokeDasharray="5 3"
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="Missed %"
              name="Missed %"
              stroke={chartColors.target}
              strokeWidth={2}
              dot={{ r: 4, fill: chartColors.target }}
              strokeDasharray="3 3"
            />
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
