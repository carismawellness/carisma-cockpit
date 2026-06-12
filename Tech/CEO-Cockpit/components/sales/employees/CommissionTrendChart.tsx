"use client";

// Stacked bar chart (service + retail commissions) with a total commission line,
// covering the last 6 full calendar months for a single employee.

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyEmployeeStat } from "@/lib/hooks/useSalesEmployeeMonthly";

export interface CommissionTrendChartProps {
  months: MonthlyEmployeeStat[];
  isLoading: boolean;
  accentColor?: string; // brand accent (e.g. BRAND.spa.soft)
}

const SERVICE_COLOR = "#6EE7B7"; // emerald-300
const RETAIL_COLOR = "#FCD34D";  // amber-300
const LINE_COLOR = "#F9A825";    // gold — total commission trend line

function fmtEur(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "€0";
  if (Math.abs(n) >= 1_000) return `€${(n / 1_000).toFixed(1)}K`;
  return `€${n.toFixed(0)}`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-md text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-semibold text-gray-800">{fmtEur(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function CommissionTrendChart({
  months,
  isLoading,
}: CommissionTrendChartProps) {
  const hasData = months.length > 0 && months.some((m) => m.total_commission > 0);

  const chartData = months.map((m) => ({
    name: m.monthLabel,
    Service: +m.service_commission.toFixed(2),
    Retail: +m.retail_commission.toFixed(2),
    Total: +m.total_commission.toFixed(2),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          Commission History
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Last 6 months — service &amp; retail
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[240px] animate-pulse rounded-lg bg-gray-100" />
        ) : !hasData ? (
          <div className="flex h-[240px] items-center justify-center text-center">
            <p className="text-sm text-muted-foreground max-w-xs">
              Building your history — check back next month!
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart
              data={chartData}
              margin={{ top: 24, right: 12, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => fmtEur(v)}
                tick={{ fontSize: 11 }}
                width={52}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: 8, fontSize: 12 }}
                formatter={(value: string) =>
                  value === "Total" ? null : value
                }
              />

              {/* Stacked service bar (bottom) */}
              <Bar
                dataKey="Service"
                stackId="commission"
                fill={SERVICE_COLOR}
                isAnimationActive={false}
              />

              {/* Stacked retail bar (top) — carries the LabelList */}
              <Bar
                dataKey="Retail"
                stackId="commission"
                fill={RETAIL_COLOR}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="Total"
                  position="top"
                  formatter={(v: unknown) => fmtEur(v)}
                  style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                />
              </Bar>

              {/* Total commission trend line */}
              <Line
                dataKey="Total"
                type="monotone"
                stroke={LINE_COLOR}
                strokeWidth={2}
                dot={{ r: 3, fill: LINE_COLOR, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
