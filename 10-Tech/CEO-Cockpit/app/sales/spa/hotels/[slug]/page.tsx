"use client";

import { notFound } from "next/navigation";
import { useMemo } from "react";
import { use } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSpaDeepaAnalytics } from "@/lib/hooks/useSpaDeepaAnalytics";
import { useIsAdmin } from "@/lib/hooks/useIsAdmin";
import { HOTEL_SLUG_MAP } from "@/lib/constants/spa-hotel-slugs";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell,
  PieChart, Pie, Legend,
  ReferenceLine,
} from "recharts";
import { ArrowLeft, Lock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import Link from "next/link";

// Rolling window enforced for non-admin users (mirrors API-side constant)
const HOTEL_MAX_LOOKBACK_MONTHS = 6;

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

/* ── Gamified SVG Gauge (i-gaming / casino aesthetic) ─────────────────── */

function polarToCart(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function GamifiedTargetGauge({
  current,
  target,
  color,
}: {
  current: number;
  target: number;
  color: string;
}) {
  const pct        = current / target;
  const pctNum     = Math.round(pct * 100);
  const clampedPct = Math.min(Math.max(pct, 0), 1.0);

  const isCrushed   = pctNum >= 100;
  const isAlmost    = pctNum >= 75 && pctNum < 100;
  const isGood      = pctNum >= 50 && pctNum < 75;

  const gaugeColor = isCrushed ? "#F59E0B" : isAlmost ? "#10B981" : isGood ? "#F59E0B" : "#EF4444";
  const glowColor  = isCrushed ? "#FCD34D" : isAlmost ? "#34D399" : isGood ? "#FCD34D" : "#FCA5A5";

  const subLabel = isCrushed
    ? "TARGET CRUSHED! 🎯"
    : isAlmost
    ? "Almost there! Push now 🔥"
    : isGood
    ? "Good momentum — keep going! 💪"
    : "Time to accelerate! ⚡";

  // Gauge geometry: semicircle opening upward
  const cx = 200, cy = 185, r = 150, stroke = 28;

  const bgStart = polarToCart(180, r, cx, cy);
  const bgEnd   = polarToCart(0,   r, cx, cy);
  const bgPath  = `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 1 1 ${bgEnd.x.toFixed(1)} ${bgEnd.y.toFixed(1)}`;

  const clampedFill = Math.min(clampedPct, 0.999);
  const fillEndAngle = 180 - clampedFill * 180;
  const fillEnd      = polarToCart(fillEndAngle, r, cx, cy);
  const fillSweepDeg = clampedFill * 180;
  const largeArc     = fillSweepDeg > 180 ? 1 : 0;
  const fillPath = fillSweepDeg > 0.5
    ? `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${fillEnd.x.toFixed(1)} ${fillEnd.y.toFixed(1)}`
    : null;

  // Milestone markers at 25%, 50%, 75%
  const milestones = [0.25, 0.5, 0.75];

  // Shimmer keyframe as inline style tag
  const shimmerStyle = `
    @keyframes shimmer {
      0%   { opacity: 0.7; }
      50%  { opacity: 1;   }
      100% { opacity: 0.7; }
    }
    @keyframes gaugePulse {
      0%, 100% { filter: url(#glow) brightness(1); }
      50%       { filter: url(#glow) brightness(1.4); }
    }
    .gauge-fill-pulse { animation: gaugePulse 1.5s ease-in-out infinite; }
    .shimmer-text     { animation: shimmer 2s ease-in-out infinite; }
  `;

  return (
    <div
      className="w-full rounded-2xl px-6 py-8"
      style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)" }}
    >
      <style>{shimmerStyle}</style>

      {/* Sub-label / status */}
      <div className="text-center mb-2">
        {isCrushed ? (
          <span
            className="shimmer-text inline-block text-lg font-extrabold tracking-wider uppercase px-4 py-1 rounded-full"
            style={{ color: "#F59E0B", textShadow: "0 0 20px #F59E0B88, 0 0 40px #F59E0B44" }}
          >
            {subLabel}
          </span>
        ) : (
          <span className="text-sm font-semibold" style={{ color: gaugeColor }}>
            {subLabel}
          </span>
        )}
      </div>

      {/* SVG Gauge */}
      <div className="flex justify-center">
        <svg
          width="400"
          height="220"
          viewBox="0 0 400 220"
          className="overflow-visible"
          style={{ maxWidth: "100%" }}
        >
          <defs>
            <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glowStrong" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="10" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background track */}
          <path
            d={bgPath}
            fill="none"
            stroke="#1e3a5f"
            strokeWidth={stroke}
            strokeLinecap="round"
          />

          {/* Fill arc — with glow */}
          {fillPath && (
            <path
              d={fillPath}
              fill="none"
              stroke={gaugeColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              className={isCrushed ? "gauge-fill-pulse" : undefined}
              style={
                !isCrushed
                  ? { filter: "url(#glow)" }
                  : { filter: "url(#glowStrong)", stroke: glowColor }
              }
            />
          )}

          {/* Milestone rings at 25%, 50%, 75% */}
          {milestones.map((m) => {
            const mAngle = 180 - m * 180;
            const mPt    = polarToCart(mAngle, r, cx, cy);
            const isPast = clampedPct >= m;
            return (
              <circle
                key={m}
                cx={mPt.x}
                cy={mPt.y}
                r={8}
                fill={isPast ? gaugeColor : "#334155"}
                stroke={isPast ? glowColor : "#475569"}
                strokeWidth={2}
                style={isPast ? { filter: "url(#glow)" } : undefined}
              />
            );
          })}

          {/* 100% end marker */}
          <circle
            cx={bgEnd.x}
            cy={bgEnd.y}
            r={6}
            fill={isCrushed ? "#F59E0B" : "#475569"}
            style={isCrushed ? { filter: "url(#glow)" } : undefined}
          />

          {/* Arc endpoint labels */}
          <text x={bgStart.x - 10} y={bgStart.y + 20} textAnchor="end" fontSize="11" fill="#64748b" fontFamily="inherit">0%</text>
          <text x={bgEnd.x + 10}   y={bgEnd.y + 20}   textAnchor="start" fontSize="11" fill="#64748b" fontFamily="inherit">100%</text>

          {/* Milestone % labels */}
          {milestones.map((m) => {
            const mAngle = 180 - m * 180;
            const mPt    = polarToCart(mAngle, r + 26, cx, cy);
            return (
              <text
                key={`lbl-${m}`}
                x={mPt.x}
                y={mPt.y + 4}
                textAnchor="middle"
                fontSize="10"
                fill="#475569"
                fontFamily="inherit"
              >
                {Math.round(m * 100)}%
              </text>
            );
          })}

          {/* Centre: current value */}
          <text
            x={cx}
            y={cy - 48}
            textAnchor="middle"
            fontSize="48"
            fontWeight="800"
            fill="#f8fafc"
            fontFamily="inherit"
            style={{ letterSpacing: "-1px" }}
          >
            {fmtShort(current)}
          </text>

          {/* Centre: percentage */}
          <text
            x={cx}
            y={cy - 8}
            textAnchor="middle"
            fontSize="26"
            fontWeight="700"
            fill={gaugeColor}
            fontFamily="inherit"
            style={isCrushed ? { filter: "url(#glow)" } : undefined}
          >
            {pctNum}%
          </text>

          {/* Centre: target label */}
          <text
            x={cx}
            y={cy + 18}
            textAnchor="middle"
            fontSize="12"
            fill="#64748b"
            fontFamily="inherit"
          >
            of {fmtShort(target)} target
          </text>
        </svg>
      </div>
    </div>
  );
}

/* ── KPI Bubble Card ──────────────────────────────────────────────────── */

interface KpiCardProps {
  label:      string;
  value:      string;
  subtitle:   string;
  yoyChange?: number;
  accentColor: string;
  borderColor: string;
  bgColor:     string;
  icon:        React.ReactNode;
}

function KpiCard({ label, value, subtitle, yoyChange, accentColor, borderColor, bgColor, icon }: KpiCardProps) {
  const hasYoy = yoyChange !== undefined;
  const isUp   = (yoyChange ?? 0) >= 0;
  const YoyIcon = hasYoy ? (isUp ? TrendingUp : TrendingDown) : Minus;

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-1 relative overflow-hidden"
      style={{ background: bgColor, borderLeft: `4px solid ${borderColor}` }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-1"
        style={{ background: borderColor + "22" }}
      >
        <span style={{ color: accentColor }}>{icon}</span>
      </div>

      {/* Label */}
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>

      {/* Value */}
      <p className="text-2xl font-extrabold" style={{ color: accentColor }}>{value}</p>

      {/* Subtitle */}
      <p className="text-xs text-gray-400">{subtitle}</p>

      {/* YoY */}
      {hasYoy && (
        <div
          className="flex items-center gap-1 mt-1 text-xs font-semibold"
          style={{ color: isUp ? "#10B981" : "#EF4444" }}
        >
          <YoyIcon className="w-3 h-3" />
          <span>{isUp ? "+" : ""}{yoyChange}% vs LY</span>
        </div>
      )}
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
  isAdmin,
  isClamped,
}: {
  hotel: ReturnType<typeof Object.values<(typeof HOTEL_SLUG_MAP)[string]>>[number];
  dateFrom: Date;
  dateTo: Date;
  isAdmin: boolean;
  isClamped: boolean;
}) {
  const analytics = useSpaDeepaAnalytics(dateFrom, dateTo, hotel.locId);

  /* ── Prior-year window for YoY ── */
  const priorDateFrom = useMemo(
    () => new Date(dateFrom.getFullYear() - 1, dateFrom.getMonth(), dateFrom.getDate()),
    [dateFrom]
  );
  const priorDateTo = useMemo(
    () => new Date(dateTo.getFullYear() - 1, dateTo.getMonth(), dateTo.getDate()),
    [dateTo]
  );
  const priorAnalytics = useSpaDeepaAnalytics(
    priorDateFrom,
    priorDateTo,
    isAdmin ? hotel.locId : undefined
  );

  /* ── KPI totals ── */
  const kpis = useMemo(() => {
    const serviceEx = analytics.staff.reduce((s, m) => s + m.service_revenue, 0);
    const retailEx  = analytics.staff.reduce((s, m) => s + m.retail_revenue,  0);
    const totalEx   = serviceEx + retailEx;
    const discount  = analytics.discounts.find(d => d.location_id === hotel.locId);
    const discountEx = discount?.total_discount ?? 0;

    const totalInc    = totalEx   * (1 + VAT_RATE);
    const serviceInc  = serviceEx * (1 + VAT_RATE);
    const retailInc   = retailEx  * (1 + VAT_RATE);
    const discountInc = discountEx * (1 + VAT_RATE);

    const retailPct   = totalInc > 0 ? Math.round((retailInc  / totalInc) * 100) : 0;
    const discountPct = totalInc > 0 ? Math.round((discountInc / totalInc) * 100) : 0;

    // Prior year
    const pServiceEx  = priorAnalytics.staff.reduce((s, m) => s + m.service_revenue, 0);
    const pRetailEx   = priorAnalytics.staff.reduce((s, m) => s + m.retail_revenue,  0);
    const pTotalEx    = pServiceEx + pRetailEx;
    const pDiscount   = priorAnalytics.discounts.find(d => d.location_id === hotel.locId);
    const pTotalInc   = pTotalEx   * (1 + VAT_RATE);
    const pServiceInc = pServiceEx * (1 + VAT_RATE);
    const pRetailInc  = pRetailEx  * (1 + VAT_RATE);
    const pDiscountInc = (pDiscount?.total_discount ?? 0) * (1 + VAT_RATE);

    const yoy = (curr: number, prior: number) =>
      prior > 0 ? Math.round(((curr - prior) / prior) * 100) : undefined;

    return {
      totalInc,
      serviceInc,
      retailInc,
      discountInc,
      retailPct,
      discountPct,
      yoyTotal:    yoy(totalInc,    pTotalInc),
      yoyService:  yoy(serviceInc,  pServiceInc),
      yoyRetail:   yoy(retailInc,   pRetailInc),
      yoyDiscount: yoy(discountInc, pDiscountInc),
    };
  }, [analytics.staff, analytics.discounts, priorAnalytics.staff, priorAnalytics.discounts, hotel.locId]);

  /* ── Guest mix pie ── */
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

  /* ── Day of week ── */
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

  /* ── Hour of day ── */
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

  /* ── Payment types ── */
  const paymentData = useMemo(() => {
    const pbl = analytics.paymentByLocation.find(p => p.location_id === hotel.locId);
    if (!pbl) return analytics.paymentTypes.map(p => ({ name: p.type, Revenue: p.revenue * (1 + VAT_RATE) }));
    return Object.entries(pbl.payment_types)
      .map(([type, val]) => ({ name: type, Revenue: val * (1 + VAT_RATE) }))
      .sort((a, b) => b.Revenue - a.Revenue);
  }, [analytics.paymentByLocation, analytics.paymentTypes, hotel.locId]);

  /* ── Therapist charts (split service / retail) ── */
  const serviceTherapistData = useMemo(() =>
    analytics.staff
      .filter(s => s.service_revenue > 0)
      .map(s => ({ name: s.name, service: s.service_revenue * (1 + VAT_RATE) }))
      .sort((a, b) => b.service - a.service)
      .slice(0, 15),
    [analytics.staff]
  );

  const retailTherapistData = useMemo(() =>
    analytics.staff
      .filter(s => s.retail_revenue > 0)
      .map(s => ({ name: s.name, retail: s.retail_revenue * (1 + VAT_RATE) }))
      .sort((a, b) => b.retail - a.retail)
      .slice(0, 15),
    [analytics.staff]
  );

  /* ── Top treatments ── */
  const topTreatments = useMemo(() =>
    ((analytics as unknown as { byService?: Array<{ name: string; revenue: number }> }).byService ?? [])
      .slice(0, 15)
      .map((s) => ({
        name: s.name,
        Revenue: s.revenue,
      })),
    [analytics]
  );

  const isLoading = analytics.isFetching || priorAnalytics.isFetching;

  /* ── Render ── */
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

      {/* Data restriction banner */}
      {isClamped && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div>
            <span className="font-semibold text-amber-800">Data restricted to the last {HOTEL_MAX_LOOKBACK_MONTHS} months.</span>
            <span className="text-amber-700 ml-1">
              Your earliest available date is {dateFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Contact an administrator to view older data.
            </span>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-12 text-gray-400 text-sm">Loading hotel data…</div>
      )}

      {/* ── [1] Gamified Target Gauge — full-width hero ── */}
      {!isLoading && (
        <div className="mb-6">
          <GamifiedTargetGauge
            current={kpis.totalInc}
            target={hotel.monthlyTarget}
            color={hotel.color}
          />
        </div>
      )}

      {/* ── [2] KPI Cards — 4-column grid ── */}
      {!isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Total Revenue"
            value={fmtShort(kpis.totalInc)}
            subtitle="inc. VAT"
            yoyChange={isAdmin ? kpis.yoyTotal : undefined}
            accentColor="#059669"
            borderColor="#10B981"
            bgColor="#f0fdf4"
            icon={<span className="text-base">💰</span>}
          />
          <KpiCard
            label="Service Revenue"
            value={fmtShort(kpis.serviceInc)}
            subtitle={`${Math.round((kpis.serviceInc / (kpis.totalInc || 1)) * 100)}% of total`}
            yoyChange={isAdmin ? kpis.yoyService : undefined}
            accentColor="#0284c7"
            borderColor="#38bdf8"
            bgColor="#f0f9ff"
            icon={<span className="text-base">🧴</span>}
          />
          <KpiCard
            label="Retail Revenue"
            value={fmtShort(kpis.retailInc)}
            subtitle={`${kpis.retailPct}% of total`}
            yoyChange={isAdmin ? kpis.yoyRetail : undefined}
            accentColor="#b45309"
            borderColor="#F59E0B"
            bgColor="#fffbeb"
            icon={<span className="text-base">🛍️</span>}
          />
          <KpiCard
            label="Total Discounts"
            value={fmtShort(kpis.discountInc)}
            subtitle={`${kpis.discountPct}% of total`}
            yoyChange={isAdmin ? kpis.yoyDiscount : undefined}
            accentColor="#be123c"
            borderColor="#f43f5e"
            bgColor="#fff1f2"
            icon={<span className="text-base">🏷️</span>}
          />
        </div>
      )}

      {/* ── [3] Guest Mix + Payment Types ── */}
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

      {/* ── [4] Day of Week + Hour of Day ── */}
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

      {/* ── [5] Service + Retail by Therapist (side by side) ── */}
      {!isLoading && (serviceTherapistData.length > 0 || retailTherapistData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Service Revenue by Therapist */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Service Revenue by Therapist</h3>
            {serviceTherapistData.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No service data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(280, serviceTherapistData.length * 34)}>
                <BarChart
                  data={serviceTherapistData}
                  layout="vertical"
                  margin={{ top: 4, right: 80, left: 120, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtShort(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={115} />
                  <Tooltip content={<EurTooltip />} />
                  <Bar dataKey="service" name="Service" fill={hotel.color} radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="service"
                      position="right"
                      formatter={(v: unknown) => fmtShort(Number(v))}
                      style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Retail Revenue by Therapist */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Retail Revenue by Therapist</h3>
            {retailTherapistData.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No retail data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(280, retailTherapistData.length * 34)}>
                <BarChart
                  data={retailTherapistData}
                  layout="vertical"
                  margin={{ top: 4, right: 80, left: 120, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtShort(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={115} />
                  <Tooltip content={<EurTooltip />} />
                  <ReferenceLine
                    x={800}
                    stroke="#059669"
                    strokeDasharray="4 2"
                    label={{ value: "€800 target", position: "top", fill: "#059669", fontSize: 10 }}
                  />
                  <Bar dataKey="retail" name="Retail" fill="#F59E0B" radius={[0, 4, 4, 0]}>
                    <LabelList
                      dataKey="retail"
                      position="right"
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

      {/* ── [6] Top Treatments by Revenue ── */}
      {!isLoading && (
        <Card className="p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Treatments by Revenue</h3>
          {topTreatments.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No treatment data available for this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, topTreatments.length * 34)}>
              <BarChart
                data={topTreatments}
                layout="vertical"
                margin={{ top: 4, right: 80, left: 180, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtShort(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={175} />
                <Tooltip content={<EurTooltip />} />
                <Bar dataKey="Revenue" fill={hotel.color} radius={[0, 4, 4, 0]}>
                  <LabelList
                    dataKey="Revenue"
                    position="right"
                    formatter={(v: unknown) => fmtShort(Number(v))}
                    style={{ fontSize: 10, fontWeight: 600, fill: "#374151" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}
    </>
  );
}

/* ── Date-gate wrapper ────────────────────────────────────────────────── */

function HotelDateGate({
  hotel,
  rawDateFrom,
  dateTo,
}: {
  hotel: (typeof HOTEL_SLUG_MAP)[string];
  rawDateFrom: Date;
  dateTo: Date;
}) {
  const { isAdmin, isLoaded } = useIsAdmin();

  const { dateFrom, isClamped } = useMemo(() => {
    if (!isLoaded || isAdmin) return { dateFrom: rawDateFrom, isClamped: false };
    const earliest = new Date();
    earliest.setMonth(earliest.getMonth() - HOTEL_MAX_LOOKBACK_MONTHS);
    earliest.setHours(0, 0, 0, 0);
    if (rawDateFrom < earliest) {
      return { dateFrom: earliest, isClamped: true };
    }
    return { dateFrom: rawDateFrom, isClamped: false };
  }, [isAdmin, isLoaded, rawDateFrom]);

  if (!isLoaded) {
    return <div className="text-center py-12 text-gray-400 text-sm">Verifying access…</div>;
  }

  return (
    <HotelContent
      hotel={hotel}
      dateFrom={dateFrom}
      dateTo={dateTo}
      isAdmin={isAdmin}
      isClamped={isClamped}
    />
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
        <HotelDateGate hotel={hotel} rawDateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
