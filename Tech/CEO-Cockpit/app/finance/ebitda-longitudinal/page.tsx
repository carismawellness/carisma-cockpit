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

// ── Group EBITDA chart ────────────────────────────────────────────────────────

const BRAND_EBITDA_COLORS = {
  spa:  "#475569",
  aes:  "#d97706",
  slim: "#0d9488",
};

interface GroupChartPoint {
  label:            string;
  spa_ebitda:       number;
  aes_ebitda:       number;
  slim_ebitda:      number;
  spa_lbl:          string;
  aes_lbl:          string;
  slim_lbl:         string;
  group_ebitda_pct: number;
  // tooltip
  spa_revenue:      number;
  spa_ebitda_pct:   number;
  aes_revenue:      number;
  aes_ebitda_pct:   number;
  slim_revenue:     number;
  slim_ebitda_pct:  number;
  group_revenue:    number;
  group_ebitda:     number;
}

function GroupEbitdaTooltip({
  active,
  payload,
  label,
}: {
  active?:  boolean;
  payload?: { payload: GroupChartPoint }[];
  label?:   string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  const fmt = (v: number) => {
    const abs = Math.abs(v);
    const s   = v < 0 ? "-" : "";
    return abs >= 1000 ? `${s}€${(abs / 1000).toFixed(1)}k` : `${s}€${Math.round(abs)}`;
  };

  const rows: { color: string; label: string; ebitda: number; pct: number; rev: number }[] = [
    { color: BRAND_EBITDA_COLORS.spa,  label: "Spa",        ebitda: pt.spa_ebitda,  pct: pt.spa_ebitda_pct,  rev: pt.spa_revenue  },
    { color: BRAND_EBITDA_COLORS.aes,  label: "Aesthetics", ebitda: pt.aes_ebitda,  pct: pt.aes_ebitda_pct,  rev: pt.aes_revenue  },
    { color: BRAND_EBITDA_COLORS.slim, label: "Slimming",   ebitda: pt.slim_ebitda, pct: pt.slim_ebitda_pct, rev: pt.slim_revenue },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs space-y-1.5 min-w-[210px]">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4">
          <span style={{ color: r.color }} className="font-medium">{r.label}</span>
          <span className="tabular-nums text-gray-700">
            {fmt(r.ebitda)} <span className="text-gray-400">({r.pct.toFixed(1)}%)</span>
          </span>
        </div>
      ))}
      <div className="border-t border-gray-100 pt-1 flex justify-between gap-4 font-semibold">
        <span className="text-gray-600">Group</span>
        <span className="tabular-nums">
          {fmt(pt.group_ebitda)} <span className="text-emerald-600">({pt.group_ebitda_pct.toFixed(1)}%)</span>
        </span>
      </div>
      <div className="flex justify-between gap-4 text-gray-400 text-[10px]">
        <span>Group Revenue</span>
        <span className="tabular-nums">{fmt(pt.group_revenue)}</span>
      </div>
    </div>
  );
}

