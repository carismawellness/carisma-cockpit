"use client";

import { Banknote } from "lucide-react";
import { Card } from "@/components/ui/card";

interface CommissionHeroBannerProps {
  commissionEarned: number;
  commissionRate:   number;
  totalSales:       number;
  periodLabel:      string;
}

function formatEur(value: number): string {
  if (!Number.isFinite(value)) return "€0.00";
  return new Intl.NumberFormat("en-MT", {
    style:                 "currency",
    currency:              "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CommissionHeroBanner({
  commissionEarned,
  commissionRate,
  totalSales,
  periodLabel,
}: CommissionHeroBannerProps) {
  const ratePct = (commissionRate * 100).toLocaleString("en", { maximumFractionDigits: 1 }) + "%";

  return (
    <Card className="w-full bg-gradient-to-br from-emerald-50 to-green-100 border-emerald-200 shadow-sm overflow-hidden">
      <div className="px-6 py-6 md:py-8">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <Banknote className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Your Commission
            </span>
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            {ratePct} of revenue
          </span>
        </div>

        {/* Big amount */}
        <div className="text-center mb-3">
          <span className="text-5xl md:text-6xl font-extrabold text-emerald-700 tracking-tight tabular-nums">
            {formatEur(commissionEarned)}
          </span>
        </div>

        {/* Subtitle */}
        <p className="text-center text-sm text-emerald-600">
          {periodLabel}&nbsp;·&nbsp;Based on {formatEur(totalSales)} revenue
        </p>
      </div>
    </Card>
  );
}

export function CommissionHeroBannerSkeleton() {
  return (
    <div className="h-44 animate-pulse rounded-xl bg-emerald-50 border border-emerald-100" />
  );
}
