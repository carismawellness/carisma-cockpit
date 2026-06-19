import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import Link from "next/link";

interface KPICardProps {
  label: string;
  value: string;
  trend?: number;
  target?: string;
  targetValue?: number;
  currentValue?: number;
  format?: "currency" | "percent" | "number" | "time";
  href?: string;
  isSample?: boolean;
}

export function KPICard({
  label,
  value,
  trend,
  target,
  targetValue,
  currentValue,
  href,
  isSample,
}: KPICardProps) {
  const trendColor =
    trend === undefined || trend === 0
      ? "text-gray-400"
      : trend > 0
        ? "text-green-500"
        : "text-red-500";

  const TrendIcon =
    trend === undefined || trend === 0
      ? Minus
      : trend > 0
        ? TrendingUp
        : TrendingDown;

  const progressPct =
    targetValue && currentValue
      ? Math.min((currentValue / targetValue) * 100, 100)
      : null;

  const content = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        {isSample && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
            <span className="w-1 h-1 rounded-full bg-amber-400" />
            Sample
          </span>
        )}
        {!isSample && trend !== undefined && (
          <span className={cn("flex items-center gap-1 text-sm font-medium", trendColor)}>
            <TrendIcon className="h-4 w-4" />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="text-xl md:text-3xl font-bold text-gray-900 mb-2">{value}</div>
      {progressPct !== null && (
        <div className="space-y-1">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                progressPct >= 90 ? "bg-green-500" : progressPct >= 70 ? "bg-amber-500" : "bg-red-500"
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {target && <span className="text-xs text-gray-400">Target: {target}</span>}
        </div>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        <Card className="p-3 md:p-6 group cursor-pointer hover:shadow-md transition-shadow">
          {content}
        </Card>
      </Link>
    );
  }

  return (
    <Card className="p-3 md:p-6">
      {content}
    </Card>
  );
}
