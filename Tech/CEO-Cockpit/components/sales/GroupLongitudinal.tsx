// components/sales/GroupLongitudinal.tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ComposedChart, Bar, Line,
  LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GroupMonthlyPoint } from "@/lib/hooks/useGroupRevenue";
import type { GroupForecast, BrandForecastPoint } from "@/lib/analytics/revenue-forecast";
import { BRAND, LY_OVERLAY } from "@/lib/constants/design-tokens";

// 8 warm/earth tones with real contrast — chosen so neighboring hotel segments
// are visibly distinct even when small (which the cream gradient wasn't).
// Stable per hotel so identity persists across charts and across periods.
const SPA_LOCATION_PALETTE: Record<string, string> = {
  Inter:     "#3D2D1A",  // deep espresso
  Hyatt:     "#7A3F35",  // burgundy
  Excelsior: "#A0522D",  // sienna
  Ramla:     "#8C7A5A",  // canonical Spa tan
  Hugos:     "#C49862",  // caramel
  Riviera:   "#D9B98C",  // warm sand
  Odycy:     "#7E8055",  // olive
  Novotel:   "#E8D9B9",  // palest cream
};
// Render order = stack order (bottom → top). Sorted so adjacent stacked
// segments have maximum visual contrast.
const SPA_HOTEL_ORDER = ["Inter", "Excelsior", "Hyatt", "Hugos", "Ramla", "Odycy", "Riviera", "Novotel"];

// White text on these darker fills reads cleanly; dark text needed on the lighter ones.
const LIGHT_HOTEL_FILLS = new Set(["Hugos", "Riviera", "Novotel"]);

const LY_TOTAL_LINE = LY_OVERLAY; // neutral gray for LY trajectory overlay

// Forecast styling — gold accent (design-tokens) for the dotted projection
// line + "remainder to projection" ghost; brand bars go translucent + dashed.
const FORECAST_ACCENT = "#B79E61";
const FORECAST_LABEL  = "#8A7744"; // goldDark — ƒ labels above forecast columns
const FORECAST_FILL_OPACITY = 0.35;

