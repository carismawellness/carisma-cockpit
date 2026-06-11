// components/sales/SpaDeepaInsights.tsx
//
// Five new chart sections for the Spa sales page, all driven by the extended
// /api/cockpit/spa-analytics payload (parsed in useSpaDeepaAnalytics):
//
//   1. <SpaDayOfWeekChart />      — sales by day-of-week, line per club
//   2. <SpaHourOfDayChart />      — sales by service-start hour, line per club
//   3. <SpaTherapistChart />      — therapist utilization (revenue per Column G employee)
//   4. <SpaDiscountByClubSection />     — discount € + % by club (paired bar charts)
//   5. <SpaComplimentaryByClubSection /> — complimentary € + % by club (Payment Type = "Payment Center")
//
// Each section is a self-contained Card. Spa page imports + drops them in.

"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { BRAND } from "@/lib/constants/design-tokens";
import { SPA_LOCATION_PALETTE } from "@/lib/constants/spa-locations";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
  ResponsiveContainer,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Cell,
} from "recharts";
import type {
  DowByLocationPoint,
  HourByLocationPoint,
  TherapistRow,
  DiscountLocation,
  ComplimentaryLocation,
} from "@/lib/hooks/useSpaDeepaAnalytics";

// SPA_LOCATION_PALETTE imported from canonical source above.

const ACTIVE_LOC_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

function fmtFull(v: number): string {
  return `€${Math.round(v).toLocaleString()}`;
}

