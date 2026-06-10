"use client";

// Daily trend for an employee: stacked service+retail revenue bars with a
// commission line on a secondary axis.
//
// Repo bar-label rule: bar values render as LabelList on the bars — except
// for dense daily charts, where labels are omitted when more than 20 bars
// (matches existing dense daily charts in app/sales).

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import type { EmployeeDailyStat } from "@/lib/sales-employees/types";

export interface EmployeeTrendChartProps {
  daily: EmployeeDailyStat[];
  /** Brand accent (hex) for the service bars; retail uses a softer tint. */
  accentColor?: string;
  title?: string;
}

const DEFAULT_ACCENT = "#1B3A4B"; // deep navy
const RETAIL_COLOR = "#B79E61";   // muted gold
const COMMISSION_COLOR = "#E07A5F"; // coral (shared accent)
const MAX_LABELED_BARS = 20;

export function EmployeeTrendChart({
  daily,
  accentColor = DEFAULT_ACCENT,
  title = "Daily Revenue & Commission",
}: EmployeeTrendChartProps) {
  const data = daily.map((d) => ({
    date: d.date.slice(5), // MM-DD keeps the axis compact
    Service: d.service_revenue,
    Retail: d.retail_revenue,
    Commission: d.commission,
    _total: +(d.service_revenue + d.retail_revenue).toFixed(2),
  }));

  // Dense daily charts skip per-bar labels (tooltip + axis carry the values)
  const showLabels = data.length > 0 && data.length <= MAX_LABELED_BARS;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No sales in this period.
          </p>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 24, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="revenue"
                  orientation="left"
                  tickFormatter={(v) => formatCurrency(Number(v))}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="commission"
                  orientation="right"
                  tickFormatter={(v) => formatCurrency(Number(v))}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [formatCurrency(Number(v)), String(name)]}
                />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar yAxisId="revenue" dataKey="Service" stackId="rev" fill={accentColor} />
                <Bar yAxisId="revenue" dataKey="Retail" stackId="rev" fill={RETAIL_COLOR} radius={[4, 4, 0, 0]}>
                  {showLabels && (
                    <LabelList
                      dataKey="_total"
                      position="top"
                      formatter={(v: unknown) => formatCurrency(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                    />
                  )}
                </Bar>
                <Line
                  yAxisId="commission"
                  type="monotone"
                  dataKey="Commission"
                  stroke={COMMISSION_COLOR}
                  strokeWidth={2}
                  dot={{ r: 3, fill: COMMISSION_COLOR }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
