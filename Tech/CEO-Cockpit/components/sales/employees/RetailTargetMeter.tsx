"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export interface RetailTargetMeterProps {
  retailRevenue: number;
  targetRevenue?: number;
  bonusAmount?: number;
  accentColor?: string;
  periodLabel?: string;
  dateTo?: Date;
}

function formatEur(value: number): string {
  if (!Number.isFinite(value)) return "€0.00";
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtShort(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(0)}k`;
  return `€${Math.round(v)}`;
}

function polarToCart(angleDeg: number, r: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

export function RetailTargetMeter({
  retailRevenue,
  targetRevenue = 800,
  bonusAmount = 100,
  periodLabel,
  dateTo,
}: RetailTargetMeterProps) {
  const rawPct      = targetRevenue > 0 ? (retailRevenue / targetRevenue) * 100 : 0;
  const displayPct  = Math.min(rawPct, 100);
  const pct         = displayPct / 100;
  const pctNum      = Math.round(rawPct);
  const clampedPct  = Math.min(Math.max(pct, 0), 1.0);
  const unlocked    = retailRevenue >= targetRevenue;
  const remaining   = Math.max(0, targetRevenue - retailRevenue);

  const isCrushed = pctNum >= 100;
  const isAlmost  = pctNum >= 75 && pctNum < 100;
  const isGood    = pctNum >= 50 && pctNum < 75;

  const gaugeColor = isCrushed ? "#F59E0B" : isAlmost ? "#10B981" : isGood ? "#F59E0B" : "#EF4444";
  const glowColor  = isCrushed ? "#FCD34D" : isAlmost ? "#34D399" : isGood ? "#FCD34D" : "#FCA5A5";

  const subLabel = isCrushed
    ? "BONUS UNLOCKED! 🎉"
    : isAlmost
    ? "Almost there — push now! 🔥"
    : isGood
    ? "Good momentum — keep going! 💪"
    : "Time to accelerate! ⚡";

  // Gauge geometry: semicircle opening upward, same as hotel gauge
  const cx = 200, cy = 185, r = 150, stroke = 28;

  const bgStart = polarToCart(180, r, cx, cy);
  const bgEnd   = polarToCart(0,   r, cx, cy);
  const bgPath  = `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 1 1 ${bgEnd.x.toFixed(1)} ${bgEnd.y.toFixed(1)}`;

  const clampedFill  = Math.min(clampedPct, 0.999);
  const fillEndAngle = 180 - clampedFill * 180;
  const fillEnd      = polarToCart(fillEndAngle, r, cx, cy);
  const fillSweepDeg = clampedFill * 180;
  const largeArc     = fillSweepDeg > 180 ? 1 : 0;
  const fillPath = fillSweepDeg > 0.5
    ? `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${fillEnd.x.toFixed(1)} ${fillEnd.y.toFixed(1)}`
    : null;

  const milestoneMarkers = [0.25, 0.5, 0.75];

  // Countdown to month end
  const daysLeft = dateTo
    ? Math.max(0, Math.ceil((dateTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Milestone celebration pop
  const [celebratingMilestone, setCelebratingMilestone] = useState<number | null>(null);
  const prevPctRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevPctRef.current === null) {
      prevPctRef.current = displayPct;
      return;
    }
    const prev = prevPctRef.current;
    prevPctRef.current = displayPct;
    const crossed = [25, 50, 75].filter((m) => prev < m && displayPct >= m);
    if (crossed.length > 0) {
      setCelebratingMilestone(crossed[crossed.length - 1]);
      setTimeout(() => setCelebratingMilestone(null), 2500);
    }
  }, [displayPct]);

  const cssAnimations = `
    @keyframes shimmer-rt {
      0%, 100% { opacity: 0.7; }
      50%       { opacity: 1;   }
    }
    @keyframes gaugePulse-rt {
      0%, 100% { filter: url(#glow-rt) brightness(1); }
      50%       { filter: url(#glow-rt) brightness(1.4); }
    }
    @keyframes popIn-rt {
      0%   { opacity: 0; transform: scale(0.8); }
      60%  { transform: scale(1.05); }
      100% { opacity: 1; transform: scale(1); }
    }
    .gauge-pulse-rt  { animation: gaugePulse-rt 1.5s ease-in-out infinite; }
    .shimmer-rt      { animation: shimmer-rt 2s ease-in-out infinite; }
    .pop-in-rt       { animation: popIn-rt 0.4s ease-out; }
  `;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-1">
          <CardTitle className="flex items-center gap-1.5">
            <span>🛍️</span>
            <span>Retail Target</span>
          </CardTitle>
          {periodLabel && (
            <span className="text-xs text-muted-foreground">{periodLabel}</span>
          )}
        </div>
        <CardDescription>
          Reach {formatEur(targetRevenue)} in retail sales to unlock a{" "}
          <span className="font-semibold text-amber-600">{formatEur(bonusAmount)} bonus</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="p-0">
        <style>{cssAnimations}</style>

        {/* ── Dark gauge panel ── */}
        <div
          className="px-6 py-6"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)" }}
        >
          {/* Status label */}
          <div className="text-center mb-2">
            {isCrushed ? (
              <span
                className="shimmer-rt inline-block text-base font-extrabold tracking-wider uppercase px-4 py-1 rounded-full"
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

          {/* SVG semicircle gauge */}
          <div className="flex justify-center">
            <svg
              width="400"
              height="220"
              viewBox="0 0 400 220"
              className="overflow-visible"
              style={{ maxWidth: "100%" }}
            >
              <defs>
                <filter id="glow-rt" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="glow-rt-strong" x="-60%" y="-60%" width="220%" height="220%">
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

              {/* Fill arc with glow */}
              {fillPath && (
                <path
                  d={fillPath}
                  fill="none"
                  stroke={gaugeColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  className={isCrushed ? "gauge-pulse-rt" : undefined}
                  style={
                    !isCrushed
                      ? { filter: "url(#glow-rt)" }
                      : { filter: "url(#glow-rt-strong)", stroke: glowColor }
                  }
                />
              )}

              {/* Milestone rings at 25 / 50 / 75 % */}
              {milestoneMarkers.map((m) => {
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
                    style={isPast ? { filter: "url(#glow-rt)" } : undefined}
                  />
                );
              })}

              {/* 100% end marker */}
              <circle
                cx={bgEnd.x}
                cy={bgEnd.y}
                r={6}
                fill={isCrushed ? "#F59E0B" : "#475569"}
                style={isCrushed ? { filter: "url(#glow-rt)" } : undefined}
              />

              {/* Endpoint labels */}
              <text x={bgStart.x - 10} y={bgStart.y + 20} textAnchor="end"   fontSize="11" fill="#64748b" fontFamily="inherit">€0</text>
              <text x={bgEnd.x   + 10} y={bgEnd.y   + 20} textAnchor="start" fontSize="11" fill="#64748b" fontFamily="inherit">{fmtShort(targetRevenue)}</text>

              {/* Milestone % labels */}
              {milestoneMarkers.map((m) => {
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

              {/* Centre: retail revenue (big) */}
              <text
                x={cx}
                y={cy - 48}
                textAnchor="middle"
                fontSize="44"
                fontWeight="800"
                fill="#f8fafc"
                fontFamily="inherit"
                style={{ letterSpacing: "-1px" }}
              >
                {fmtShort(retailRevenue)}
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
                style={isCrushed ? { filter: "url(#glow-rt)" } : undefined}
              >
                {pctNum}%
              </text>

              {/* Centre: "of €800 target" */}
              <text
                x={cx}
                y={cy + 18}
                textAnchor="middle"
                fontSize="12"
                fill="#64748b"
                fontFamily="inherit"
              >
                of {fmtShort(targetRevenue)} target
              </text>
            </svg>
          </div>

          {/* Remaining / earned line */}
          <p className="text-center text-sm mt-1 font-medium" style={{ color: gaugeColor }}>
            {unlocked
              ? `${formatEur(bonusAmount)} bonus earned! 🎉`
              : `${formatEur(remaining)} to go for your ${formatEur(bonusAmount)} bonus`}
          </p>

          {/* Countdown */}
          {!unlocked && daysLeft !== null && daysLeft <= 14 && displayPct >= 50 && (
            <p className={`text-xs font-semibold text-center mt-1.5 ${daysLeft <= 3 ? "text-red-400" : "text-orange-400"}`}>
              📅 {daysLeft} day{daysLeft === 1 ? "" : "s"} left to earn your {formatEur(bonusAmount)} bonus
            </p>
          )}
        </div>

        {/* Milestone celebration pop */}
        {celebratingMilestone !== null && (
          <div
            className="pop-in-rt mx-4 mb-4 mt-3 flex items-center justify-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-sm"
          >
            {celebratingMilestone === 75 ? "🎯 " : celebratingMilestone === 50 ? "⚡ " : "🌟 "}
            {celebratingMilestone === 75
              ? "Almost there! €100 bonus within reach!"
              : celebratingMilestone === 50
              ? "Halfway there! Keep the momentum going!"
              : "Great start! Keep building!"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RetailTargetMeterSkeleton() {
  return (
    <div className="h-80 animate-pulse rounded-xl bg-muted border border-border" />
  );
}
