"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export interface RetailTargetMeterProps {
  retailRevenue: number;
  targetRevenue?: number;  // size of each tier — default €800
  bonusAmount?: number;    // bonus unlocked per tier — default €100
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
  if (v >= 1000) {
    const k = v / 1000;
    return `€${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
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
  const tierSize     = targetRevenue;
  const bonusPerTier = bonusAmount;

  // Infinite escalating tier math
  const completedTiers   = Math.floor(retailRevenue / tierSize);
  const currentTierStart = completedTiers * tierSize;
  const currentTierEnd   = currentTierStart + tierSize;
  const progressInTier   = (retailRevenue - currentTierStart) / tierSize; // 0.0 → <1.0
  const totalBonusEarned = completedTiers * bonusPerTier;
  const remaining        = currentTierEnd - retailRevenue;
  const currentTierNum   = completedTiers + 1; // 1-indexed for display

  const pctNum      = Math.round(progressInTier * 100);
  const clampedFill = Math.min(Math.max(progressInTier, 0), 0.999);

  const isAlmost = pctNum >= 75;
  const isGood   = pctNum >= 50 && pctNum < 75;

  const gaugeColor = isAlmost ? "#10B981" : isGood ? "#F59E0B" : "#EF4444";
  const glowColor  = isAlmost ? "#34D399" : isGood ? "#FCD34D" : "#FCA5A5";

  const subLabel = isAlmost
    ? "Almost there — push now! 🔥"
    : isGood
    ? "Good momentum — keep going! 💪"
    : "Time to accelerate! ⚡";

  // Gauge geometry
  const cx = 200, cy = 185, r = 150, stroke = 28;

  const bgStart = polarToCart(180, r, cx, cy);
  const bgEnd   = polarToCart(0,   r, cx, cy);
  const bgPath  = `M ${bgStart.x.toFixed(1)} ${bgStart.y.toFixed(1)} A ${r} ${r} 0 1 1 ${bgEnd.x.toFixed(1)} ${bgEnd.y.toFixed(1)}`;

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

  // Detect tier completion → celebration banner
  const [celebratingTier, setCelebratingTier] = useState<number | null>(null);
  const prevTiersRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevTiersRef.current === null) {
      prevTiersRef.current = completedTiers;
      return;
    }
    if (completedTiers > prevTiersRef.current) {
      setCelebratingTier(completedTiers);
      setTimeout(() => setCelebratingTier(null), 3500);
    }
    prevTiersRef.current = completedTiers;
  }, [completedTiers]);

  // Detect milestone % crossings within current tier
  const [celebratingMilestone, setCelebratingMilestone] = useState<number | null>(null);
  const prevPctRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevPctRef.current === null) {
      prevPctRef.current = pctNum;
      return;
    }
    const prev = prevPctRef.current;
    prevPctRef.current = pctNum;
    const crossed = [25, 50, 75].filter((m) => prev < m && pctNum >= m);
    if (crossed.length > 0 && celebratingTier === null) {
      setCelebratingMilestone(crossed[crossed.length - 1]);
      setTimeout(() => setCelebratingMilestone(null), 2500);
    }
  }, [pctNum, celebratingTier]);

  const cssAnimations = `
    @keyframes shimmer-rt {
      0%, 100% { opacity: 0.7; }
      50%       { opacity: 1;   }
    }
    @keyframes popIn-rt {
      0%   { opacity: 0; transform: scale(0.8); }
      60%  { transform: scale(1.05); }
      100% { opacity: 1; transform: scale(1); }
    }
    .shimmer-rt { animation: shimmer-rt 2s ease-in-out infinite; }
    .pop-in-rt  { animation: popIn-rt 0.4s ease-out; }
  `;

  // Show at most 5 filled tier dots + 1 in-progress dot
  const dotsToShow  = Math.min(completedTiers, 5);
  const hasMoreTiers = completedTiers > 5;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-1">
          <CardTitle className="flex items-center gap-1.5">
            <span>🛍️</span>
            <span>Retail Target</span>
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {periodLabel && (
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            )}
            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
              Tier {currentTierNum}
            </span>
            {totalBonusEarned > 0 && (
              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                💰 {formatEur(totalBonusEarned)} earned
              </span>
            )}
          </div>
        </div>
        <CardDescription>
          Earn {formatEur(remaining)} more to unlock your next{" "}
          <span className="font-semibold text-amber-600">{formatEur(bonusPerTier)} bonus</span>
          {" "}— the more you sell, the more you earn!
        </CardDescription>

        {/* Tier progress dots */}
        {completedTiers > 0 && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {Array.from({ length: dotsToShow }, (_, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{ width: 10, height: 10, background: "#F59E0B", boxShadow: "0 0 5px #F59E0B99" }}
              />
            ))}
            {hasMoreTiers && (
              <span className="text-xs font-bold text-amber-600">+{completedTiers - 5}</span>
            )}
            <div className="rounded-full bg-gray-200" style={{ width: 8, height: 8 }} />
            <span className="text-[10px] text-muted-foreground ml-0.5">
              {completedTiers} bonus{completedTiers !== 1 ? "es" : ""} unlocked
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <style>{cssAnimations}</style>

        {/* ── Dark gauge panel ── */}
        <div
          className="px-6 py-6"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)" }}
        >
          {/* Status label / tier celebration */}
          <div className="text-center mb-2">
            {celebratingTier !== null ? (
              <span
                className="shimmer-rt inline-block text-base font-extrabold tracking-wider uppercase px-4 py-1 rounded-full"
                style={{ color: "#F59E0B", textShadow: "0 0 20px #F59E0B88, 0 0 40px #F59E0B44" }}
              >
                🎉 TIER {celebratingTier} COMPLETE! +{formatEur(bonusPerTier)}
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

              {/* Fill arc */}
              {fillPath && (
                <path
                  d={fillPath}
                  fill="none"
                  stroke={gaugeColor}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  style={{ filter: "url(#glow-rt)" }}
                />
              )}

              {/* Milestone rings at 25 / 50 / 75 % */}
              {milestoneMarkers.map((m) => {
                const mAngle = 180 - m * 180;
                const mPt    = polarToCart(mAngle, r, cx, cy);
                const isPast = progressInTier >= m;
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
              <circle cx={bgEnd.x} cy={bgEnd.y} r={6} fill="#475569" />

              {/* Endpoint labels — show current tier window */}
              <text x={bgStart.x - 10} y={bgStart.y + 20} textAnchor="end"   fontSize="11" fill="#64748b" fontFamily="inherit">{fmtShort(currentTierStart)}</text>
              <text x={bgEnd.x   + 10} y={bgEnd.y   + 20} textAnchor="start" fontSize="11" fill="#64748b" fontFamily="inherit">{fmtShort(currentTierEnd)}</text>

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

              {/* Centre: total retail revenue (big) */}
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

              {/* Centre: tier progress % */}
              <text
                x={cx}
                y={cy - 8}
                textAnchor="middle"
                fontSize="26"
                fontWeight="700"
                fill={gaugeColor}
                fontFamily="inherit"
              >
                {pctNum}%
              </text>

              {/* Centre: tier context */}
              <text
                x={cx}
                y={cy + 18}
                textAnchor="middle"
                fontSize="12"
                fill="#64748b"
                fontFamily="inherit"
              >
                of {fmtShort(currentTierEnd)} target
              </text>
            </svg>
          </div>

          {/* Remaining line */}
          <p className="text-center text-sm mt-1 font-medium" style={{ color: gaugeColor }}>
            {formatEur(remaining)} to go for your next {formatEur(bonusPerTier)} bonus
          </p>

          {/* Total earned display */}
          {totalBonusEarned > 0 && (
            <p className="text-center text-xs mt-1.5 font-semibold text-amber-400">
              🏆 {formatEur(totalBonusEarned)} total bonus earned this period
            </p>
          )}

          {/* Countdown */}
          {daysLeft !== null && daysLeft <= 14 && pctNum >= 50 && (
            <p className={`text-xs font-semibold text-center mt-1.5 ${daysLeft <= 3 ? "text-red-400" : "text-orange-400"}`}>
              📅 {daysLeft} day{daysLeft === 1 ? "" : "s"} left to earn your next {formatEur(bonusPerTier)} bonus
            </p>
          )}
        </div>

        {/* Tier complete celebration pop */}
        {celebratingTier !== null && (
          <div className="pop-in-rt mx-4 mb-4 mt-3 flex items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-700 shadow-sm">
            🎉 Tier {celebratingTier} complete! {formatEur(bonusPerTier)} bonus unlocked
            {totalBonusEarned > 0 && <> — {formatEur(totalBonusEarned)} earned total!</>}
          </div>
        )}

        {/* Milestone celebration pop */}
        {celebratingMilestone !== null && (
          <div className="pop-in-rt mx-4 mb-4 mt-3 flex items-center justify-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-sm">
            {celebratingMilestone === 75
              ? "🎯 Almost there! Next bonus within reach!"
              : celebratingMilestone === 50
              ? "⚡ Halfway there! Keep the momentum going!"
              : "🌟 Great start! Keep building!"}
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
