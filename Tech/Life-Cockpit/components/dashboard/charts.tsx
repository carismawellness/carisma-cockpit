"use client";

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

export type SeriesPoint = { x: string | number; y: number };

export function MiniArea({
  data,
  color = "#10b981",
  height = 80,
}: {
  data: SeriesPoint[];
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="y" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={2} />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: "4px 8px" }}
          labelStyle={{ display: "none" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({
  data,
  color = "#10b981",
  height = 200,
  optimalBand,
  unit,
}: {
  data: SeriesPoint[];
  color?: string;
  height?: number;
  optimalBand?: { low: number; high: number };
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        <XAxis dataKey="x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} unit={unit} />
        {optimalBand && (
          <ReferenceArea
            y1={optimalBand.low}
            y2={optimalBand.high}
            fill="#10b981"
            fillOpacity={0.08}
            stroke="none"
          />
        )}
        <Line type="monotone" dataKey="y" stroke={color} strokeWidth={2} dot={{ r: 2 }} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function StackedBars({
  data,
  bars,
  height = 240,
}: {
  data: Array<Record<string, string | number>>;
  bars: Array<{ key: string; color: string; name?: string }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <XAxis dataKey="x" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip contentStyle={{ fontSize: 11 }} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} stackId="a" fill={b.color} name={b.name || b.key} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
