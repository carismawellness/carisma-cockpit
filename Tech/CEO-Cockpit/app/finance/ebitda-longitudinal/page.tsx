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
  LabelList,
  ReferenceLine,
} from "recharts";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  EbitdaSummaryHeader,
  SummaryData,
  SppyData,
} from "@/components/finance/EbitdaSummaryHeader";
import type { LongitudinalResponse } from "@/app/api/finance/ebitda-longitudinal/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COST_COLORS: Record<string, string> = {
  wages:       "#475569",
  advertising: "#8b5cf6",
  rent:        "#d97706",
  sga:         "#0ea5e9",
  cogs:        "#f43f5e",
  utilities:   "#14b8a6",
  ebitda_pos:  "#34d399",
  ebitda_neg:  "#f87171",
};

const COST_LABELS: Record<string, string> = {
  wages:       "Wages",
  advertising: "Advertising",
  rent:        "Rent",
  sga:         "SG&A",
  cogs:        "COGS",
  utilities:   "Utilities",
};

// ── ChartCard helper ──────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-warm-border p-5">
      <h3 className="text-sm font-semibold text-charcoal mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ── Brand chart data type ─────────────────────────────────────────────────────

interface BrandChartPoint {
  label:           string;
  revenue:         number;
  revenue_lbl:     string;  // "€297k (+8% vs LY)" or "€297k"
  wages:           number;
  wages_lbl:       string;
  advertising:     number;
  advertising_lbl: string;
  rent:            number;
  rent_lbl:        string;
  sga:             number;
  sga_lbl:         string;
  cogs:            number;
  cogs_lbl:        string;
  utilities:       number;
  utilities_lbl:   string;
  ebitda:          number;
  ebitda_pos:      number;
  ebitda_lbl:      string;
  ebitda_neg:      number;
  ebitda_pct:      number;
  sppyRevenue:     number | null;
  sppyEbitda:      number | null;
  sppyEbitdaPct:   number | null;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

interface TooltipEntry {
  name:    string;
  value:   number;
  color:   string;
  dataKey: string;
  payload: BrandChartPoint;
}

function BrandTooltip({
  active,
  payload,
  label,
}: {
  active?:  boolean;
  payload?: TooltipEntry[];
  label?:   string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const pt = payload[0]?.payload as BrandChartPoint | undefined;
  if (!pt) return null;

  const fmt = (v: number) => {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    return abs >= 1000 ? sign + "€" + (abs / 1000).toFixed(1) + "k" : sign + "€" + abs.toFixed(0);
  };

  const ebitda = pt.ebitda;
  const margin = pt.revenue !== 0 ? (ebitda / pt.revenue) * 100 : 0;
  const ebitdaColor = ebitda >= 0 ? "#10b981" : "#ef4444";

  const costKeys: (keyof typeof COST_LABELS)[] = ["wages", "advertising", "rent", "sga", "cogs", "utilities"];

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1 min-w-[190px]">
      <p className="font-semibold text-gray-800 mb-1.5">{label}</p>

      <div className="flex justify-between gap-4">
        <span className="text-gray-500">Revenue</span>
        <span className="tabular-nums font-semibold">{fmt(pt.revenue)}</span>
      </div>

      <div className="border-t border-gray-100 pt-1 mt-0.5 space-y-0.5">
        {costKeys.map((k) => {
          const v = pt[k as keyof BrandChartPoint] as number;
          if (!v) return null;
          return (
            <div key={k} className="flex justify-between gap-4">
              <span style={{ color: COST_COLORS[k] }}>{COST_LABELS[k]}</span>
              <span className="tabular-nums">{fmt(v)}</span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-0.5 font-semibold">
        <span style={{ color: ebitdaColor }}>EBITDA</span>
        <span className="tabular-nums" style={{ color: ebitdaColor }}>
          {fmt(ebitda)} ({margin.toFixed(1)}%)
        </span>
      </div>

      {pt.sppyRevenue != null && (
        <div className="flex justify-between gap-4 text-gray-400">
          <span>LY Revenue</span>
          <span className="tabular-nums">{fmt(pt.sppyRevenue)}</span>
        </div>
      )}
    </div>
  );
}

// ── Brand chart ───────────────────────────────────────────────────────────────

function BrandChart({ points }: { points: BrandChartPoint[] }) {
  const fmtEuro = (v: number) =>
    Math.abs(v) >= 1000 ? "€" + (v / 1000).toFixed(0) + "k" : "€" + v;

  const lblStyle = { fontSize: 9, fill: "#fff", fontWeight: 600 };

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ComposedChart data={points} margin={{ top: 28, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtEuro}
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip content={<BrandTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} iconType="square" />

        {/* Stacked cost bars — each with € (%) label inside */}
        <Bar dataKey="wages"       stackId="costs" fill={COST_COLORS.wages}       name={COST_LABELS.wages}       legendType="square">
          <LabelList dataKey="wages_lbl"       position="inside" style={lblStyle} />
        </Bar>
        <Bar dataKey="advertising" stackId="costs" fill={COST_COLORS.advertising} name={COST_LABELS.advertising} legendType="square">
          <LabelList dataKey="advertising_lbl" position="inside" style={lblStyle} />
        </Bar>
        <Bar dataKey="rent"        stackId="costs" fill={COST_COLORS.rent}        name={COST_LABELS.rent}        legendType="square">
          <LabelList dataKey="rent_lbl"        position="inside" style={lblStyle} />
        </Bar>
        <Bar dataKey="sga"         stackId="costs" fill={COST_COLORS.sga}         name={COST_LABELS.sga}         legendType="square">
          <LabelList dataKey="sga_lbl"         position="inside" style={lblStyle} />
        </Bar>
        <Bar dataKey="cogs"        stackId="costs" fill={COST_COLORS.cogs}        name={COST_LABELS.cogs}        legendType="square">
          <LabelList dataKey="cogs_lbl"        position="inside" style={lblStyle} />
        </Bar>
        <Bar dataKey="utilities"   stackId="costs" fill={COST_COLORS.utilities}   name={COST_LABELS.utilities}   legendType="square">
          <LabelList dataKey="utilities_lbl"   position="inside" style={lblStyle} />
        </Bar>

        {/* EBITDA segment — label inside shows €Xk (Y%), revenue + YoY on top */}
        <Bar dataKey="ebitda_pos" stackId="costs" fill={COST_COLORS.ebitda_pos} name="EBITDA" legendType="square" radius={[2, 2, 0, 0]}>
          <LabelList dataKey="ebitda_lbl"  position="inside" style={{ fontSize: 9, fill: "#065f46", fontWeight: 700 }} />
          <LabelList dataKey="revenue_lbl" position="top"    style={{ fontSize: 9, fill: "#374151", fontWeight: 600 }} />
        </Bar>

        {/* SPPY Revenue dashed line */}
        <Line
          type="monotone"
          dataKey="sppyRevenue"
          stroke="#94a3b8"
          strokeDasharray="4 2"
          dot={false}
          connectNulls={false}
          name="LY Revenue"
          legendType="plainline"
        />

        {/* SPPY EBITDA dashed line */}
        <Line
          type="monotone"
          dataKey="sppyEbitda"
          stroke="#34d399"
          strokeDasharray="4 2"
          dot={false}
          connectNulls={false}
          name="LY EBITDA"
          legendType="plainline"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Inner content ─────────────────────────────────────────────────────────────

function LongitudinalContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo:   Date;
}) {
  const dfStr = toIso(dateFrom);
  const dtStr = toIso(dateTo);

  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const [data, setData]               = useState<LongitudinalResponse | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [pageOffset, setPageOffset]   = useState(0);

  const PAGE_SIZE = granularity === "monthly" ? 12 : 13;

  // Reset page when granularity changes
  useEffect(() => { setPageOffset(0); }, [granularity]);

  // Fetch
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    const controller = new AbortController();
    const qs = new URLSearchParams({
      date_from:   dfStr,
      date_to:     dtStr,
      granularity,
    });
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
  }, [dfStr, dtStr, granularity]);

  // ── Visible periods (paging) ────────────────────────────────────────────────

  const visiblePeriods = useMemo(() => {
    if (!data) return [];
    return data.periods.slice(pageOffset, pageOffset + PAGE_SIZE);
  }, [data, pageOffset, PAGE_SIZE]);

  // Navigation label
  const navLabel = useMemo(() => {
    if (!data || data.periods.length === 0) return "";
    const start = visiblePeriods[0]?.label ?? "";
    const end   = visiblePeriods[visiblePeriods.length - 1]?.label ?? "";
    const total = data.periods.length;
    const shown = visiblePeriods.length;
    return `${start} – ${end} (${shown} of ${total} periods)`;
  }, [data, visiblePeriods]);

  // ── Summary data from LAST visible period ───────────────────────────────────

  const summaryData = useMemo((): SummaryData | null => {
    if (!data || data.periods.length === 0) return null;

    const last = data.periods[data.periods.length - 1];
    const c    = last.current;
    const s    = last.sppy;

    const first = data.periods[0];
    const periodLabel = data.periods.length === 1
      ? first.label
      : `${first.label} – ${last.label}`;

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

  // ── Build per-brand chart points ─────────────────────────────────────────────

  function buildBrandPoints(
    brand: "spa" | "aes" | "slim",
  ): BrandChartPoint[] {
    const fmtAmt = (v: number) => {
      const abs = Math.abs(v);
      return abs >= 1000 ? `€${(abs / 1000).toFixed(0)}k` : `€${Math.round(abs)}`;
    };

    return visiblePeriods.map((p) => {
      const bt = brand === "spa"  ? p.current.spa
               : brand === "aes"  ? p.current.aes
               : p.current.slim;

      const costs   = bt.wages + bt.advertising + bt.rent + bt.sga + bt.cogs + bt.utilities;
      const ebitda  = bt.revenue - costs;
      const ebitdaPos = Math.max(0, ebitda);

      const sppyBt = p.sppy
        ? (brand === "spa"  ? p.sppy.spa
         : brand === "aes"  ? p.sppy.aes
         : p.sppy.slim)
        : null;

      const rev = bt.revenue;

      // Segment label: "€Xk (Y%)" — blank when segment < 4% of revenue or zero
      const segLbl = (v: number) => {
        if (!v || rev <= 0) return "";
        const pct = (v / rev) * 100;
        if (pct < 4) return "";
        return `${fmtAmt(v)} (${Math.round(pct)}%)`;
      };

      // Revenue top label: "€297k (+8% vs LY)" or just "€297k"
      const sppyRev = sppyBt ? sppyBt.revenue : null;
      let revLbl = rev > 0 ? fmtAmt(rev) : "";
      if (sppyRev && sppyRev > 0 && rev > 0) {
        const delta = Math.round(((rev - sppyRev) / sppyRev) * 100);
        revLbl += ` (${delta >= 0 ? "+" : ""}${delta}% vs LY)`;
      }

      // EBITDA segment label: "€Xk (Y%)"
      const ebitdaPct = bt.ebitda_pct;
      const ebitdaLbl = rev > 0
        ? `${fmtAmt(ebitda)} (${ebitdaPct.toFixed(0)}%)`
        : "";

      return {
        label:           p.label,
        revenue:         rev,
        revenue_lbl:     revLbl,
        wages:           bt.wages,
        wages_lbl:       segLbl(bt.wages),
        advertising:     bt.advertising,
        advertising_lbl: segLbl(bt.advertising),
        rent:            bt.rent,
        rent_lbl:        segLbl(bt.rent),
        sga:             bt.sga,
        sga_lbl:         segLbl(bt.sga),
        cogs:            bt.cogs,
        cogs_lbl:        segLbl(bt.cogs),
        utilities:       bt.utilities,
        utilities_lbl:   segLbl(bt.utilities),
        ebitda,
        ebitda_pos:      ebitdaPos,
        ebitda_lbl:      ebitdaLbl,
        ebitda_neg:      0,
        ebitda_pct:      ebitdaPct,
        sppyRevenue:     sppyRev,
        sppyEbitda:      sppyBt ? sppyBt.ebitda : null,
        sppyEbitdaPct:   sppyBt ? sppyBt.ebitda_pct : null,
      };
    });
  }

  const spaPoints  = useMemo(() => buildBrandPoints("spa"),  [visiblePeriods]); // eslint-disable-line react-hooks/exhaustive-deps
  const aesPoints  = useMemo(() => buildBrandPoints("aes"),  [visiblePeriods]); // eslint-disable-line react-hooks/exhaustive-deps
  const slimPoints = useMemo(() => buildBrandPoints("slim"), [visiblePeriods]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group-level margin chart data ────────────────────────────────────────────
  const marginChartData = useMemo(() => {
    return visiblePeriods.map((p) => ({
      label:         p.label,
      ebitda_pct:    p.current.ebitda_pct,
      sppyEbitdaPct: p.sppy ? p.sppy.ebitda_pct : null,
    }));
  }, [visiblePeriods]);

  const hasPrev = pageOffset > 0;
  const hasNext = data != null && pageOffset + PAGE_SIZE < data.periods.length;

  return (
    <div className="space-y-4">

      {/* Summary Header */}
      <EbitdaSummaryHeader
        data={summaryData}
        loading={loading}
      />

      {/* Controls bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">

        {/* Granularity toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
          <button
            onClick={() => setGranularity("monthly")}
            className={
              granularity === "monthly"
                ? "px-3 py-1.5 bg-charcoal text-white"
                : "px-3 py-1.5 text-muted-foreground hover:bg-muted"
            }
          >
            Monthly
          </button>
          <button
            onClick={() => setGranularity("weekly")}
            className={
              granularity === "weekly"
                ? "px-3 py-1.5 bg-charcoal text-white"
                : "px-3 py-1.5 text-muted-foreground hover:bg-muted"
            }
          >
            Weekly
          </button>
        </div>

        {/* Period navigation */}
        {data && data.periods.length > PAGE_SIZE && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <button
              onClick={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
              disabled={!hasPrev}
              className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
            >
              &larr; Prev
            </button>
            <span className="text-center">{navLabel}</span>
            <button
              onClick={() => setPageOffset(Math.min(data.periods.length - PAGE_SIZE, pageOffset + PAGE_SIZE))}
              disabled={!hasNext}
              className="px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted"
            >
              Next &rarr;
            </button>
          </div>
        )}
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-destructive py-4">{error}</p>
      )}

      {data && visiblePeriods.length > 0 && (
        <div className="space-y-4">

          {/* Spa */}
          <ChartCard title="Spa — Cost Breakdown vs Revenue">
            <BrandChart points={spaPoints} />
          </ChartCard>

          {/* Aesthetics */}
          <ChartCard title="Aesthetics — Cost Breakdown vs Revenue">
            <BrandChart points={aesPoints} />
          </ChartCard>

          {/* Slimming */}
          <ChartCard title="Slimming — Cost Breakdown vs Revenue">
            <BrandChart points={slimPoints} />
          </ChartCard>

          {/* EBITDA Margin % */}
          <ChartCard title="EBITDA Margin %">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={marginChartData} margin={{ top: 18, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`]}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} iconType="plainline" />
                <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" label={{ value: "Target 30%", fontSize: 10, fill: "#22c55e", position: "insideTopRight" }} />
                <ReferenceLine y={0} stroke="#e5e7eb" />
                <Line
                  type="monotone"
                  dataKey="ebitda_pct"
                  stroke="#475569"
                  dot={false}
                  connectNulls={false}
                  name="EBITDA Margin %"
                  legendType="plainline"
                />
                <Line
                  type="monotone"
                  dataKey="sppyEbitdaPct"
                  stroke="#94a3b8"
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  name="LY Margin %"
                  legendType="plainline"
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
