"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import {
  useBrandStandards,
  computeLocationScores,
  computeCategoryScores,
  computeChecklistItems,
  computeOverallScore,
} from "@/lib/hooks/useBrandStandards";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList,
} from "recharts";

function scoreColor(score: number): string {
  if (score >= 85) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  return "#EF4444";
}

interface StandardTabProps {
  standardType: string;
  month: Date;
  location: string | null;
}

export function StandardTab({ standardType, month, location }: StandardTabProps) {
  const { data, loading, error } = useBrandStandards({
    standardType,
    month,
    location,
  });

  const locationScores = useMemo(() => computeLocationScores(data), [data]);
  const categoryScores = useMemo(() => computeCategoryScores(data), [data]);
  const checklistItems = useMemo(() => computeChecklistItems(data), [data]);
  const overallScore = useMemo(() => computeOverallScore(data), [data]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 bg-warm-gray animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-red-500">Error loading data: {error}</p>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-muted-foreground">No data available for this month.</p>
      </Card>
    );
  }

  const bestLoc = locationScores[0];
  const worstLoc = locationScores[locationScores.length - 1];
  const belowThreshold = categoryScores.filter((c) => c.score < 50).length;

  const kpis: KPIData[] = [
    {
      label: "Overall Score",
      value: `${overallScore}%`,
      trend: overallScore >= 75 ? 1 : -1,
    },
    {
      label: "Best Location",
      value: bestLoc ? `${bestLoc.location} (${bestLoc.score}%)` : "—",
      trend: 1,
    },
    {
      label: "Worst Location",
      value: worstLoc ? `${worstLoc.location} (${worstLoc.score}%)` : "—",
      trend: worstLoc && worstLoc.score < 60 ? -1 : 0,
    },
    {
      label: "Categories <50%",
      value: String(belowThreshold),
      trend: belowThreshold === 0 ? 1 : -1,
    },
    {
      label: "Items Checked",
      value: String(data.length),
    },
  ];

  const locations = locationScores.map((l) => l.location);

  return (
    <div className="space-y-6">
      <KPICardRow kpis={kpis} />

      {/* Location Compliance Heatmap */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Compliance by Location
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Overall pass rate per location — green {">"}85%, amber 60-85%, red {"<"}60%
        </p>
        <ResponsiveContainer width="100%" height={Math.max(280, locationScores.length * 44)}>
          <BarChart
            data={locationScores}
            layout="vertical"
            margin={{ top: 20, right: 60, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="location" width={100} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: unknown, name) => [`${Number(v)}%`, String(name ?? "")]} />
            <ReferenceLine
              x={85}
              stroke="#D97706"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: "85%", position: "top", fill: "#D97706", fontSize: 10 }}
            />
            <ReferenceLine x={60} stroke="#9CA3AF" strokeDasharray="3 3" />
            <Bar dataKey="score" name="Compliance %" radius={[0, 4, 4, 0]} barSize={24}>
              {locationScores.map((entry, index) => (
                <Cell key={index} fill={scoreColor(entry.score)} fillOpacity={0.85} />
              ))}
              <LabelList
                dataKey="score"
                position="right"
                content={(props) => {
                  const { x, y, width, height, value } = props as Record<string, unknown>;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2 + 4}
                      fontSize={11}
                      fontWeight={700}
                      fill={scoreColor(Number(value))}
                    >
                      {Number(value)}%
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Category Breakdown */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Compliance by Category
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Which operational areas are strongest and weakest
        </p>
        <ResponsiveContainer width="100%" height={Math.max(280, categoryScores.length * 44)}>
          <BarChart
            data={categoryScores}
            layout="vertical"
            margin={{ top: 20, right: 60, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="category" width={180} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: unknown, name) => [`${Number(v)}%`, String(name ?? "")]} />
            <ReferenceLine
              x={85}
              stroke="#D97706"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: "85%", position: "top", fill: "#D97706", fontSize: 10 }}
            />
            <Bar dataKey="score" name="Compliance %" radius={[0, 4, 4, 0]} barSize={20}>
              {categoryScores.map((entry, index) => (
                <Cell key={index} fill={scoreColor(entry.score)} fillOpacity={0.85} />
              ))}
              <LabelList
                dataKey="score"
                position="right"
                content={(props) => {
                  const { x, y, width, height, value } = props as Record<string, unknown>;
                  return (
                    <text
                      x={Number(x) + Number(width) + 6}
                      y={Number(y) + Number(height) / 2 + 4}
                      fontSize={11}
                      fontWeight={700}
                      fill={scoreColor(Number(value))}
                    >
                      {Number(value)}%
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Checklist Detail Table */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          Checklist Detail
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Every item with pass/fail per location
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground w-[300px]">Item</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground w-[140px]">Category</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground w-[60px]">Pass %</th>
                {locations.map((loc) => (
                  <th key={loc} className="text-center py-2 px-2 font-medium text-muted-foreground text-xs">
                    {loc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checklistItems.map((item, idx) => (
                <tr key={idx} className="border-b border-border/50 hover:bg-warm-gray/50">
                  <td className="py-2 px-3 text-foreground text-xs leading-tight max-w-[300px]">
                    {item.item}
                  </td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">
                    {item.category}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-xs tabular-nums" style={{ color: scoreColor(item.passRate) }}>
                    {item.passRate}%
                  </td>
                  {locations.map((loc) => (
                    <td key={loc} className="py-2 px-2 text-center">
                      {item.locations[loc] !== undefined ? (
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${
                            item.locations[loc] ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