function fmtK(v: number) {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function fmtG(g: number) {
  return `${g >= 0 ? "+" : ""}${(g * 100).toFixed(1)}%`;
}

// Human-readable method line for forecast tooltips, e.g. "Spa: LY × (1+8.2%)".
function brandMethodNote(name: string, p: BrandForecastPoint): string {
  if (p.method === "seasonal") return `${name}: LY × (1${fmtG(p.assumptions.g)})`;
  if (p.method === "blend")    return `${name}: run-rate blend, g ${fmtG(p.assumptions.g)}`;
  return p.assumptions.mtd !== null
    ? `${name}: MTD run-rate (no LY)`
    : `${name}: trailing avg (no LY)`;
}

// Tooltip that understands forecast columns: filters out anchor/zero series,
// and appends projected total + method/growth assumptions on forecast months.
type TooltipEntry = {
  dataKey?: string | number;
  name?:    string | number;
  value?:   number | string;
  color?:   string;
  fill?:    string;
  payload?: Record<string, unknown>;
};

function ForecastAwareTooltip({
  active, payload, label,
}: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | { isForecast?: boolean; isCurrentMonth?: boolean; fc_total?: number | null; fcNote?: string[] }
    | undefined;

  const items = payload.filter((e) => {
    const dk = String(e.dataKey ?? "");
    if (dk === "_anchor" || dk === "fc_anchor" || dk === "fc_line") return false;
    const v = Number(e.value);
    return Number.isFinite(v) && v !== 0;
  });

  const showProjection = (row?.isForecast || row?.isCurrentMonth) && row?.fc_total != null;

  return (
    <div className="rounded-md border border-border bg-white px-3 py-2 shadow-sm text-xs space-y-0.5">
      <p className="font-semibold text-foreground">
        {label}{row?.isForecast ? " · Forecast" : ""}
      </p>
      {items.map((e, i) => (
        <p key={i} className="tabular-nums" style={{ color: e.color ?? e.fill ?? "#374151" }}>
          {String(e.name ?? "")}: <span className="font-medium">{fmtK(Number(e.value))}</span>
        </p>
      ))}
      {showProjection && (
        <p className="pt-1 mt-1 border-t border-border font-semibold text-foreground tabular-nums">
          Projected total: {fmtK(Number(row?.fc_total))}
        </p>
      )}
      {(row?.fcNote ?? []).map((n, i) => (
        <p key={`note-${i}`} className="italic text-muted-foreground">{n}</p>
      ))}
    </div>
  );
}

function monthLabel(m: string) {
  // YYYY-MM-01 → "Jan 25" style. Parse as UTC to avoid timezone shift.
  const [yearStr, monthStr] = m.split("-");
  const year  = Number(yearStr);
  const month = Number(monthStr) - 1;
  const d = new Date(Date.UTC(year, month, 1));
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

interface Props {
  monthly:    GroupMonthlyPoint[];
  /** Forward projection (current month → Dec). Optional + additive — chart renders identically without it. */
  forecast?:  GroupForecast | null;
  isFetching: boolean;
}

export function GroupLongitudinal({ monthly, forecast, isFetching }: Props) {
  const [view, setView] = useState<"bars" | "lines">("bars");
  const [spaExpanded, setSpaExpanded] = useState(false);

  // Expand is meaningful only in Monthly Bars view AND only when per-location data is present.
  const hasLocationData = monthly.some((p) => p.spa_by_location && Object.keys(p.spa_by_location).length > 0);
  const expanded = spaExpanded && view === "bars" && hasLocationData;

  if (isFetching) {
    return (
      <Card className="p-6 h-64 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
        Loading trend data…
      </Card>
    );
  }

  if (!monthly.length) {
    return (
      <Card className="p-6 h-40 flex items-center justify-center text-sm text-muted-foreground">
        No longitudinal data available.
      </Card>
    );
  }

  const latest = monthly[monthly.length - 1];
  const yoyDelta = latest && latest.total_ly > 0
    ? ((latest.total - latest.total_ly) / latest.total_ly * 100)
    : null;

  // Derive year suffixes from the data so labels stay correct over time.
  const curYearTwo = monthly[monthly.length - 1].month.substring(2, 4); // "YY" of latest current month
  const lyYearTwo  = monthly[monthly.length - 1].ly_month.substring(2, 4);

  // Treat 0 LY (all three brands zero) as a data gap so the dashed line shows
  // a hole instead of a misleading flat-zero stretch. Months before our LY
  // backfill exists fall into this category.
  const nullIfEmpty = (v: number, ...others: number[]) => {
    const allZero = v === 0 && others.every((o) => o === 0);
    return allZero ? null : v;
  };

  // ---- Forecast wiring (additive overlay; actual series untouched) ----
  const lastActualMonth = monthly[monthly.length - 1].month;
  const fcCurrent = forecast?.months.find((m) => m.isCurrentMonth && m.month === lastActualMonth) ?? null;
  const fcFuture  = (forecast?.months ?? []).filter((m) => !m.isCurrentMonth);
  const hasForecast = fcCurrent !== null || fcFuture.length > 0;
  const todayLabel  = monthLabel(lastActualMonth);

  const actualRows = monthly.map((p, i) => {
    const byLoc = p.spa_by_location ?? {};
    const hotelFields: Record<string, number> = {};
    for (const name of SPA_HOTEL_ORDER) {
      hotelFields[`spa_${name}`] = byLoc[name] ?? 0;
    }
    // Current (partial) month: actual MTD stays solid; the gap up to the
    // projection renders as a translucent dashed "ghost" extension on top.
    const isCurrentMonth = i === monthly.length - 1 && fcCurrent !== null;
    const isPreForecast  = i === monthly.length - 2 && fcCurrent !== null; // dotted-line connection point
    const ghost = isCurrentMonth ? Math.max(0, fcCurrent!.forecastTotal - p.total) : 0;
    return {
      label:         monthLabel(p.month),
      spa:           p.spa,
      aesthetics:    p.aesthetics,
      slimming:      p.slimming,
      spa_ly:        nullIfEmpty(p.spa_ly,        p.aesthetics_ly, p.slimming_ly),
      aesthetics_ly: nullIfEmpty(p.aesthetics_ly, p.spa_ly,        p.slimming_ly),
      slimming_ly:   nullIfEmpty(p.slimming_ly,   p.spa_ly,        p.aesthetics_ly),
      total:         p.total as number | null,
      total_ly:      (p.spa_ly + p.aesthetics_ly + p.slimming_ly) > 0 ? p.total_ly : null,
      ...hotelFields,
      // 1-euro phantom value used purely as a label anchor at the top of every
      // stacked column. Invisible visually, ignored by tooltip, but guarantees
      // a non-zero topmost bar so position="top" labels always render.
      _anchor:       p.total > 0 ? 1 : 0,
      // Forecast overlay fields (all inert on plain actual months)
      isForecast:     false,
      isCurrentMonth,
      fc_spa: 0, fc_aesthetics: 0, fc_slimming: 0,
      fc_ghost:  ghost,
      fc_anchor: ghost > 0 ? 1 : 0,
      fc_total:  isCurrentMonth ? fcCurrent!.forecastTotal : null,
      fc_line:   isCurrentMonth ? fcCurrent!.forecastTotal : isPreForecast ? p.total : null,
      fcl_spa:        isCurrentMonth ? fcCurrent!.perBrand.spa.forecast        : isPreForecast ? p.spa        : null,
      fcl_aesthetics: isCurrentMonth ? fcCurrent!.perBrand.aesthetics.forecast : isPreForecast ? p.aesthetics : null,
      fcl_slimming:   isCurrentMonth ? fcCurrent!.perBrand.slimming.forecast   : isPreForecast ? p.slimming   : null,
      fcNote: isCurrentMonth
        ? [
            ...(fcCurrent!.lyTotal != null ? [`LY same month: ${fmtK(fcCurrent!.lyTotal)}`] : []),
            brandMethodNote("Spa",        fcCurrent!.perBrand.spa),
            brandMethodNote("Aesthetics", fcCurrent!.perBrand.aesthetics),
            brandMethodNote("Slimming",   fcCurrent!.perBrand.slimming),
          ]
        : undefined,
    };
  });

  // Future months: pure forecast columns — translucent dashed brand stacks.
  const forecastRows = fcFuture.map((m) => {
    const hotelFields: Record<string, number> = {};
    for (const name of SPA_HOTEL_ORDER) hotelFields[`spa_${name}`] = 0;
    return {
      label:         monthLabel(m.month),
      spa: 0, aesthetics: 0, slimming: 0,
      spa_ly: null, aesthetics_ly: null, slimming_ly: null,
      total:    null as number | null,
      total_ly: m.lyTotal, // extends the LY overlay line through the forecast region
      ...hotelFields,
      _anchor:  0,
      isForecast:     true,
      isCurrentMonth: false,
      fc_spa:        m.perBrand.spa.forecast,
      fc_aesthetics: m.perBrand.aesthetics.forecast,
      fc_slimming:   m.perBrand.slimming.forecast,
      fc_ghost:  0,
      fc_anchor: m.forecastTotal > 0 ? 1 : 0,
      fc_total:  m.forecastTotal as number | null,
      fc_line:   m.forecastTotal as number | null,
      fcl_spa:        m.perBrand.spa.forecast as number | null,
      fcl_aesthetics: m.perBrand.aesthetics.forecast as number | null,
      fcl_slimming:   m.perBrand.slimming.forecast as number | null,
      fcNote: [
        ...(m.lyTotal != null ? [`LY same month: ${fmtK(m.lyTotal)}`] : []),
        brandMethodNote("Spa",        m.perBrand.spa),
        brandMethodNote("Aesthetics", m.perBrand.aesthetics),
        brandMethodNote("Slimming",   m.perBrand.slimming),
      ] as string[] | undefined,
    };
  });

  const chartData = [...actualRows, ...forecastRows];

  // How many of the 13 actual months are missing LY data — footer note.
  const lyGapMonths = actualRows.filter((d) => d.total_ly === null).length;

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">Revenue Over Time</h3>
          {yoyDelta !== null && (
            <span
              className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${
                yoyDelta >= 0 ? "text-emerald-700 bg-emerald-50" : "text-red-600 bg-red-50"
              }`}
            >
              Latest month: {yoyDelta >= 0 ? "+" : ""}{yoyDelta.toFixed(1)}% vs LY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {view === "bars" && hasLocationData && (
            <button
              type="button"
              onClick={() => setSpaExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Collapse Spa
                </>
              ) : (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  Expand Spa (8 hotels)
                </>
              )}
            </button>
          )}
          <Tabs value={view} onValueChange={(v) => setView(v as "bars" | "lines")}>
            <TabsList className="h-7">
              <TabsTrigger value="bars"  className="text-xs px-3 h-6">Monthly Bars</TabsTrigger>
              <TabsTrigger value="lines" className="text-xs px-3 h-6">Trend Lines</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className={expanded ? "h-[360px] md:h-[440px]" : "h-[320px] md:h-[400px]"}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "bars" ? (
            <ComposedChart
              data={chartData}
              margin={{ top: 32, right: 12, left: 12, bottom: expanded ? 12 : 4 }}
              barCategoryGap={expanded ? "10%" : "14%"}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: hasForecast ? 10 : 11, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={60} />
              <Tooltip
                content={<ForecastAwareTooltip />}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                iconType="square"
                iconSize={12}
              />
              {expanded ? (
                // 8 stacked Spa hotel segments with per-segment value labels
                SPA_HOTEL_ORDER.map((hotel) => (
                  <Bar
                    key={hotel}
                    dataKey={`spa_${hotel}`}
                    name={`Spa · ${hotel}`}
                    stackId="a"
                    fill={SPA_LOCATION_PALETTE[hotel]}
                  >
                    <LabelList
                      dataKey={`spa_${hotel}`}
                      position="center"
                      formatter={(v: unknown) => {
                        const val = Number(v);
                        // Hide labels for tiny segments that can't fit text
                        return val >= 8000 ? fmtK(val) : "";
                      }}
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        fill: LIGHT_HOTEL_FILLS.has(hotel) ? "#1f2937" : "#ffffff",
                      }}
                    />
                  </Bar>
                ))
              ) : (
                <Bar dataKey="spa" name="Spa" stackId="a" fill={BRAND.spa.soft} />
              )}
              <Bar dataKey="aesthetics" name="Aesthetics" stackId="a" fill={BRAND.aesthetics.soft}>
                {expanded && (
                  <LabelList
                    dataKey="aesthetics"
                    position="center"
                    formatter={(v: unknown) => {
                      const val = Number(v);
                      return val >= 8000 ? fmtK(val) : "";
                    }}
                    style={{ fontSize: 9, fontWeight: 700, fill: "#ffffff" }}
                  />
                )}
              </Bar>
              <Bar dataKey="slimming"   name="Slimming"   stackId="a" fill={BRAND.slimming.soft}>
                {expanded && (
                  <LabelList
                    dataKey="slimming"
                    position="center"
                    formatter={(v: unknown) => {
                      const val = Number(v);
                      return val >= 8000 ? fmtK(val) : "";
                    }}
                    style={{ fontSize: 9, fontWeight: 700, fill: "#ffffff" }}
                  />
                )}
              </Bar>
              {/* Invisible 1-euro anchor at the top of the stack. Its only job
                  is to be a non-zero topmost bar so the total LabelList below
                  always has a reliable anchor — works even when Slimming = 0. */}
              <Bar
                dataKey="_anchor"
                stackId="a"
                fill="transparent"
                legendType="none"
                isAnimationActive={false}
                radius={[3, 3, 0, 0]}
              >
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={(v: unknown) => {
                    const n = Number(v);
                    return Number.isFinite(n) && n > 0 ? fmtK(n) : "";
                  }}
                  style={{ fontSize: 11, fontWeight: 700, fill: "#111827" }}
                />
              </Bar>
              {/* Forecast region — translucent, dashed-outline brand stacks (ƒ).
                  Zero on actual months, so they share the same stack safely. */}
              {hasForecast && (
                <Bar dataKey="fc_spa" name="Spa ƒ" stackId="a" fill={BRAND.spa.soft} fillOpacity={FORECAST_FILL_OPACITY} stroke={BRAND.spa.soft} strokeWidth={1} strokeDasharray="4 3" legendType="none" isAnimationActive={false} />
              )}
              {hasForecast && (
                <Bar dataKey="fc_aesthetics" name="Aesthetics ƒ" stackId="a" fill={BRAND.aesthetics.soft} fillOpacity={FORECAST_FILL_OPACITY} stroke={BRAND.aesthetics.soft} strokeWidth={1} strokeDasharray="4 3" legendType="none" isAnimationActive={false} />
              )}
              {hasForecast && (
                <Bar dataKey="fc_slimming" name="Slimming ƒ" stackId="a" fill={BRAND.slimming.soft} fillOpacity={FORECAST_FILL_OPACITY} stroke={BRAND.slimming.soft} strokeWidth={1} strokeDasharray="4 3" legendType="none" isAnimationActive={false} />
              )}
              {/* Current partial month: ghost extension from actual MTD up to projection */}
              {hasForecast && (
                <Bar dataKey="fc_ghost" name="To projection ƒ" stackId="a" fill={FORECAST_ACCENT} fillOpacity={0.25} stroke={FORECAST_ACCENT} strokeWidth={1} strokeDasharray="4 3" legendType="none" isAnimationActive={false} />
              )}
              {/* Transparent anchor on top of forecast stacks → ƒ total labels */}
              {hasForecast && (
                <Bar dataKey="fc_anchor" stackId="a" fill="transparent" legendType="none" isAnimationActive={false}>
                  <LabelList
                    dataKey="fc_total"
                    position="top"
                    formatter={(v: unknown) => {
                      const n = Number(v);
                      return Number.isFinite(n) && n > 0 ? `ƒ ${fmtK(n)}` : "";
                    }}
                    style={{ fontSize: 11, fontWeight: 700, fill: FORECAST_LABEL, fontStyle: "italic" }}
                  />
                </Bar>
              )}
              {/* Vertical separator at the current (partial) month */}
              {hasForecast && (
                <ReferenceLine
                  x={todayLabel}
                  stroke="#9CA3AF"
                  strokeDasharray="4 4"
                  label={{ value: "Today", position: "top", fontSize: 10, fill: "#6b7280" }}
                />
              )}
              {/* Per-brand LY trajectories — thin dashed lines in each brand's
                  dark color. Lets the CEO see *which* brand drove LY changes,
                  not just the aggregate, on the same bar chart. */}
              <Line
                type="monotone"
                dataKey="spa_ly"
                name={`Spa ${lyYearTwo}`}
                stroke={BRAND.spa.dark}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="aesthetics_ly"
                name={`Aesthetics ${lyYearTwo}`}
                stroke={BRAND.aesthetics.dark}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="slimming_ly"
                name={`Slimming ${lyYearTwo}`}
                stroke={BRAND.slimming.dark}
                strokeWidth={1.5}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                dot={false}
                activeDot={{ r: 3 }}
              />
              {/* LY total trajectory overlay — neutral gray dashed line on top
                  so the aggregate stays visually distinct from the brand lines. */}
              <Line
                type="monotone"
                dataKey="total_ly"
                name="Total LY"
                stroke={LY_TOTAL_LINE}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 2.5, fill: LY_TOTAL_LINE, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
              />
              {/* Dotted gold line: actual trajectory → projected months */}
              {hasForecast && (
                <Line
                  type="monotone"
                  dataKey="fc_line"
                  name="Forecast"
                  stroke={FORECAST_ACCENT}
                  strokeWidth={2}
                  strokeDasharray="2 5"
                  strokeLinecap="round"
                  dot={{ r: 2.5, fill: FORECAST_ACCENT, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                />
              )}
            </ComposedChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
              <Tooltip
                formatter={(v: unknown, name) => [fmtK(Number(v)), String(name ?? "")]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="spa"        name={`Spa ${curYearTwo}`}        stroke={BRAND.spa.soft}        strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="aesthetics" name={`Aesthetics ${curYearTwo}`} stroke={BRAND.aesthetics.soft} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="slimming"   name={`Slimming ${curYearTwo}`}   stroke={BRAND.slimming.soft}   strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="spa_ly"        name={`Spa ${lyYearTwo}`}        stroke={BRAND.spa.soft}        strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="aesthetics_ly" name={`Aesthetics ${lyYearTwo}`} stroke={BRAND.aesthetics.soft} strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              <Line type="monotone" dataKey="slimming_ly"   name={`Slimming ${lyYearTwo}`}   stroke={BRAND.slimming.soft}   strokeWidth={1.5} strokeDasharray="4 2" strokeOpacity={0.5} dot={false} />
              {/* Dotted forecast continuations (ƒ) — connect to the actual lines at the current month */}
              {hasForecast && (
                <Line type="monotone" dataKey="fcl_spa" name="Spa ƒ" stroke={BRAND.spa.soft} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" dot={false} legendType="none" />
              )}
              {hasForecast && (
                <Line type="monotone" dataKey="fcl_aesthetics" name="Aesthetics ƒ" stroke={BRAND.aesthetics.soft} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" dot={false} legendType="none" />
              )}
              {hasForecast && (
                <Line type="monotone" dataKey="fcl_slimming" name="Slimming ƒ" stroke={BRAND.slimming.soft} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" dot={false} legendType="none" />
              )}
              {hasForecast && (
                <ReferenceLine
                  x={todayLabel}
                  stroke="#9CA3AF"
                  strokeDasharray="4 4"
                  label={{ value: "Today", position: "top", fontSize: 10, fill: "#6b7280" }}
                />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground">
        Rolling 13 months{hasForecast ? ` + forecast to Dec ${curYearTwo}` : ""} · Dashed gray line = total revenue last year, brand bars = current year
        {hasForecast && (
          <span className="ml-1 italic">
            · ƒ translucent dashed bars + dotted gold line = forecast (YoY growth applied to LY seasonality; current month blends MTD run-rate)
          </span>
        )}
        {lyGapMonths > 0 && (
          <span className="ml-1 text-amber-700">
            · LY data unavailable for {lyGapMonths} month{lyGapMonths === 1 ? "" : "s"} (gap in the dashed line)
          </span>
        )}
      </p>
    </Card>
  );
}
