"use client";

import { GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeriodComparisonToggleProps {
  enabled: boolean;
  onToggle: () => void;
  previousFrom: Date;
  previousTo: Date;
}

export function PeriodComparisonToggle({ enabled, onToggle, previousFrom, previousTo }: PeriodComparisonToggleProps) {
  const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });

  return (
    <button
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
        enabled
          ? "bg-gold/10 border-gold/30 text-gold"
          : "bg-transparent border-warm-border text-text-secondary hover:border-gold/20 hover:text-charcoal"
      )}
      title={enabled ? `Comparing with ${formatDate(previousFrom)} – ${formatDate(previousTo)}` : "Enable period comparison"}
    >
      <GitCompare className="h-3.5 w-3.5" />
      {enabled ? `vs ${formatDate(previousFrom)} – ${formatDate(previousTo)}` : "Compare"}
    </button>
  );
}
