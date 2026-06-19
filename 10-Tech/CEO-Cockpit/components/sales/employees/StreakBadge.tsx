"use client";

import type { MonthlyEmployeeStat } from "@/lib/hooks/useSalesEmployeeMonthly";

export interface StreakBadgeProps {
  months: MonthlyEmployeeStat[];
  retailTarget?: number;
}

function computeStreak(months: MonthlyEmployeeStat[], target: number): number {
  let streak = 0;
  for (let i = months.length - 1; i >= 0; i--) {
    if (months[i].retail_revenue >= target) streak++;
    else break;
  }
  return streak;
}

function getStreakEmoji(streak: number): string {
  if (streak >= 5) return "🔥🔥🔥";
  if (streak >= 3) return "🔥🔥";
  if (streak >= 1) return "🔥";
  return "❄️";
}

function getStreakMessage(streak: number): string {
  if (streak === 0) return "No retail streak yet — hit your €800 target to start one!";
  if (streak === 1) return "1-month retail streak — great start! Keep it going!";
  if (streak === 2) return "2-month streak — you're building a habit!";
  if (streak === 3) return "3-month streak — you're on fire! 🔥";
  if (streak === 4) return "4 months in a row — don't stop now!";
  return `${streak}-month streak — absolute legend status!`;
}

export function StreakBadge({ months, retailTarget = 800 }: StreakBadgeProps) {
  if (months.length === 0) return null;
  const streak = computeStreak(months, retailTarget);

  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold border ${
      streak >= 3
        ? "bg-orange-50 border-orange-300 text-orange-700"
        : streak >= 1
        ? "bg-amber-50 border-amber-300 text-amber-700"
        : "bg-slate-50 border-slate-200 text-slate-500"
    }`}>
      <span className="text-base">{getStreakEmoji(streak)}</span>
      <span>{streak > 0 ? `${streak}-Month Retail Streak` : "No streak yet"}</span>
    </div>
  );
}

export function StreakTooltip({ months, retailTarget = 800 }: StreakBadgeProps) {
  if (months.length === 0) return null;
  const streak = computeStreak(months, retailTarget);
  return (
    <p className="text-xs text-muted-foreground mt-1">{getStreakMessage(streak)}</p>
  );
}