function GroupEbitdaChart({ points, width }: { points: GroupChartPoint[]; width: number }) {
  const fmtEuro = (v: number) =>
    Math.abs(v) >= 1000 ? "€" + (v / 1000).toFixed(0) + "k" : "€" + v;

  const lblStyle = { fontSize: 9, fill: "#fff", fontWeight: 700 };

  return (
    <div style={{ width, height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={points} margin={{ top: 18, right: 48, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="left"
          tickFormatter={fmtEuro}
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 10, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={36}
          domain={[0, "auto"]}
        />
        <Tooltip content={<GroupEbitdaTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} iconType="square" />

        <Bar yAxisId="left" dataKey="spa_ebitda"  stackId="ebitda" fill={BRAND_EBITDA_COLORS.spa}  name="Spa EBITDA"        legendType="square">
          <LabelList dataKey="spa_lbl"  position="inside" style={lblStyle} />
        </Bar>
        <Bar yAxisId="left" dataKey="aes_ebitda"  stackId="ebitda" fill={BRAND_EBITDA_COLORS.aes}  name="Aesthetics EBITDA" legendType="square">
          <LabelList dataKey="aes_lbl"  position="inside" style={lblStyle} />
        </Bar>
        <Bar yAxisId="left" dataKey="slim_ebitda" stackId="ebitda" fill={BRAND_EBITDA_COLORS.slim} name="Slimming EBITDA"   legendType="square" radius={[3, 3, 0, 0]}>
          <LabelList dataKey="slim_lbl" position="inside" style={lblStyle} />
        </Bar>

        <Line
          yAxisId="right"
          type="monotone"
          dataKey="group_ebitda_pct"
          stroke="#22c55e"
          strokeWidth={2}
          dot={{ r: 3, fill: "#22c55e" }}
          connectNulls={false}
          name="Group Margin %"
          legendType="plainline"
        />
        <ReferenceLine yAxisId="right" y={30} stroke="#22c55e" strokeDasharray="4 4"
          label={{ value: "Target 30%", fontSize: 9, fill: "#22c55e", position: "insideTopRight" }} />
      </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

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

function BrandChart({ points, width }: { points: BrandChartPoint[]; width: number }) {
  const fmtEuro = (v: number) =>
    Math.abs(v) >= 1000 ? "€" + (v / 1000).toFixed(0) + "k" : "€" + v;

  const lblStyle = { fontSize: 9, fill: "#fff", fontWeight: 600 };

  return (
    <div style={{ width, height: 400 }}>
    <ResponsiveContainer width="100%" height="100%">
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
    </div>
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

  // ── Visible periods (all) ───────────────────────────────────────────────────

  const visiblePeriods = useMemo(() => {
    if (!data) return [];
    return data.periods;
  }, [data]);

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
      groupRevenue:    c.revenue,
      groupEbitda:     c.ebitda,
      spaRevenue:      c.spa.revenue,
      spaEbitda:       c.spa.ebitda,
      spaLapisRevenue: 0,  // not available in longitudinal data
      aesRevenue:      c.aes.revenue,
      aesEbitda:       c.aes.ebitda,
      slimRevenue:     c.slim.revenue,
      slimEbitda:      c.slim.ebitda,
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

  // ── Group EBITDA stacked chart data ─────────────────────────────────────────
  const groupPoints = useMemo((): GroupChartPoint[] => {
    const fmtAmt = (v: number) => {
      const abs = Math.abs(v);
      return abs >= 1000 ? `€${(abs / 1000).toFixed(0)}k` : `€${Math.round(abs)}`;
    };

    return visiblePeriods.map((p) => {
      const spa  = p.current.spa;
      const aes  = p.current.aes;
      const slim = p.current.slim;

      const spaEbitda  = spa.ebitda;
      const aesEbitda  = aes.ebitda;
      const slimEbitda = slim.ebitda;

      const segLbl = (ebitda: number, revenue: number, pct: number) => {
        if (!revenue || !ebitda) return "";
        const stack = Math.max(0, spaEbitda) + Math.max(0, aesEbitda) + Math.max(0, slimEbitda);
        if (stack <= 0 || ebitda / stack < 0.06) return "";
        return `${fmtAmt(ebitda)} (${pct.toFixed(0)}%)`;
      };

      const groupRev    = p.current.revenue;
      const groupEbitda = p.current.ebitda;

      return {
        label:            p.label,
        spa_ebitda:       Math.max(0, spaEbitda),
        aes_ebitda:       Math.max(0, aesEbitda),
        slim_ebitda:      Math.max(0, slimEbitda),
        spa_lbl:          segLbl(spaEbitda,  spa.revenue,  spa.ebitda_pct),
        aes_lbl:          segLbl(aesEbitda,  aes.revenue,  aes.ebitda_pct),
        slim_lbl:         segLbl(slimEbitda, slim.revenue, slim.ebitda_pct),
        group_ebitda_pct: p.current.ebitda_pct,
        spa_revenue:      spa.revenue,
        spa_ebitda_pct:   spa.ebitda_pct,
        aes_revenue:      aes.revenue,
        aes_ebitda_pct:   aes.ebitda_pct,
        slim_revenue:     slim.revenue,
        slim_ebitda_pct:  slim.ebitda_pct,
        group_revenue:    groupRev,
        group_ebitda:     groupEbitda,
      };
    });
  }, [visiblePeriods]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group-level margin chart data ────────────────────────────────────────────
  const marginChartData = useMemo(() => {
    return visiblePeriods.map((p) => ({
      label:         p.label,
      ebitda_pct:    p.current.ebitda_pct,
      sppyEbitdaPct: p.sppy ? p.sppy.ebitda_pct : null,
    }));
  }, [visiblePeriods]);

  const chartWidth = Math.max(800, visiblePeriods.length * 80);

  return (
    <div className="space-y-4">

      {/* Summary Header */}
      <EbitdaSummaryHeader
        data={summaryData}
        loading={loading}
      />

      {/* Controls bar */}
      <div className="flex items-center gap-4 flex-wrap">

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

      </div>

      {loading && (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-destructive py-4">{error}</p>
      )}

      {data && visiblePeriods.length > 0 && (
        <div className="space-y-4">

          {/* Group EBITDA by Brand */}
          <ChartCard title="Group EBITDA by Brand — Monthly">
            <div className="overflow-x-auto">
              <GroupEbitdaChart points={groupPoints} width={chartWidth} />
            </div>
          </ChartCard>

          {/* Spa */}
          <ChartCard title="Spa — Cost Breakdown vs Revenue">
            <div className="overflow-x-auto">
              <BrandChart points={spaPoints} width={chartWidth} />
            </div>
          </ChartCard>

          {/* Aesthetics */}
          <ChartCard title="Aesthetics — Cost Breakdown vs Revenue">
            <div className="overflow-x-auto">
              <BrandChart points={aesPoints} width={chartWidth} />
            </div>
          </ChartCard>

          {/* Slimming */}
          <ChartCard title="Slimming — Cost Breakdown vs Revenue">
            <div className="overflow-x-auto">
              <BrandChart points={slimPoints} width={chartWidth} />
            </div>
          </ChartCard>

          {/* EBITDA Margin % */}
          <ChartCard title="EBITDA Margin %">
            <div className="overflow-x-auto">
            <div style={{ width: chartWidth, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
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
            </div>
            </div>
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
