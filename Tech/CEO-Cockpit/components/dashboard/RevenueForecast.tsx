"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonChart } from "@/components/ui/skeleton";
import { chartDefaults, formatCurrency } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

interface ForecastDataPoint {
  period: string;
  actual: number | null;
  forecast: number | null;
}

interface RevenueForecastProps {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}

export function RevenueForecast({
  dateFrom,
  dateTo,
  brandFilter,
}: RevenueForecastProps) {
  const [data, setData] = useState<ForecastDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Placeholder: in production this would fetch from an API
    const timer = setTimeout(() => {
      setData([
        { period: "Week 1", actual: 10200, forecast: null },
        { period: "Week 2", actual: 11400, forecast: null },
        { period: "Week 3", actual: 10800, forecast: null },
        { period: "Week 4", actual: null, forecast: 11600 },
        { period: "Week 5", actual: null, forecast: 12200 },
      ]);
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [dateFrom, dateTo, brandFilter]);

  if (loading) {
    return <SkeletonChart height={300} />;
  }

  // Resolve brand color from brandFilter (defaults to spa)
  const brandKey =
    brandFilter === "aesthetics" || brandFilter === "slimming"
      ? brandFilter
      : "spa";
  const actualColor = BRAND[brandKey].dark;
  const forecastColor = BRAND[brandKey].dark;

  // Last actual + last forecast — used for edge labels
  const lastActual = [...data].reverse().find((d) => d.actual != null)?.actual ?? null;
  const lastForecast =
    [...data].reverse().find((d) => d.forecast != null)?.forecast ?? null;
  const actualTotal = data.reduce((s, d) => s + (d.actual ?? 0), 0);
  const forecastTotal = data.reduce((s, d) => s + (d.forecast ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Revenue Forecast</CardTitle>
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-0.5"
              style={{ backgroundColor: actualColor }}
            />
            Actual {formatCurrency(actualTotal)} MTD
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 border-t-2 border-dashed"
              style={{ borderColor: forecastColor, opacity: 0.6 }}
            />
            Forecast {formatCurrency(forecastTotal)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart
            data={data}
            margin={{ ...chartDefaults.margin, right: 80, top: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={(v: number) => formatCurrency(v)}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(v: unknown, name) => [
                formatCurrency(Number(v)),
                String(name ?? ""),
              ]}
            />
            <Area
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke={actualColor}
              fill={actualColor}
              fillOpacity={0.15}
              strokeWidth={chartDefaults.strokeWidth}
              connectNulls={false}
            >
              <LabelList
                dataKey="actual"
                content={(props) => {
                  const { x, y, value, index } = props as Record<string, unknown>;
                  if (value == null) return <></>;
                  // Only label the LAST actual point
                  if (Number(value) !== lastActual) return <></>;
                  void index;
                  return (
                    <text
                      x={Number(x) + 6}
                      y={Number(y) - 6}
                      fontSize={11}
                      fontWeight={600}
                      fill={actualColor}
                    >
                      {formatCurrency(Number(value))}
                    </text>
                  );
                }}
              />
            </Area>
            <Area
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke={forecastColor}
              strokeOpacity={0.6}
              fill={forecastColor}
              fillOpacity={0.08}
              strokeWidth={chartDefaults.strokeWidth}
              strokeDasharray="5 5"
              connectNulls={false}
            >
              <LabelList
                dataKey="forecast"
                content={(props) => {
                  const { x, y, value } = props as Record<string, unknown>;
                  if (value == null) return <></>;
                  // Only label the LAST forecast point
                  if (Number(value) !== lastForecast) return <></>;
                  return (
                    <text
                      x={Number(x) + 6}
                      y={Number(y) - 6}
                      fontSize={11}
                      fontWeight={600}
                      fill={forecastColor}
                      opacity={0.7}
                    >
                      {formatCurrency(Number(value))}
                    </text>
                  );
                }}
              />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
