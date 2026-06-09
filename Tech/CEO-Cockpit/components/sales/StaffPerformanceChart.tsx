"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

interface StaffMember {
  name: string;
  serviceRevenue: number;
  retailRevenue: number;
}

interface StaffPerformanceChartProps {
  title?: string;
  subtitle?: string;
  data: StaffMember[];
  serviceColor: string;
  retailColor: string;
  icon?: React.ReactNode;
  mode?: "combined" | "service" | "retail";
}

export function StaffPerformanceChart({
  title = "Staff Performance",
  subtitle,
  data,
  serviceColor,
  retailColor,
  icon,
  mode = "combined",
}: StaffPerformanceChartProps) {
  if (data.length === 0) return null;

  const chartData = [...data]
    .map((d) => {
      const total = d.serviceRevenue + d.retailRevenue;
      return {
        name: d.name,
        "Service Revenue": d.serviceRevenue,
        "Retail Revenue": d.retailRevenue,
        retailPct: total > 0 ? ((d.retailRevenue / total) * 100).toFixed(0) : "0",
        total,
      };
    })
    .sort((a, b) => {
      if (mode === "service") return b["Service Revenue"] - a["Service Revenue"];
      if (mode === "retail")  return b["Retail Revenue"]  - a["Retail Revenue"];
      return b.total - a.total;
    });

  const barHeight = 28;
  const chartHeight = chartData.length * 44 + 50;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-1">
        {icon}
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {subtitle && (
        <p className="text-xs text-muted-foreground mb-4 ml-0">{subtitle}</p>
      )}

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 72, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatCurrency(v)}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fontSize: 12 }}
          />
          <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />

          {/* Service bar — shown in combined or service mode */}
          {(mode === "combined" || mode === "service") && (
            <Bar
              dataKey="Service Revenue"
              stackId={mode === "combined" ? "total" : undefined}
              fill={serviceColor}
              radius={mode === "service" ? [0, 4, 4, 0] : [0, 0, 0, 0]}
              barSize={barHeight}
            >
              {mode === "service" && (
                <LabelList
                  dataKey="Service Revenue"
                  content={(props) => {
                    const { x, width, y, height, value } = props as Record<string, unknown>;
                    if (!value) return <></>;
                    return (
                      <text
                        x={Number(x) + Number(width) + 6}
                        y={Number(y) + Number(height) / 2}
                        textAnchor="start"
                        dominantBaseline="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="#374151"
                      >
                        {formatCurrency(Number(value))}
                      </text>
                    );
                  }}
                />
              )}
            </Bar>
          )}

          {/* Retail bar — shown in combined or retail mode */}
          {(mode === "combined" || mode === "retail") && (
            <Bar
              dataKey="Retail Revenue"
              stackId={mode === "combined" ? "total" : undefined}
              fill={retailColor}
              radius={[0, 4, 4, 0]}
              barSize={barHeight}
            >
              {mode === "combined" && (
                <LabelList
                  dataKey="retailPct"
                  content={(props) => {
                    const { x, width, y, height, value } = props as Record<string, unknown>;
                    const w = Number(width);
                    if (!value || w < 20) return <></>;
                    return (
                      <text
                        x={Number(x) + w / 2}
                        y={Number(y) + Number(height) / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={9}
                        fontWeight={700}
                        fill="white"
                      >
                        {String(value)}%
                      </text>
                    );
                  }}
                />
              )}
              <LabelList
                dataKey={mode === "retail" ? "Retail Revenue" : "total"}
                content={(props) => {
                  const { x, width, y, height, index } = props as Record<string, unknown>;
                  const entry = chartData[Number(index)];
                  if (!entry) return <></>;
                  const displayValue = mode === "retail"
                    ? entry["Retail Revenue"]
                    : entry.total;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2}
                      textAnchor="start"
                      dominantBaseline="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="#374151"
                    >
                      {formatCurrency(displayValue)}
                    </text>
                  );
                }}
              />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

export type { StaffMember, StaffPerformanceChartProps };
