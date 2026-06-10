"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { chartDefaults } from "@/lib/charts/config";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { format } from "date-fns";

const LOCATION_COLORS: Record<string, string> = {
  Inter: "#1B3A4B",
  Hugos: "#96B2B2",
  Hyatt: "#B79E61",
  Ramla: "#E07A5F",
  Labranda: "#8EB093",
  Sunny: "#7C3AED",
  Excelsior: "#DC2626",
  Novotel: "#0EA5E9",
  Riviera: "#D946EF",
  Odycy: "#14B8A6",
};

interface TrendChartProps {
  standardType: string;
  locationFilter: string | null;
}

export function TrendChart({ standardType, locationFilter }: TrendChartProps) {
  const { data: rawData, isLoading } = useQuery({
    queryKey: ["brand_standards_trend", standardType],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("brand_standards")
        .select("month, location, result")
        .eq("standard_type", standardType)
        .order("month", { ascending: true });

      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading || !rawData) {
    return <div className="h-80 bg-warm-gray animate-pulse rounded-xl" />;
  }

  if (rawData.length === 0) return null;

  // Aggregate: per month + location → score %
  const agg = new Map<string, Map<string, { total: number; passed: number }>>();
  for (const row of rawData) {
    if (!agg.has(row.month)) agg.set(row.month, new Map());
    const monthMap = agg.get(row.month)!;
    if (!monthMap.has(row.location)) monthMap.set(row.location, { total: 0, passed: 0 });
    const entry = monthMap.get(row.location)!;
    entry.total++;
    if (row.result) entry.passed++;
  }

  const allLocations = [...new Set(rawData.map((r) => r.location))].sort();
  const filteredLocations = locationFilter
    ? allLocations.filter((l) => l === locationFilter)
    : allLocations;

  const chartData = [...agg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, locMap]) => {
      const row: Record<string, string | number> = {
        month: format(new Date(month), "MMM yy"),
      };
      for (const loc of filteredLocations) {
        const entry = locMap.get(loc);
        row[loc] = entry && entry.total > 0 ? Math.round((entry.passed / entry.total) * 100) : 0;
      }
      return row;
    });

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">
        Compliance Trend
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Monthly compliance scores over time per location
      </p>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={chartDefaults.margin}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: unknown, name) => [`${Number(v)}%`, String(name ?? "")]} />
          <Legend />
          <ReferenceLine
            y={85}
            stroke="#D97706"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{ value: "Target 85%", fill: "#D97706", fontSize: 10, position: "right" }}
          />
          {filteredLocations.map((loc, i) => (
            <Line
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              stroke={LOCATION_COLORS[loc] || "#666"}
              strokeWidth={2}
              strokeDasharray={i % 2 === 1 ? "5 3" : undefined}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
