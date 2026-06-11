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
  Legend,
  LabelList,
} from "recharts";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { format, parseISO } from "date-fns";
import type { CrmDailyRow } from "@/lib/types/crm";
import { isExcludedCrmDate } from "@/lib/constants/excluded-dates";
import { BRAND } from "@/lib/constants/design-tokens";

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

// Canonical brand palette — `soft` for solid bar fills.
const BRAND_FILL: Record<string, string> = {
  spa:        BRAND.spa.soft,
  aesthetics: BRAND.aesthetics.soft,
  slimming:   BRAND.slimming.soft,
};

export function LeadsPerHour({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { brandMap } = useLookups();
  const brandIdToSlug = useMemo(() => {
    const m: Record<number, string> = {};
    for (const [slug, id] of Object.entries(brandMap)) m[id] = slug;
    return m;
  }, [brandMap]);

  const { data, loading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  const visibleBrands = brandFilter
    ? [brandFilter]
    : ["spa", "aesthetics", "slimming"];

  // Segment label — only render if the segment is tall enough to fit text
  function SegmentLabel(props: Record<string, unknown>) {
    const { x, y, width, height, value } = props as {
      x: number; y: number; width: number; height: number; value: number;
    };
    if (!value || (height as number) < 18) return null;
    return (
      <text
        x={x + width / 2}
        y={y + (height as number) / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={600}
        fill="rgba(0,0,0,0.55)"
      >
        {value}
      </text>
    );
  }

  // Build daily series: { date, spa, aesthetics, slimming }
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number>>();
    for (const row of data) {
      if (isExcludedCrmDate(row.date)) continue;
      const slug = brandIdToSlug[row.brand_id];
      if (!slug || !visibleBrands.includes(slug)) continue;
      const leads = row.total_leads ?? 0;
      if (!byDate.has(row.date)) byDate.set(row.date, {});
      byDate.get(row.date)![slug] = (byDate.get(row.date)![slug] ?? 0) + leads;
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => {
        const _total = Object.values(counts).reduce((s, v) => s + v, 0);
        return { date: format(parseISO(date), "MMM d"), ...counts, _total };
      }) as Array<Record<string, string | number>>;
  }, [data, brandIdToSlug, visibleBrands]);

  // Summary stats
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of chartData) {
      for (const b of visibleBrands) {
        t[b] = (t[b] ?? 0) + ((row[b] as number) ?? 0);
      }
    }
    return t;
  }, [chartData, visibleBrands]);

  const dailyAvgByBrand = useMemo(() => {
    const numDays = chartData.length || 1;
    const avgs: Record<string, number> = {};
    for (const b of visibleBrands) {
      avgs[b] = (totals[b] ?? 0) / numDays;
    }
    return avgs;
  }, [chartData, totals, visibleBrands]);

  if (loading) {
    return <div className="h-80 rounded-xl bg-gray-100 animate-pulse" />;
  }

  const hasData = chartData.length > 0;

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">Daily Lead Volume</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          New leads per day by brand · from GHL CRM
        </p>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
          <p className="text-sm font-medium">No GHL lead data for this period</p>
          <p className="text-xs max-w-xs">
            Run the GHL CRM ETL sync in Settings → Data Sources to populate this chart.
          </p>
        </div>
      ) : (
        <>
          <div className="h-[240px] md:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 22, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {visibleBrands.map((b, i) => {
                  const isTop = i === visibleBrands.length - 1;
                  return (
                    <Bar
                      key={b}
                      dataKey={b}
                      name={BRAND_LABELS[b] ?? b}
                      fill={BRAND_FILL[b] ?? "#888"}
                      radius={isTop ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                      stackId="leads"
                    >
                      <LabelList content={SegmentLabel as never} />
                      {isTop && (
                        <LabelList
                          dataKey="_total"
                          position="top"
                          style={{ fontSize: 11, fontWeight: 700, fill: "#111827" }}
                          formatter={(v: unknown) => Number(v).toLocaleString()}
                        />
                      )}
                    </Bar>
                  );
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Total Leads — Period
              </p>
              <div className="space-y-1.5">
                {visibleBrands.map((b) => (
                  <div key={b} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: BRAND_FILL[b] ?? "#888" }}
                      />
                      <span className="font-medium text-gray-700">{BRAND_LABELS[b]}</span>
                    </span>
                    <span className="font-semibold text-gray-900">{totals[b] ?? 0} leads</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Daily Average
              </p>
              <div className="space-y-1.5">
                {visibleBrands.map((b) => (
                  <div key={b} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: BRAND_FILL[b] ?? "#888" }}
                      />
                      <span className="font-medium text-gray-700">{BRAND_LABELS[b]}</span>
                    </span>
                    <span className="font-semibold text-gray-900">
                      {dailyAvgByBrand[b] != null
                        ? `${dailyAvgByBrand[b].toFixed(1)} leads/day`
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
