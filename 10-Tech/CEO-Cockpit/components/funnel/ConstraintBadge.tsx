"use client";

import { severityClasses, type Constraint } from "@/lib/funnel/constraint-detection";

interface ConstraintBadgeProps {
  constraint: Constraint | null;
  className?: string;
}

export function ConstraintBadge({ constraint, className = "" }: ConstraintBadgeProps) {
  if (!constraint) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 ${className}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        All on track
      </span>
    );
  }

  const c = severityClasses[constraint.severity];

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${c.bg} ${c.text} ${c.border} border ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {constraint.stage} ({constraint.actual.toFixed(0)}% vs {constraint.benchmark}%)
    </span>
  );
}
