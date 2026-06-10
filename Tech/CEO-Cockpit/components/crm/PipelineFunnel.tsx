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
  LabelList,
} from "recharts";
import { chartColors } from "@/lib/charts/config";
import { useGhlFunnel } from "@/lib/hooks/useGhlFunnel";
import { STAGE_ORDER } from "@/app/api/crm/ghl-funnel/route";

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

const STAGE_FILL: Record<string, string> = {
  "Booking Won":  "#22c55e",
  "Booking Lost": "#ef4444",
};

function stageFill(stage: string, brand: string): string {
  return STAGE_FILL[stage] ?? chartColors[brand as keyof typeof chartColors] ?? "#94a3b8";
}

function BarLabel(props: Record<string, unknown>) {
  const { x, y, width, height, value } = props as {
    x: number; y: number; width: number; height: number; value: number;
  };
  if (!value) return null;
  return (
    <text
      x={(x as number) + (width as number) + 6}
      y={(y as number) + (height as number) / 2}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fill="#374151"
    >
      {value}
    </text>
  );
}

interface ChartRow {
  stage: string;
  fill: string;
  [key: string]: string | number;
}

export function PipelineFunnel({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { data, isLoading } = useGhlFunnel(dateFrom, dateTo);

  const brands = brandFilter ? [brandFilter] : ["spa", "aesthetics", "slimming"];
  const isSingleBrand = brands.length === 1;

  const chartData = useMemo((): ChartRow[] => {
    if (!data) return [];
    return STAGE_ORDER.map((stage) => {
      const row: ChartRow = {
        stage,
        fill: isSingleBrand ? stageFill(stage, brands[0]) : "#94a3b8",
      };
      for (const b of brands) {
        row[b] = data.brands[b]?.[stage] ?? 0;
      }
      return row;
    });
  }, [data, brands, isSingleBrand]);

  const totals = useMemo(() => {
    const t: Record<string, Record<string, number>> = {};
    for (const b of brands) {
      t[b] = {};
      for (const stage of STAGE_ORDER) {
        t[b][stage] = data?.brands[b]?.[stage] ?? 0;
      }
    }
    return t;
  }, [data, brands]);

  const ACTIVE_STAGES = ["New Leads", "Call Back", "Contacted", "Booking Won", "Active Member"];
  const totalActive = brands.reduce(
    (s, b) => s + ACTIVE_STAGES.reduce((st, stage) => st + (data?.brands[b]?.[stage] ?? 0), 0),
    0,
  );
  const totalNewLeads = brands.reduce((s, b) => s + (data?.brands[b]?.["New Leads"] ?? 0), 0);
  const totalWon      = brands.reduce((s, b) => s + (data?.brands[b]?.["Booking Won"] ?? 0), 0);
  const convPct       = totalNewLeads > 0 ? ((totalWon / totalNewLeads) * 100).toFixed(1) : "—";

  if (isLoading) {
    return <div className="h-96 rounded-xl bg-gray-100 animate-pulse" />;
  }

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Pipeline Funnel</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Current snapshot · Call Pipeline stages · from GHL CRM
          </p>
        </div>
        <div className="flex gap-4 text-right shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">Total Active</p>
            <p className="text-lg font-bold text-foreground">{totalActive}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Booking Won</p>
            <p className="text-lg font-bold text-emerald-600">{totalWon}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Conv. Rate</p>
            <p className="text-lg font-bold text-foreground">{convPct === "—" ? "—" : `${convPct}%`}</p>
          </div>
        </div>
      </div>

      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 60, left: 130, bottom: 5 }}
            barCategoryGap="25%"
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={125} />
            <Tooltip
              formatter={(value, name) => [
                value,
                BRAND_LABELS[String(name)] ?? String(name),
              ]}
            />

            {isSingleBrand ? (
              <Bar
                dataKey={brands[0]}
                name={BRAND_LABELS[brands[0]]}
                fill={chartColors[brands[0] as keyof typeof chartColors] ?? "#94a3b8"}
                radius={[0, 3, 3, 0]}
                maxBarSize={28}
              >
                <LabelList content={BarLabel as never} dataKey={brands[0]} />
              </Bar>
            ) : (
              brands.map((b) => (
                <Bar
                  key={b}
                  dataKey={b}
                  name={BRAND_LABELS[b]}
                  fill={chartColors[b as keyof typeof chartColors] ?? "#888"}
                  radius={[0, 3, 3, 0]}
                  maxBarSize={20}
                >
                  <LabelList content={BarLabel as never} dataKey={b} />
                </Bar>
              ))
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {!isSingleBrand && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {brands.map((b) => {
            const brandTotal = STAGE_ORDER.reduce((s, st) => s + (totals[b]?.[st] ?? 0), 0);
            const brandWon = totals[b]?.["Booking Won"] ?? 0;
            const brandNew = totals[b]?.["New Leads"] ?? 0;
            const cv = brandNew > 0 ? ((brandWon / brandNew) * 100).toFixed(1) : "—";
            return (
              <div key={b} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chartColors[b as keyof typeof chartColors] ?? "#888" }}
                  />
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {BRAND_LABELS[b]}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total leads</span>
                    <span className="font-semibold text-gray-900">{brandTotal}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Won</span>
                    <span className="font-semibold text-emerald-600">{brandWon}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Conv. rate</span>
                    <span className="font-semibold text-gray-900">{cv === "—" ? "—" : `${cv}%`}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
