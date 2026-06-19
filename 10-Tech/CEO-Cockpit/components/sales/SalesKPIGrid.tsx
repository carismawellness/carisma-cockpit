"use client";

import { cn } from "@/lib/utils";

interface SalesKPIGridProps {
  children: React.ReactNode;
  columns?: 3 | 4 | 5 | 6 | 8;
  className?: string;
}

const columnClasses: Record<3 | 4 | 5 | 6 | 8, string> = {
  3: "grid-cols-1 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  8: "grid-cols-2 md:grid-cols-4 xl:grid-cols-4",
};

export function SalesKPIGrid({
  children,
  columns = 4,
  className,
}: SalesKPIGridProps) {
  return (
    <div className={cn("grid gap-4", columnClasses[columns], className)}>
      {children}
    </div>
  );
}

export type { SalesKPIGridProps };
