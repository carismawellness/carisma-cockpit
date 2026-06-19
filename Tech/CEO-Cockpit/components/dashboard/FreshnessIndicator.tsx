"use client";

import { cn } from "@/lib/utils";

interface FreshnessIndicatorProps {
  lastUpdated: Date | null;
  className?: string;
}

export function FreshnessIndicator({ lastUpdated, className }: FreshnessIndicatorProps) {
  if (!lastUpdated) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] text-text-secondary", className)}>
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        No data
      </span>
    );
  }

  const now = new Date();
  const diffMs = now.getTime() - lastUpdated.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let color: string;
  let label: string;

  if (diffHours < 1) {
    color = "bg-green-500";
    const mins = Math.floor(diffMs / 60000);
    label = mins < 1 ? "Just now" : `${mins}m ago`;
  } else if (diffHours < 24) {
    color = "bg-amber-500";
    label = `${Math.floor(diffHours)}h ago`;
  } else {
    color = "bg-red-500";
    const days = Math.floor(diffHours / 24);
    label = `${days}d ago`;
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] text-text-secondary", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}
