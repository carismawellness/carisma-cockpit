"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useSlmAnalytics } from "@/lib/hooks/useSlmAnalytics";
import { formatCurrency } from "@/lib/charts/config";

const SLM_NAVY = "#1B3A4B";
const SLM_TEAL = "#4A90D9";

function SlimmingDeepContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { total_revenue, package_revenue, treatment_revenue, staff, programs, isFetching, error } =
    useSlmAnalytics(dateFrom, dateTo);

  const empty = (label: string) => (
    <p className="text-sm text-muted-foreground py-4 text-center">
      {isFetching ? "Loading…" : label}
    </p>
  );

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Slimming</h1>
        <p className="text-sm text-muted-foreground">All figures in EUR · live from Lapis sheet · Packages = Paid column · Treatments = Price column</p>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Total Revenue",      value: formatCurrency(total_revenue),     color: SLM_NAVY },
          { label: "Package Sales",      value: formatCurrency(package_revenue),   color: SLM_NAVY },
          { label: "Treatment Revenue",  value: formatCurrency(treatment_revenue), color: SLM_TEAL },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          </Card>
        ))}
      </div>

      {/* ── Staff Performance ─────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Staff Performance</h2>
        <p className="text-xs text-muted-foreground mb-3">Sales reps from Sales-Slimming + therapists from Tx-Slimming</p>
        {staff.length === 0 ? empty("No data for selected period") : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Staff</th>
                  <th className="text-right pb-2 font-medium">Txns</th>
                  <th className="text-right pb-2 font-medium">Revenue</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s, i) => {
                  const pct = total_revenue > 0 ? (s.revenue / total_revenue) * 100 : 0;
                  return (
                    <tr key={s.name} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="py-2.5 font-medium">{s.name}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{s.txn_count}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(s.revenue)}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: SLM_NAVY }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="pt-2.5">Total</td>
                  <td className="pt-2.5 text-right text-muted-foreground">
                    {staff.reduce((s, r) => s + r.txn_count, 0)}
                  </td>
                  <td className="pt-2.5 text-right">{formatCurrency(total_revenue)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Programmes & Treatments ───────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Programmes &amp; Treatments Breakdown</h2>
        <p className="text-xs text-muted-foreground mb-3">Weight loss programmes (Paid) + individual treatments (Price)</p>
        {programs.length === 0 ? empty("No data for selected period") : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Programme / Treatment</th>
                  <th className="text-right pb-2 font-medium">Txns</th>
                  <th className="text-right pb-2 font-medium">Revenue</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {programs.map((p, i) => {
                  const pct = total_revenue > 0 ? (p.revenue / total_revenue) * 100 : 0;
                  return (
                    <tr key={p.program} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="py-2.5 font-medium">{p.program}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{p.txn_count}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(p.revenue)}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: SLM_TEAL }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function SlimmingDeepPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <SlimmingDeepContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
