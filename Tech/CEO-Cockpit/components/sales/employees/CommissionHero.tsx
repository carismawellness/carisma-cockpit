"use client";

import { useState, useEffect, useRef } from "react";
import { AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { deltaPct } from "@/lib/utils/period-comparison";

function useCountUp(target: number, duration = 1200): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const progress = Math.min((ts - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

export interface CommissionHeroProps {
  commissionService: number;
  commissionRetail: number;
  commissionTotal: number;
  commissionBooking?: number;
  /** Retail tier bonuses earned this period (e.g. €100 per €800 tier hit) */
  commissionBonus?: number;
  serviceRate: number;
  retailRate: number;
  bookingRate?: number;
  /** Spa total commission rate (management only) */
  spaTotalRate?: number;
  /** Management employees show "Spa Total" label and hide Booking card */
  employeeType?: "therapist" | "advisor" | "management";
  ratesSet: boolean;
  accentColor?: string;
  periodLabel?: string;
  /** Previous period totals — when provided, delta pills are shown */
  prevCommissionTotal?: number;
  prevCommissionService?: number;
  prevCommissionRetail?: number;
  prevCommissionBooking?: number;
  prevCommissionBonus?: number;
  allTimeBestCommission?: number;
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

function formatRate(rate: number): string {
  return (rate * 100).toLocaleString("en", { maximumFractionDigits: 2 }) + "%";
}

// ---------------------------------------------------------------------------
// DeltaBadge
// ---------------------------------------------------------------------------

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  const pct = deltaPct(current, previous);
  if (pct === undefined) return null;
  const up = pct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ml-2 ${
        up
          ? "bg-emerald-200/60 text-emerald-100 border border-emerald-400/40"
          : "bg-red-200/30 text-red-200 border border-red-400/30"
      }`}
    >
      <Arrow className="h-3 w-3" />
      {up ? "+" : ""}
      {pct.toFixed(1)}% vs last period
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-card for service / retail split
// ---------------------------------------------------------------------------

function SplitCard({
  icon,
  label,
  amount,
  prev,
}: {
  icon: string;
  label: string;
  amount: number;
  prev?: number;
}) {
  return (
    <div className="rounded-xl bg-white/10 border border-white/20 backdrop-blur-sm px-4 py-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-200 mb-1">
        {icon} {label}
      </p>
      <div className="inline-flex items-center gap-1 flex-wrap justify-center">
        <p className="text-xl font-bold text-white tabular-nums">
          {formatEur(amount)}
        </p>
        {prev !== undefined && <DeltaBadge current={amount} previous={prev} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CommissionHero({
  commissionService,
  commissionRetail,
  commissionTotal,
  commissionBooking = 0,
  commissionBonus = 0,
  serviceRate,
  retailRate,
  bookingRate,
  spaTotalRate,
  employeeType,
  ratesSet,
  accentColor: _accentColor,
  periodLabel,
  prevCommissionTotal,
  prevCommissionService,
  prevCommissionRetail,
  prevCommissionBooking,
  prevCommissionBonus = 0,
  allTimeBestCommission,
}: CommissionHeroProps) {
  const isManagement = employeeType === "management";
  // Bonus is additive on top of the DB-computed commission total
  const grandTotal = commissionTotal + commissionBonus;
  const prevGrandTotal =
    prevCommissionTotal !== undefined
      ? prevCommissionTotal + prevCommissionBonus
      : undefined;

  const animatedTotal = useCountUp(grandTotal);

  return (
    <Card className="w-full overflow-hidden border-0 shadow-xl p-0">
      {/* Deep emerald gradient hero panel */}
      <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-800 px-6 py-7 md:py-9">

        {/* ── Header row: label + rank badge + rate pills ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div className="flex items-center gap-2">
            <span className="text-lg">💰</span>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">
              Your Commission
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {ratesSet && (
              <>
                {isManagement ? (
                  spaTotalRate !== undefined && spaTotalRate > 0 && (
                    <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                      📊 {formatRate(spaTotalRate)}
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                    💆 {formatRate(serviceRate)}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  🛍️ {formatRate(retailRate)}
                </span>
                {!isManagement && bookingRate !== undefined && bookingRate > 0 && (
                  <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                    📅 {formatRate(bookingRate)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Main content ── */}
        {ratesSet ? (
          <>
            {/* Big total — includes retail tier bonuses */}
            <div className="text-center mb-2">
              <div className="inline-flex items-center flex-wrap justify-center gap-1">
                <span className="text-5xl md:text-6xl font-extrabold text-white tracking-tight tabular-nums">
                  {formatEur(animatedTotal)}
                </span>
                {prevGrandTotal !== undefined && (
                  <DeltaBadge
                    current={grandTotal}
                    previous={prevGrandTotal}
                  />
                )}
              </div>
            </div>

            {/* Personal best: new record or near-miss */}
            {allTimeBestCommission !== undefined && allTimeBestCommission > 0 && (
              grandTotal >= allTimeBestCommission ? (
                <p className="text-center text-xs font-bold text-amber-300 bg-amber-400/20 rounded-full px-3 py-1 mx-auto w-fit mb-3">
                  🏆 New Personal Best!
                </p>
              ) : (allTimeBestCommission - grandTotal) / allTimeBestCommission <= 0.15 ? (
                <p className="text-center text-xs text-amber-300 mb-3">
                  Just {formatEur(allTimeBestCommission - grandTotal)} from your personal best!
                </p>
              ) : <div className="mb-3" />
            )}

            {/* Period label */}
            {periodLabel && (
              <p className="text-center text-xs text-emerald-400 mb-4">
                {periodLabel}
              </p>
            )}

            {/* Commission breakdown sub-cards */}
            <div className={`grid gap-3 max-w-2xl mx-auto ${
              isManagement
                ? commissionBonus > 0 ? "grid-cols-3" : "grid-cols-2"
                : commissionBonus > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
            }`}>
              <SplitCard
                icon={isManagement ? "📊" : "💆"}
                label={isManagement ? "Spa Total Commission" : "Service Commission"}
                amount={commissionService}
                prev={prevCommissionService}
              />
              <SplitCard
                icon="🛍️"
                label="Retail Commission"
                amount={commissionRetail}
                prev={prevCommissionRetail}
              />
              {!isManagement && (
                <SplitCard
                  icon="📅"
                  label="Booking Commission"
                  amount={commissionBooking}
                  prev={prevCommissionBooking}
                />
              )}
              {commissionBonus > 0 && (
                <SplitCard
                  icon="🎁"
                  label="Retail Bonus"
                  amount={commissionBonus}
                  prev={prevCommissionBonus > 0 ? prevCommissionBonus : undefined}
                />
              )}
            </div>
          </>
        ) : (
          /* Rates not set notice */
          <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-4 text-sm text-amber-300 mt-2">
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
    <div className="h-52 animate-pulse rounded-xl bg-emerald-900/40 border border-emerald-800" />
  );
}
