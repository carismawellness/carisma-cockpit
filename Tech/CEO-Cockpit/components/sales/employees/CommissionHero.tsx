"use client";

import { Banknote, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { deltaPct } from "@/lib/utils/period-comparison";

export interface CommissionHeroProps {
  commissionService: number;
  commissionRetail: number;
  commissionTotal: number;
  serviceRate: number;
  retailRate: number;
  ratesSet: boolean;
  accentColor?: string;
  periodLabel?: string;
  /** Previous period totals — when provided, delta pills are shown */
  prevCommissionTotal?: number;
  prevCommissionService?: number;
  prevCommissionRetail?: number;
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

function formatRate(rate: number): string {
  return (rate * 100).toLocaleString("en", { maximumFractionDigits: 2 }) + "%";
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const pct = deltaPct(current, previous);
  if (pct === undefined) return null;
  const up = pct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ml-2 ${
        up ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
      }`}
    >
      <Arrow className="h-3 w-3" />
      {up ? "+" : ""}
      {pct.toFixed(1)}% vs last period
    </span>
  );
}

export function CommissionHero({
  commissionService,
  commissionRetail,
  commissionTotal,
  serviceRate,
  retailRate,
  ratesSet,
  accentColor,
  periodLabel,
  prevCommissionTotal,
  prevCommissionService,
  prevCommissionRetail,
}: CommissionHeroProps) {
  return (
    <Card className="w-full bg-gradient-to-br from-emerald-50 to-green-100 border-emerald-200 shadow-sm overflow-hidden">
      <div className="px-6 py-6 md:py-8">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-700" style={accentColor ? { color: accentColor } : undefined}>
            <Banknote className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Your Commission
            </span>
          </div>
          {ratesSet && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Services {formatRate(serviceRate)}
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Retail {formatRate(retailRate)}
              </span>
            </div>
          )}
        </div>

        {ratesSet ? (
          <>
            {/* Big total + delta */}
            <div className="text-center mb-4">
              <div className="inline-flex items-center flex-wrap justify-center gap-1">
                <span className="text-5xl md:text-6xl font-extrabold text-emerald-700 tracking-tight tabular-nums">
                  {formatEur(commissionTotal)}
                </span>
                {prevCommissionTotal !== undefined && (
                  <DeltaBadge current={commissionTotal} previous={prevCommissionTotal} />
                )}
              </div>
            </div>

            {/* Service / retail split */}
            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto mb-3">
              <div className="rounded-lg bg-white/60 border border-emerald-100 px-4 py-2.5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                  Service Commission
                </p>
                <div className="inline-flex items-center gap-1 flex-wrap justify-center">
                  <p className="text-lg font-bold text-emerald-800 tabular-nums">
                    {formatEur(commissionService)}
                  </p>
                  {prevCommissionService !== undefined && (
                    <DeltaBadge current={commissionService} previous={prevCommissionService} />
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-white/60 border border-emerald-100 px-4 py-2.5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                  Retail Commission
                </p>
                <div className="inline-flex items-center gap-1 flex-wrap justify-center">
                  <p className="text-lg font-bold text-emerald-800 tabular-nums">
                    {formatEur(commissionRetail)}
                  </p>
                  {prevCommissionRetail !== undefined && (
                    <DeltaBadge current={commissionRetail} previous={prevCommissionRetail} />
                  )}
                </div>
              </div>
            </div>

            {periodLabel && (
              <p className="text-center text-sm text-emerald-600">{periodLabel}</p>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>
              Commission rates not set — ask an admin to configure your rates in Settings.
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

export function CommissionHeroSkeleton() {
  return (
    <div className="h-52 animate-pulse rounded-xl bg-emerald-50 border border-emerald-100" />
  );
}
