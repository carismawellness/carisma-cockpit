"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface SalesKPICardProps {
  label: string;
  value: string;
  subtitle?: string;
  yoyChange?: number;
  yoyLabel?: string;
  /** true = show "pp" (percentage-point delta), false = show "%" (default) */
  yoyIsDelta?: boolean;
  /** Optional Lucide icon displayed top-left */
  icon?: React.ComponentType<{ className?: string }>;
}

export function SalesKPICard({
  label,
  value,
  subtitle,
  yoyChange,
  yoyLabel = "vs LY",
  yoyIsDelta = false,
  icon: Icon,
}: SalesKPICardProps) {
  const hasYoY = yoyChange !== undefined;
  const isPositive = hasYoY && yoyChange >= 0;
  const Arrow = isPositive ? ArrowUpRight : ArrowDownRight;

  const formattedYoY = hasYoY
    ? yoyIsDelta
      ? `${isPositive ? "+" : ""}${yoyChange.toFixed(1)}pp`
      : `${isPositive ? "+" : ""}${yoyChange.toFixed(1)}%`
    : "";

  return (
    <Card className="relative px-3 py-3 md:px-5 md:py-4">
      {/* YoY badge — top right */}
      {hasYoY && (
        <div
          className={cn(
            "absolute top-3 right-3 flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            isPositive
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-600"
          )}
        >
          <Arrow className="h-3 w-3" />
          {formattedYoY} {yoyLabel}
        </div>
      )}

      {/* Label row with optional icon */}
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" />}
        <p className="text-xs font-medium text-muted-foreground tracking-wide uppercase pr-16 md:pr-24">
          {label}
        </p>
      </div>

      {/* Value */}
      <p className="mt-1.5 text-xl md:text-2xl font-bold text-foreground leading-tight">
        {value}
      </p>

      {/* Subtitle */}
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      )}
    </Card>
  );
}

export type { SalesKPICardProps };
