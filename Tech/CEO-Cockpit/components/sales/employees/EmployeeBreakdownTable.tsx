"use client";

// Simple ranked breakdown table (services or retail products) for an
// employee dashboard. Styled to match the inline tables on app/sales pages.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BreakdownRow } from "@/lib/sales-employees/types";

export interface EmployeeBreakdownTableProps {
  title: string;
  rows: BreakdownRow[];
  /** Cap displayed rows (default 15). */
  maxRows?: number;
}

function fmtEur(v: number): string {
  if (!Number.isFinite(v)) return "€0.00";
  return new Intl.NumberFormat("en-MT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

export function EmployeeBreakdownTable({ title, rows, maxRows = 15 }: EmployeeBreakdownTableProps) {
  const visible = rows.slice(0, maxRows);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing sold in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left py-2 font-medium w-8">#</th>
                  <th className="text-left py-2 font-medium">Name</th>
                  <th className="text-right py-2 font-medium">Revenue</th>
                  <th className="text-right py-2 font-medium">Quantity</th>
                  <th className="text-right py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr key={row.name} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3">{row.name}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{fmtEur(row.revenue)}</td>
                    <td className="py-2 text-right tabular-nums">{row.tx_count}</td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {totalRevenue > 0 ? `${((row.revenue / totalRevenue) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > maxRows && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing top {maxRows} of {rows.length}.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
