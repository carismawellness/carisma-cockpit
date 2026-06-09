"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  EbitdaSummaryHeader,
  SummaryData,
  SppyData,
} from "@/components/finance/EbitdaSummaryHeader";
import type {
  LongitudinalResponse,
} from "@/app/api/finance/ebitda-longitudinal/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const BRAND_COLORS = {
  spa:  "#10b981",
  aes:  "#a855f7",
  slim: "#f59e0b",
  sppy: "#94a3b8",
};

// ── ChartCard wrapper ─────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-warm-border p-5">
      <h3 className="text-sm font-semibold text-charcoal mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ── Custom Tooltip for Revenue chart ─────────────────────────────────────────

interface RevTooltipPayload {
  name: string;
  value: number;
  color: string;
}

function RevTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: RevTooltipPayload[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const fmt = (v: number) =>
    v >= 1000 ? "€" + (v / 1000).toFixed(1) + "k" : "€" + v.toFixed(0);

  const total = payload
    .filter((p) => ["Spa", "Aesthetics", "Slimming"].includes(p.name))
    .reduce((s, p) => s + (p.value ?? 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1 min-w-[160px]">
      <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="tabular-nums font-medium">{fmt(p.value ?? 0)}</span>
        </div>
      ))}
      {total > 0 && (
        <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1 font-semibold">
          <span className="text-gray-600">Total</span>
          <span className="tabular-nums">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

// ── Chart data type ───────────────────────────────────────────────────────────

type ChartPoint = {
  label:       string;
  spaRev:      number;
  aesRev:      number;
  slimRev:     number;
  totalRev:    number;
  sppyRev:     number | null;
  spaEbitda:   number;
  aesEbitda:   number;
  slimEbitda:  number;
  totalEbitda: number;
  sppyEbitda:  number | null;
  margin:      number;
  sppyMargin:  number | null;
};

// ── Y-axis tick formatters ────────────────────────────────────────────────────

function fmtEuro(v: number): string {
  return v >= 1000 ? "€" + (v / 1000).toFixed(0) + "k" : "€" + v;
}

function fmtPct(v: number): string {
  return v + "%";
}

// ── Inner content ─────────────────────────────────────────────────────────────

function LongitudinalContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
}) {
  const dfStr = toIso(dateFrom);
  const dtStr = toIso(dateTo);

  const [data, setData]       = useState<LongitudinalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    const controller = new AbortController();
    const qs = new URLSearchParams({ date_from: dfStr, date_to: dtStr });
    fetch(`/api/finance/ebitda-longitudinal?${qs}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [dfStr, dtStr]);

  // ── Summary data from the LAST period ──────────────────────────────────────

  const summaryData: SummaryData | null = useMemo(() => {
    if (!data || data.periods.length === 0) return null;
    const last = data.periods[data.periods.length - 1];
    const c    = last.current;

    // Compute period label from period count
    const n = data.periods.length;
    const periodLabel =
      n <= 1  ? "1 month"
      : n <= 3  ? `${n} months`
      : n <= 12 ? `${n} months`
      : `${Math.round(n / 12)} year`;

    const s = last.sppy;
    const sppy: SppyData | null = s ? {
      groupRevenue: s.revenue,
      groupEbitda:  s.ebitda,
      spaRevenue:   s.spa.revenue,
      spaEbitda:    s.spa.ebitda,
      aesRevenue:   s.aes.revenue,
      aesEbitda:    s.aes.ebitda,
      slimRevenue:  s.slim.revenue,
      slimEbitda:   s.slim.ebitda,
    } : null;

    return {
      groupRevenue: c.revenue,
      groupEbitda:  c.ebitda,
      spaRevenue:   c.spa.revenue,
      spaEbitda:    c.spa.ebitda,
      aesRevenue:   c.aes.revenue,
      aesEbitda:    c.aes.ebitda,
      slimRevenue:  c.slim.revenue,
      slimEbitda:   c.slim.ebitda,
      periodLabel,
      sppy,
    };
  }, [data]);

  // ── Chart data ──────────────────────────────────────────────────────────────

  const chartData: ChartPoint[] = useMemo(() => {
    if (!data) return [];
    return data.periods.map((p) => ({
      label:       p.label.replace(" 20", " '"),
      spaRev:      p.current.spa.revenue,
      aesRev:      p.current.aes.revenue,
      slimRev:     p.current.slim.revenue,
      totalRev:    p.current.revenue,
      sppyRev:     p.sppy?.revenue ?? null,
      spaEbitda:   p.current.spa.ebitda,
      aesEbitda:   p.current.aes.ebitda,
      slimEbitda:  p.current.slim.ebitda,
      totalEbitda: p.current.ebitda,
      sppyEbitda:  p.sppy?.ebitda ?? null,
      margin:      p.current.ebitda_pct,
      sppyMargin:  p.sppy?.ebitda_pct ?? null,
    }));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <EbitdaSummaryHeader data={summaryData} loading={loading} />

      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Loading…
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive py-4">{error}</p>
      )}

      {data && chartData.length > 0 && (
        <div className="space-y-4">

          {/* Chart 1 — Revenue Over Time */}
          <ChartCard title="Group Revenue by Month">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtEuro}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip content={<RevTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  iconType="square"
                />
                <Bar dataKey="spaRev"  name="Spa"        stackId="rev" fill={BRAND_COLORS.spa}  radius={[0, 0, 0, 0]} />
                <Bar dataKey="aesRev"  name="Aesthetics" stackId="rev" fill={BRAND_COLORS.aes}  radius={[0, 0, 0, 0]} />
                <Bar dataKey="slimRev" name="Slimming"   stackId="rev" fill={BRAND_COLORS.slim} radius={[2, 2, 0, 0]} />
                <Line
                  dataKey="sppyRev"
                  name="SPPY Rev"
                  type="monotone"
                  stroke={BRAND_COLORS.sppy}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 2 — EBITDA by Month */}
          <ChartCard title="Group EBITDA by Month">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtEuro}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const v = Number(value ?? 0);
                    return [
                      v >= 1000 || v <= -1000
                        ? "€" + (v / 1000).toFixed(1) + "k"
                        : "€" + v.toFixed(0),
                      String(name),
                    ] as [string, string];
                  }}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  iconType="square"
                />
                <ReferenceLine y={0} stroke="#e5e7eb" />
                <Bar dataKey="spaEbitda"  name="Spa EBITDA"        fill={BRAND_COLORS.spa}  radius={[2, 2, 0, 0]} />
                <Bar dataKey="aesEbitda"  name="Aesthetics EBITDA" fill={BRAND_COLORS.aes}  radius={[2, 2, 0, 0]} />
                <Bar dataKey="slimEbitda" name="Slimming EBITDA"   fill={BRAND_COLORS.slim} radius={[2, 2, 0, 0]} />
                <Line
                  dataKey="sppyEbitda"
                  name="SPPY EBITDA"
                  type="monotone"
                  stroke={BRAND_COLORS.sppy}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Chart 3 — EBITDA Margin % */}
          <ChartCard title="EBITDA Margin % by Month">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={fmtPct}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  formatter={(value, name) => [
                    Number(value ?? 0).toFixed(1) + "%",
                    String(name),
                  ] as [string, string]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  iconType="plainline"
                />
                <ReferenceLine
                  y={30}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{
                    value: "Target 30%",
                    position: "insideTopRight",
                    fill: "#f59e0b",
                    fontSize: 11,
                  }}
                />
                <Line
                  dataKey="margin"
                  name="EBITDA %"
                  type="monotone"
                  stroke={BRAND_COLORS.spa}
                  strokeWidth={2}
                  dot={{ r: 3, fill: BRAND_COLORS.spa }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
                <Line
                  dataKey="sppyMargin"
                  name="SPPY %"
                  type="monotone"
                  stroke={BRAND_COLORS.sppy}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

        </div>
      )}
    </div>
  );
}

// ── Page entry point ──────────────────────────────────────────────────────────

export default function LongitudinalPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <LongitudinalContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
