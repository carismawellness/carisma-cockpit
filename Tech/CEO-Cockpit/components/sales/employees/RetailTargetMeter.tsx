"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export interface RetailTargetMeterProps {
  retailRevenue: number;
  targetRevenue?: number;  // default 800
  bonusAmount?: number;    // default 100
  accentColor?: string;
  periodLabel?: string;
  dateTo?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEur(value: number): string {
  if (!Number.isFinite(value)) return "€0.00";
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Returns Tailwind color classes for the progress bar based on percentage */
function barColorClasses(pct: number): string {
  if (pct >= 100) return "bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 animate-pulse";
  if (pct >= 75)  return "bg-gradient-to-r from-emerald-500 to-green-400";
  if (pct >= 40)  return "bg-gradient-to-r from-orange-400 to-amber-400";
  return "bg-gradient-to-r from-red-500 to-red-400";
}

/** Returns the label color for the percentage text */
function pctTextColor(pct: number): string {
  if (pct >= 100) return "text-amber-600";
  if (pct >= 75)  return "text-emerald-700";
  if (pct >= 40)  return "text-orange-600";
  return "text-red-600";
}

const MILESTONES = [25, 50, 75, 100];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RetailTargetMeter({
  retailRevenue,
  targetRevenue = 800,
  bonusAmount = 100,
  periodLabel,
  dateTo,
}: RetailTargetMeterProps) {
  const rawPct = targetRevenue > 0 ? (retailRevenue / targetRevenue) * 100 : 0;
  const displayPct = Math.min(rawPct, 100);        // capped at 100 for bar width
  const unlocked = retailRevenue >= targetRevenue;
  const remaining = Math.max(0, targetRevenue - retailRevenue);

  // Countdown timer
  const daysLeft = dateTo
    ? Math.max(0, Math.ceil((dateTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Milestone celebration
  const [celebratingMilestone, setCelebratingMilestone] = useState<number | null>(null);
  const prevPctRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevPctRef.current === null) {
      prevPctRef.current = displayPct;
      return;
    }
    const prev = prevPctRef.current;
    prevPctRef.current = displayPct;

    // Check if we just crossed a milestone
    const crossed = MILESTONES.filter(m => m < 100 && prev < m && displayPct >= m);
    if (crossed.length > 0) {
      setCelebratingMilestone(crossed[crossed.length - 1]);
      setTimeout(() => setCelebratingMilestone(null), 2500);
    }
  }, [displayPct]);

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

      <CardContent className="space-y-4 pb-5">
        <style>{`
          @keyframes popIn {
            0% { opacity: 0; transform: scale(0.8); }
            60% { transform: scale(1.05); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* ── Unlocked banner ── */}
        {unlocked && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 shadow-sm animate-pulse"
               style={{ animationDuration: "2.5s" }}>
            🎉 {formatEur(bonusAmount)} BONUS UNLOCKED!
          </div>
        )}

        {/* ── Milestone celebration overlay ── */}
        {celebratingMilestone !== null && (
          <div
            className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-sm"
            style={{ animation: "popIn 0.4s ease-out" }}
          >
            {celebratingMilestone === 75 ? "🎯 " : celebratingMilestone === 50 ? "⚡ " : "🌟 "}
            {celebratingMilestone === 75
              ? "Almost there! €100 bonus within reach!"
              : celebratingMilestone === 50
              ? "Halfway there! Keep the momentum going!"
              : "Great start! Keep building!"}
          </div>
        )}

        {/* ── Revenue vs target labels ── */}
        <div className="flex items-end justify-between px-0.5">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">
              Retail Revenue
            </p>
            <p className={`text-2xl font-extrabold tabular-nums ${pctTextColor(rawPct)}`}>
              {formatEur(retailRevenue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">
              Target
            </p>
            <p className="text-lg font-bold text-foreground tabular-nums">
              {formatEur(targetRevenue)}
            </p>
          </div>
        </div>

        {/* ── Progress bar with milestone ticks ── */}
        <div className="relative">
          {/* Track */}
          <div className="h-5 w-full rounded-full bg-muted overflow-hidden">
            {/* Fill */}
            <div
              className={`h-full rounded-full transition-all duration-1000 ease-out ${barColorClasses(rawPct)}`}
              style={{ width: `${displayPct}%` }}
            />
          </div>

          {/* Milestone tick marks — rendered above the track */}
          <div className="absolute inset-0 pointer-events-none flex items-center">
            {MILESTONES.map((m) => {
              const isReached = rawPct >= m;
              return (
                <div
                  key={m}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${m}%`, transform: "translateX(-50%)" }}
                >
                  {/* Tick line */}
                  <div
                    className={`w-0.5 h-5 ${isReached ? "bg-white/70" : "bg-border"}`}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Milestone percentage labels */}
        <div className="relative h-4">
          {MILESTONES.map((m) => {
            const isReached = rawPct >= m;
            return (
              <span
                key={m}
                className={`absolute text-[10px] font-semibold -translate-x-1/2 transition-colors duration-500 ${
                  isReached ? pctTextColor(rawPct) : "text-muted-foreground/50"
                }`}
                style={{ left: `${m}%` }}
              >
                {m}%
              </span>
            );
          })}
        </div>

        {/* ── Percentage + status line ── */}
        <div className="flex items-center justify-between">
          <span className={`text-sm font-bold tabular-nums ${pctTextColor(rawPct)}`}>
            {rawPct.toFixed(1)}% of target
          </span>
          <span className="text-sm text-muted-foreground">
            {unlocked
              ? `Bonus earned! 🎉`
              : `${formatEur(remaining)} to go for your ${formatEur(bonusAmount)} bonus!`}
          </span>
        </div>

        {/* ── Month-end countdown ── */}
        {!unlocked && daysLeft !== null && daysLeft <= 14 && displayPct >= 50 && (
          <p className={`text-xs font-semibold text-center ${daysLeft <= 3 ? "text-red-600" : "text-orange-600"}`}>
            📅 {daysLeft} day{daysLeft === 1 ? "" : "s"} left to earn your {formatEur(bonusAmount)} bonus
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function RetailTargetMeterSkeleton() {
  return (
    <div className="h-44 animate-pulse rounded-xl bg-muted border border-border" />
  );
}