function fmtHour(h: number): string {
  // 13 → "1pm", 0 → "12am". Keep it tight for X-axis ticks.
  if (h === 0)  return "12a";
  if (h < 12)   return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function SectionCard({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 md:p-6 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </Card>
  );
}

function EmptyState({ msg = "No data for the selected period" }: { msg?: string }) {
  return (
    <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
      {msg}
    </div>
  );
}

// ── 1. Sales by day of week × club ───────────────────────────────────────────

export function SpaDayOfWeekChart({ data }: { data: DowByLocationPoint[] }) {
  const presentLocs = useMemo(() => {
    const set = new Set<number>();
    for (const p of data) for (const k of Object.keys(p.by_location)) set.add(+k);
    return ACTIVE_LOC_IDS.filter((id) => set.has(id));
  }, [data]);

  const chartData = useMemo(() => data.map((p) => {
    const row: Record<string, number | string> = { day: p.day_label };
    for (const id of presentLocs) row[`loc_${id}`] = p.by_location[id] ?? 0;
    return row;
  }), [data, presentLocs]);

  const hasAnyData = presentLocs.length > 0 && chartData.some((r) => presentLocs.some((id) => Number(r[`loc_${id}`] ?? 0) > 0));

  return (
    <SectionCard
      title="Sales by day of week, by club"
      subtitle="Gross (inc-VAT) revenue split by club across the week — weekly demand pattern"
    >
      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <div className="h-[300px] md:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#374151" }} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={60} />
              <Tooltip formatter={(v: unknown, name) => [fmtFull(Number(v)), String(name ?? "")]} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" iconSize={10} />
              {presentLocs.map((id) => {
                const meta = SPA_LOCATION_PALETTE[id];
                if (!meta) return null;
                return (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={`loc_${id}`}
                    name={meta.name}
                    stroke={meta.color}
                    strokeWidth={2.2}
                    dot={{ r: 3, fill: meta.color, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}

// ── 2. Sales by hour of day × club ───────────────────────────────────────────

export function SpaHourOfDayChart({ data }: { data: HourByLocationPoint[] }) {
  const presentLocs = useMemo(() => {
    const set = new Set<number>();
    for (const p of data) for (const k of Object.keys(p.by_location)) set.add(+k);
    return ACTIVE_LOC_IDS.filter((id) => set.has(id));
  }, [data]);

  // Trim leading/trailing hours that are 0 across every club so the chart focuses
  // on the actual operating window (typically ~8am – 9pm).
  const trimmed = useMemo(() => {
    const isZero = (p: HourByLocationPoint) => presentLocs.every((id) => (p.by_location[id] ?? 0) === 0);
    let from = 0, to = data.length - 1;
    while (from < data.length && isZero(data[from])) from++;
    while (to > from && isZero(data[to])) to--;
    return data.slice(from, to + 1);
  }, [data, presentLocs]);

  const chartData = useMemo(() => trimmed.map((p) => {
    const row: Record<string, number | string> = { hourLabel: fmtHour(p.hour), hour: p.hour };
    for (const id of presentLocs) row[`loc_${id}`] = p.by_location[id] ?? 0;
    return row;
  }), [trimmed, presentLocs]);

  const hasAnyData = presentLocs.length > 0 && chartData.length > 0;

  return (
    <SectionCard
      title="Sales by time of day, by club"
      subtitle="Gross (inc-VAT) revenue by service-start hour — peak-hour staffing signal"
    >
      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <div className="h-[300px] md:h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fill: "#374151" }} interval={0} />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={60} />
              <Tooltip formatter={(v: unknown, name) => [fmtFull(Number(v)), String(name ?? "")]} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" iconSize={10} />
              {presentLocs.map((id) => {
                const meta = SPA_LOCATION_PALETTE[id];
                if (!meta) return null;
                return (
                  <Line
                    key={id}
                    type="monotone"
                    dataKey={`loc_${id}`}
                    name={meta.name}
                    stroke={meta.color}
                    strokeWidth={2.2}
                    dot={{ r: 2, fill: meta.color, strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}

// ── 3. Therapist utilization ─────────────────────────────────────────────────

export function SpaTherapistChart({
  data,
  topN,
}: { data: TherapistRow[]; topN?: number }) {
  const ranked = useMemo(() => {
    const filtered = data.filter((t) => t.revenue > 0);
    const sliced   = typeof topN === "number" ? filtered.slice(0, topN) : filtered;
    return sliced.map((t) => ({ ...t, label: t.therapist }));
  }, [data, topN]);

  // Scale typography / chart height so 60+ therapists still fit.
  const n          = ranked.length;
  const tickFont   = n > 40 ? 9 : n > 25 ? 10 : 11;
  const labelFont  = n > 40 ? 9 : 10;
  const axisAngle  = n > 25 ? -45 : -35;
  const bottomPad  = n > 40 ? 110 : n > 25 ? 96 : 80;
  const chartH     = Math.max(420, Math.min(560, 360 + n * 4));

  const subtitleSuffix = typeof topN === "number" && filteredCount(data) > topN
    ? `· top ${ranked.length}`
    : `· all ${ranked.length}`;

  return (
    <SectionCard
      title="Therapist utilization"
      subtitle={`Gross revenue per therapist (Cockpit "Service - Spa" Column G) ${subtitleSuffix}`}
    >
      {ranked.length === 0 ? (
        <EmptyState msg="No therapist data — Column G empty for the selected period." />
      ) : (
        <div style={{ height: chartH }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ranked} margin={{ top: 28, right: 16, left: 12, bottom: bottomPad }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: tickFont, fill: "#374151" }}
                angle={axisAngle}
                textAnchor="end"
                interval={0}
                height={bottomPad - 8}
              />
              <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={60} />
              <Tooltip
                formatter={(v: unknown, name) => {
                  if (name === "revenue") return [fmtFull(Number(v)), "Revenue (inc-VAT)"];
                  return [String(v), String(name ?? "")];
                }}
                cursor={{ fill: "rgba(0,0,0,0.03)" }}
              />
              <Bar dataKey="revenue" name="Revenue (inc-VAT)" fill={BRAND.spa.dark} radius={[3, 3, 0, 0]} maxBarSize={42}>
                <LabelList
                  dataKey="revenue"
                  position="top"
                  formatter={(v: unknown) => fmtK(Number(v))}
                  style={{ fontSize: labelFont, fontWeight: 600, fill: "#111827" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}

function filteredCount(data: TherapistRow[]): number {
  let c = 0;
  for (const t of data) if (t.revenue > 0) c++;
  return c;
}

// ── 4. Discount by club (€ + %) ──────────────────────────────────────────────

export function SpaDiscountByClubSection({ data }: { data: DiscountLocation[] }) {
  const rows = useMemo(
    () => data
      .filter((d) => d.total_txn_count > 0)
      .map((d) => ({
        name:           d.name,
        color:          SPA_LOCATION_PALETTE[d.location_id]?.color ?? d.color,
        totalDiscount:  Math.round(d.total_discount * (1 + 0.18)),  // ex→inc for consistency
        discountPct:    +d.discount_pct.toFixed(2),
      }))
      .sort((a, b) => b.totalDiscount - a.totalDiscount),
    [data],
  );

  if (rows.length === 0) {
    return (
      <SectionCard title="Discount analysis by club" subtitle="Discount € given + % of revenue, per location">
        <EmptyState />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Discount analysis by club"
      subtitle="Discount € given + % of revenue, per location · Gross (inc-VAT)"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Discount € */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Discount €</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 24, right: 12, left: 4, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} angle={-25} textAnchor="end" interval={0} height={48} />
                <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
                <Tooltip formatter={(v: unknown) => [fmtFull(Number(v)), "Discount"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="totalDiscount" name="Discount €" radius={[3, 3, 0, 0]} maxBarSize={44}>
                  {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="totalDiscount"
                    position="top"
                    formatter={(v: unknown) => fmtK(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Discount % */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Discount % of revenue</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 24, right: 12, left: 4, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} angle={-25} textAnchor="end" interval={0} height={48} />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fontSize: 11, fill: "#6b7280" }} width={44} />
                <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "Discount % of revenue"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="discountPct" name="Discount %" radius={[3, 3, 0, 0]} maxBarSize={44}>
                  {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="discountPct"
                    position="top"
                    formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ── 5. Complimentary by club (€ + %) ─────────────────────────────────────────

export function SpaComplimentaryByClubSection({ data }: { data: ComplimentaryLocation[] }) {
  const rows = useMemo(
    () => data
      .filter((c) => c.complimentary_revenue > 0)
      .map((c) => ({
        name:                 c.name,
        color:                SPA_LOCATION_PALETTE[c.location_id]?.color ?? c.color,
        complimentary:        Math.round(c.complimentary_revenue),
        complimentaryPct:     +c.complimentary_pct.toFixed(2),
      }))
      .sort((a, b) => b.complimentary - a.complimentary),
    [data],
  );

  if (rows.length === 0) {
    return (
      <SectionCard
        title="Complimentary by club"
        subtitle='Payment Type === "Payment Center" — services given on the house'
      >
        <EmptyState msg='No "Payment Center" transactions in the selected period.' />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Complimentary by club"
      subtitle='Payment Type === "Payment Center" · Gross (inc-VAT)'
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Complimentary € */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Complimentary €</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 24, right: 12, left: 4, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} angle={-25} textAnchor="end" interval={0} height={48} />
                <YAxis tickFormatter={(v) => fmtK(Number(v))} tick={{ fontSize: 11, fill: "#6b7280" }} width={56} />
                <Tooltip formatter={(v: unknown) => [fmtFull(Number(v)), "Complimentary"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="complimentary" name="Complimentary €" radius={[3, 3, 0, 0]} maxBarSize={44}>
                  {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="complimentary"
                    position="top"
                    formatter={(v: unknown) => fmtK(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Complimentary % */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Complimentary % of revenue</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 24, right: 12, left: 4, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} angle={-25} textAnchor="end" interval={0} height={48} />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fontSize: 11, fill: "#6b7280" }} width={44} />
                <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "Complimentary % of revenue"]} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                <Bar dataKey="complimentaryPct" name="Complimentary %" radius={[3, 3, 0, 0]} maxBarSize={44}>
                  {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="complimentaryPct"
                    position="top"
                    formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#111827" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
