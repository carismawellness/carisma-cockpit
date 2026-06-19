"use client";

import { AlertTriangle } from "lucide-react";

export interface PaceAlertProps {
  commissionTotal: number;
  prevCommissionTotal?: number;
  activeDays: number;
  periodDays: number;
  avgTicketEur?: number;
  serviceRate?: number;
}

function formatEur(v: number): string {
  return new Intl.NumberFormat("en-MT", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

export function PaceAlert({
  commissionTotal,
  prevCommissionTotal,
  activeDays,
  periodDays,
  avgTicketEur = 70,
  serviceRate = 0.03,
}: PaceAlertProps) {
  if (!prevCommissionTotal || prevCommissionTotal <= 0 || activeDays < 8 || periodDays <= 0) {
    return null;
  }

  const expectedAtPace = prevCommissionTotal * (activeDays / periodDays);
  const gapFromExpected = expectedAtPace - commissionTotal;
  const behindRatio = gapFromExpected / Math.max(expectedAtPace, 1);

  if (behindRatio < 0.20) return null;

  const daysRemaining = Math.max(0, periodDays - activeDays);
  const endOfPeriodGap = prevCommissionTotal - commissionTotal;
  const commissionPerService = avgTicketEur * serviceRate;
  const servicesNeeded = commissionPerService > 0
    ? Math.ceil(endOfPeriodGap / commissionPerService)
    : null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600 mt-0.5" />
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-amber-800">
          Pace check — {formatEur(gapFromExpected)} behind last period at this point
        </p>
        <p className="text-xs text-amber-700">
          {daysRemaining > 0 ? `${daysRemaining} days left. ` : ""}
          {servicesNeeded !== null && endOfPeriodGap > 0
            ? `Roughly ${servicesNeeded} extra treatment${servicesNeeded === 1 ? "" : "s"} would close the gap to match last period.`
            : endOfPeriodGap > 0
            ? `Need ${formatEur(endOfPeriodGap)} more to match last period.`
            : "You're ahead of last period — great work!"}
        </p>
      </div>
    </div>
  );
}
