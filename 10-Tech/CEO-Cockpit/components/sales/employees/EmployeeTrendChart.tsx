"use client";

import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import type { EmployeeDailyStat } from "@/lib/sales-employees/types";

export interface EmployeeTrendChartProps {
  daily: EmployeeDailyStat[];
  serviceRate?: number;
  retailRate?: number;
  accentColor?: string;
  title?: string;
}

const SERVICE_COLOR = "#1B3A4B"; // deep navy
const RETAIL_COLOR = "#B79E61";  // muted gold
const MAX_LABELED_BARS = 20;

export function EmployeeTrendChart({
  daily,
  serviceRate = 0,
  retailRate = 0,
  title = "Daily Commission",
}: EmployeeTrendChartProps) {
  const data = daily.map((d) => {
    const svc = +(d.service_revenue * serviceRate).toFixed(2);
    const ret = +(d.retail_revenue * retailRate).toFixed(2);
    const total = +(svc + ret).toFixed(2);
    return {
      date: d.date.slice(5),
      "Service Commission": svc,
      "Retail Commission": ret,
      _total: total,
    };
  });

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
                  tickFormatter={(v) => formatCurrency(Number(v))}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [formatCurrency(Number(v)), String(name)]}
                />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey="Service Commission" stackId="comm" fill={SERVICE_COLOR} />
                <Bar dataKey="Retail Commission" stackId="comm" fill={RETAIL_COLOR} radius={[4, 4, 0, 0]}>
                  {showLabels && (
                    <LabelList
                      dataKey="_total"
                      position="top"
                      formatter={(v: unknown) => formatCurrency(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                    />
                  )}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
