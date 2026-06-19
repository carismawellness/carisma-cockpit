"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";

interface ServiceItem {
  service: string;
  revenue: number;
  pct: number;
}

interface ServiceBreakdownChartProps {
  title?: string;
  data: ServiceItem[];
  color: string;
}

export function ServiceBreakdownChart({
  title = "Service Revenue Breakdown",
  data,
  color,
}: ServiceBreakdownChartProps) {
  if (data.length === 0) return null;

  const total = data.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <span className="text-sm font-medium text-muted-foreground tabular-nums">
          Total: {formatCurrency(total)}
        </span>
      </div>
      <div className="space-y-3">
        {data.map((svc) => (
          <div key={svc.service} className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground w-36 shrink-0 truncate">
              {svc.service}
            </span>
            <div className="flex-1 h-7 bg-gray-100 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full flex items-center justify-end pr-2"
                style={{
                  width: `${Math.max(svc.pct, 8)}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                }}
              >
                {svc.pct >= 12 && (
                  <span className="text-[10px] font-semibold text-white tabular-nums">
                    {svc.pct.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <span className="text-sm font-semibold text-foreground w-20 text-right tabular-nums">
              {formatCurrency(svc.revenue)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export type { ServiceItem, ServiceBreakdownChartProps };
