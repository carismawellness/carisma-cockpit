import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export function SkeletonKPIRow({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-2 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 300 }: { height?: number }) {
  return (
    <div className="rounded-xl border border-border p-6">
      <Skeleton className="h-5 w-48 mb-4" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reusable page-level loading skeletons (UX punch list, Jun 2026).    */
/* Heights approximate final layout to minimize content shift.        */
/* ------------------------------------------------------------------ */

/** Chart placeholder — optional title row + plot area of the given height. */
export function ChartSkeleton({
  height = 300,
  withTitle = true,
  className,
}: {
  height?: number;
  withTitle?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)} aria-busy="true" aria-label="Loading chart">
      {withTitle && <Skeleton className="h-5 w-48 mb-4" />}
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

/** Grid of KPI-card placeholders. Pass the same grid classes the real cards use. */
export function KPIGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-4 grid-cols-2 md:grid-cols-4", className)}
      aria-busy="true"
      aria-label="Loading KPIs"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder — header row + N data rows. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("w-full space-y-2", className)} aria-busy="true" aria-label="Loading table">
      <div className="flex gap-4 pb-2 border-b border-border">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-1.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
