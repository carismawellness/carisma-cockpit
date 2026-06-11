"use client";

import { notFound } from "next/navigation";
import { useMemo } from "react";
import { use } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SalesKPICard } from "@/components/sales/SalesKPICard";
import { Card } from "@/components/ui/card";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import { HOTEL_SLUG_MAP } from "@/lib/constants/spa-hotel-slugs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

const VAT_RATE = 0.18;

const DOW_LABELS: Record<number, string> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
};

const PAYMENT_COLORS: Record<string, string> = {
  "Credit Card":        "#A8C4E0",
  "Cash":               "#E5C088",
  "Hotel Room Account": "#B8C9E0",
  "Payment Center":     "#A8D4A8",
  "Open Account":       "#E5B8B0",
  "Unknown":            "#C7C4BD",
};

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${Math.round(v)}`;
}

/* ── SVG Semicircle Gauge ─────────────────────────────────────────────── */

function polarToCart(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function TargetGauge({
  current,
  target,
  color,
  label,
}: {
  current: number;
  target: number;
  color: string;
  label: string;
}) {
  const clampedPct = Math.min(Math.max(current / target, 0), 1.1);
  const pctNum     = Math.round((current / target) * 100);
  const gaugeColor = pctNum >= 100 ? "#059669" : pctNum >= 75 ? "#D97706" : "#DC2626";

  // Gauge opens upward (rainbow). Center at bottom of SVG.
  // cy is the baseline (diameter line); arc goes UP through cy-r.
  const cx = 150, cy = 140, r = 110, stroke = 22;

  // Background arc: left (9 o'clock) → right (3 o'clock) going CLOCKWISE through top (12 o'clock).
  // sweep=1 = clockwise in SVG screen coords = goes upward first. large-arc=1 for 180°.
  const bgStart = polarToCart(180, r, cx, cy);   // left  (cx-r, cy)
  const bgEnd   = polarToCart(0,   r, cx, cy);   // right (cx+r, cy)
  const bgPath  = `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 1 1 ${bgEnd.x.toFixed(1)} ${bgEnd.y.toFixed(1)}`;

  // Fill arc: from left, sweeping clockwise by (clampedPct * 180°).
  // End angle in standard math: 180° - clampedPct*180° (180→0 as pct goes 0→1).
  const clampedFill = Math.min(clampedPct, 0.999); // avoid degenerate 180° case
  const fillEndAngle = 180 - clampedFill * 180;
  const fillEnd      = polarToCart(fillEndAngle, r, cx, cy);
  const fillSweepDeg = clampedFill * 180;
  // For ≤180° clockwise arcs the swept arc is always the "small" one (≤180°), so largeArc=0
  const largeArc = fillSweepDeg > 180 ? 1 : 0;
  const fillPath = fillSweepDeg > 0.5
    ? `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${fillEnd.x.toFixed(1)} ${fillEnd.y.toFixed(1)}`
    : null;

  return (
    <div className="flex flex-col items-center">
      <svg width="300" height="175" viewBox="0 0 300 175" className="overflow-visible">
        {/* Background track */}
        <path d={bgPath} fill="none" stroke="#EDE9E2" strokeWidth={stroke} strokeLinecap="round" />
        {/* Fill */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={gaugeColor} strokeWidth={stroke} strokeLinecap="round" />
        )}
        {/* Tick at 100% (right end of arc) */}
        <circle cx={bgEnd.x} cy={bgEnd.y} r={4} fill="#9CA3AF" />

        {/* Center values — positioned in the middle of the semicircle space */}
        <text x={cx} y={cy - 36} textAnchor="middle" fontSize="26" fontWeight="700" fill="#111827" fontFamily="inherit">
          {fmtShort(current)}
        </text>
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize="11" fill="#6B7280" fontFamily="inherit">
          of {fmtShort(target)} target
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="22" fontWeight="700" fill={gaugeColor} fontFamily="inherit">
          {pctNum}%
        </text>

        {/* Arc end-point labels */}
        <text x={bgStart.x - 8} y={bgStart.y + 16} textAnchor="end" fontSize="10" fill="#9CA3AF" fontFamily="inherit">0%</text>
        <text x={bgEnd.x + 8} y={bgEnd.y + 16} textAnchor="start" fontSize="10" fill="#9CA3AF" fontFamily="inherit">100%</text>
      </svg>
      <p className="text-xs text-gray-400 -mt-1">{label}</p>
    </div>
  );
}

/* ── Custom tooltip ───────────────────────────────────────────────────── */

function EurTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtShort(p.value)}
        </p>
      ))}
    </div>
  );
}

/* ── Hotel content ────────────────────────────────────────────────────── */

function HotelContent({
  hotel,
  dateFrom,
  dateTo,
}: {
  hotel: ReturnType<typeof Object.values<(typeof HOTEL_SLUG_MAP)[string]>>[number];
  dateFrom: Date;
  dateTo: Date;
}) {
  const analytics = useSpaDeepaAnalytics(dateFrom, dateTo, hotel.locId);

  /* ── KPI totals ───────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const serviceEx = analytics.staff.reduce((s, m) => s + m.service_revenue, 0);
    const retailEx  = analytics.staff.reduce((s, m) => s + m.retail_revenue,  0);
    const totalEx   = serviceEx + retailEx;
    const discount  = analytics.discounts.find(d => d.location_id === hotel.locId);
    return {
      totalInc:   totalEx * (1 + VAT_RATE),
      serviceInc: serviceEx * (1 + VAT_RATE),
      retailInc:  retailEx * (1 + VAT_RATE),
      discountInc: (discount?.total_discount ?? 0) * (1 + VAT_RATE),
    };
  }, [analytics.staff, analytics.discounts, hotel.locId]);

  /* ── Guest mix pie ────────────────────────────────────────────────── */
  const guestMixData = useMemo(() => {
    const g = analytics.guestGroups.find(gg => gg.location_id === hotel.locId);
    if (!g) return [];
    const hotelInc    = g.hotel_revenue     * (1 + VAT_RATE);
    const nonHotelInc = g.non_hotel_revenue * (1 + VAT_RATE);
    if (hotelInc + nonHotelInc === 0) return [];
    return [
      { name: "Hotel Guests",     value: hotelInc,    color: hotel.color },
      { name: "Non-Hotel Guests", value: nonHotelInc, color: "#E5D5C3" },
    ];
  }, [analytics.guestGroups, hotel]);

  /* ── Day of week ──────────────────────────────────────────────────── */
  const dowData = useMemo(() =>
    [1, 2, 3, 4, 5, 6, 7].map(dow => {
      const pt = analytics.byDayOfWeek.find(p => p.day_of_week === dow);
      return {
        name:    DOW_LABELS[dow],
        Revenue: pt ? (pt.by_location[hotel.locId] ?? 0) : 0,
      };
    }),
    [analytics.byDayOfWeek, hotel.locId]
  );

  /* ── Hour of day ──────────────────────────────────────────────────── */
  const hourData = useMemo(() => {
    const allHours = analytics.byHourOfDay
      .filter(h => (h.by_location[hotel.locId] ?? 0) > 0)
      .map(h => h.hour);
    if (allHours.length === 0) return [];
    const minH = Math.min(...allHours);
    const maxH = Math.max(...allHours);
    return Array.from({ length: maxH - minH + 1 }, (_, i) => {
      const hour = minH + i;
      const pt   = analytics.byHourOfDay.find(h => h.hour === hour);
      return {
        name:    `${String(hour).padStart(2, "0")}:00`,
        Revenue: pt ? (pt.by_location[hotel.locId] ?? 0) : 0,
      };
    });
  }, [analytics.byHourOfDay, hotel.locId]);

  /* ── Payment types ────────────────────────────────────────────────── */
  const paymentData = useMemo(() => {
    const pbl = analytics.paymentByLocation.find(p => p.location_id === hotel.locId);
    if (!pbl) return analytics.paymentTypes.map(p => ({ name: p.type, Revenue: p.revenue * (1 + VAT_RATE) }));
    return Object.entries(pbl.payment_types)
      .map(([type, val]) => ({ name: type, Revenue: val * (1 + VAT_RATE) }))
      .sort((a, b) => b.Revenue - a.Revenue);
  }, [analytics.paymentByLocation, analytics.paymentTypes, hotel.locId]);

  /* ── Therapist chart ──────────────────────────────────────────────── */
  const therapistData = useMemo(() =>
    analytics.staff
      .map(s => {
        const serviceInc = s.service_revenue * (1 + VAT_RATE);
        const retailInc  = s.retail_revenue  * (1 + VAT_RATE);
        const totalInc   = serviceInc + retailInc;
        const retailPct  = totalInc > 0 ? Math.round((retailInc / totalInc) * 100) : 0;
        return { name: s.name, serviceInc, retailInc, retailPct, totalInc };
      })
      .filter(d => d.totalInc > 0)
      .sort((a, b) => b.totalInc - a.totalInc)
      .slice(0, 20),
    [analytics.staff]
  );

  const isLoading = analytics.isFetching;

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <>
      {/* Back nav */}
      <div className="flex items-center gap-2 mb-4">
        <Link
          href="/sales/spa"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Spa Sales
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-semibold" style={{ color: hotel.color }}>{hotel.name}</span>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading hotel data…</div>
      )}

      {/* ── Target Gauge + KPIs ── */}
      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
          <Card className="lg:col-span-2 flex items-center justify-center py-6">
            <TargetGauge
              current={kpis.totalInc}
              target={hotel.monthlyTarget}
              color={hotel.color}
              label="vs monthly revenue target"
            />
          </Card>
          <div className="lg:col-span-3 grid grid-cols-2 gap-4">
            <SalesKPICard
              label="Total Revenue"
              value={`${fmtShort(kpis.totalInc)}`}
              subtitle="inc. VAT"
            />
            <SalesKPICard
              label="Service Revenue"
              value={`${fmtShort(kpis.serviceInc)}`}
              subtitle="inc. VAT"
            />
            <SalesKPICard
              label="Retail Revenue"
              value={`${fmtShort(kpis.retailInc)}`}
              subtitle="inc. VAT"
            />
            <SalesKPICard
              label="Total Discounts"
              value={`${fmtShort(kpis.discountInc)}`}
              subtitle="given to guests"
            />
          </div>
        </div>
      )}

      {/* ── Guest Mix + Payment Type ── */}
      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Guest Mix Pie */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Guest Revenue Mix</h3>
            {guestMixData.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No guest data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={guestMixData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    dataKey="value"
                    label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${Math.round((percent ?? 0) * 100)}%`}
                    labelLine={false}
                  >
                    {guestMixData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: unknown) => fmtShort(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Payment Types */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Payment Type</h3>
            {paymentData.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No payment data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={paymentData} margin={{ top: 20, right: 24, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} width={55} />
                  <Tooltip content={<EurTooltip />} />
                  <Bar dataKey="Revenue" radius={[4, 4, 0, 0]}>
                    {paymentData.map((entry, i) => (
                      <Cell key={i} fill={PAYMENT_COLORS[entry.name] ?? "#C7C4BD"} />
                    ))}
                    <LabelList
                      dataKey="Revenue"
                      position="top"
                      formatter={(v: unknown) => fmtShort(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}

      {/* ── Day of Week + Hour of Day (side by side) ── */}
      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Day of Week</h3>
            {dowData.every(d => d.Revenue === 0) ? (
              <p className="text-xs text-gray-400 py-8 text-center">No day-of-week data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dowData} margin={{ top: 20, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} width={50} />
                  <Tooltip content={<EurTooltip />} />
                  <Bar dataKey="Revenue" fill={hotel.color} radius={[4, 4, 0, 0]}>
                    <LabelList
                      dataKey="Revenue"
                      position="top"
                      formatter={(v: unknown) => Number(v) > 0 ? fmtShort(Number(v)) : ""}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Time of Day</h3>
            {hourData.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No time-of-day data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourData} margin={{ top: 20, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} width={50} />
                  <Tooltip content={<EurTooltip />} />
                  <Bar dataKey="Revenue" fill={hotel.color} radius={[4, 4, 0, 0]} opacity={0.85}>
                    <LabelList
                      dataKey="Revenue"
                      position="top"
                      formatter={(v: unknown) => Number(v) > 0 ? fmtShort(Number(v)) : ""}
                      style={{ fontSize: 9, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      )}

      {/* ── Therapist Chart ── */}
      {!isLoading && therapistData.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Therapist</h3>
          <ResponsiveContainer width="100%" height={Math.max(280, therapistData.length * 34)}>
            <BarChart
              data={therapistData}
              layout="vertical"
              margin={{ top: 4, right: 100, left: 120, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtShort(v)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={115} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = therapistData.find(t => t.name === label);
                  if (!d) return null;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
                      <p className="font-semibold text-gray-700 mb-1">{label}</p>
                      <p style={{ color: "#897B5E" }}>Service: {fmtShort(d.serviceInc)}</p>
                      <p style={{ color: "#E5C088" }}>Retail: {fmtShort(d.retailInc)} ({d.retailPct}%)</p>
                      <p className="text-gray-600 font-semibold">Total: {fmtShort(d.totalInc)}</p>
                    </div>
                  );
                }}
              />
              {/* Service bar (bottom) */}
              <Bar dataKey="serviceInc" name="Service" stackId="rev" fill="#897B5E" radius={[0, 0, 0, 0]}>
              </Bar>
              {/* Retail bar (top) with % label inside */}
              <Bar dataKey="retailInc" name="Retail" stackId="rev" fill="#E5C088" radius={[0, 4, 4, 0]}>
                <LabelList
                  dataKey="retailPct"
                  position="insideRight"
                  content={(lp: unknown) => {
                    const p = lp as { x?: number; y?: number; width?: number; height?: number; value?: number; index?: number };
                    const entry = therapistData[p.index ?? 0];
                    if (!entry || entry.retailInc < 200) return null;
                    const cx = (p.x ?? 0) + (p.width ?? 0) / 2;
                    const cy = (p.y ?? 0) + (p.height ?? 0) / 2;
                    return (
                      <text key={`rpct-${p.index}`} x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#92600A">
                        {entry.retailPct}%
                      </text>
                    );
                  }}
                />
                {/* Total + label on the right edge */}
                <LabelList
                  dataKey="totalInc"
                  position="right"
                  content={(lp: unknown) => {
                    const p = lp as { x?: number; y?: number; width?: number; height?: number; value?: number; index?: number };
                    const entry = therapistData[p.index ?? 0];
                    if (!entry) return null;
                    const rx  = (p.x ?? 0) + (p.width ?? 0) + 6;
                    const cy  = (p.y ?? 0) + (p.height ?? 0) / 2;
                    return (
                      <text key={`tot-${p.index}`} x={rx} y={cy + 4} textAnchor="start" fontSize={10} fontWeight={600} fill="#374151">
                        {fmtShort(entry.totalInc)}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </>
  );
}

/* ── Page export ─────────────────────────────────────────────────────── */

export default function HotelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const hotel = HOTEL_SLUG_MAP[slug];
  if (!hotel) notFound();

  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <HotelContent hotel={hotel} dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
