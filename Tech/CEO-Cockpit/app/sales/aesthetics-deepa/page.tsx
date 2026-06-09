"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { useAesAnalytics } from "@/lib/hooks/useAesAnalytics";
import { formatCurrency } from "@/lib/charts/config";

const AES_NAVY = "#1B3A4B";

function AestheticsDeepContent({ dateFrom, dateTo }: { dateFrom: Date; dateTo: Date }) {
  const { total_revenue_ex_vat, transaction_count, staff, services, paymentTypes, isFetching, error } =
    useAesAnalytics(dateFrom, dateTo);

  const totalRev = total_revenue_ex_vat;
  const empty = (label: string) => (
    <p className="text-sm text-muted-foreground py-4 text-center">
      {isFetching ? "Loading…" : label}
    </p>
  );

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Aesthetics</h1>
        <p className="text-sm text-muted-foreground">All figures in EUR · ex-VAT · live from Lapis sheet</p>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
      )}

      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: "Revenue ex-VAT", value: formatCurrency(total_revenue_ex_vat) },
          { label: "Transactions",   value: transaction_count.toLocaleString() },
          { label: "Avg per Txn",    value: transaction_count > 0 ? formatCurrency(total_revenue_ex_vat / transaction_count) : "—" },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
          </Card>
        ))}
      </div>

      {/* ── Staff Performance ─────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Staff Performance</h2>
        {staff.length === 0 ? empty("No data for selected period") : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Staff</th>
                  <th className="text-right pb-2 font-medium">Txns</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s, i) => {
                  const pct = totalRev > 0 ? (s.revenue / totalRev) * 100 : 0;
                  return (
                    <tr key={s.name} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="py-2.5 font-medium">{s.name}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{s.count}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(s.revenue)}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: AES_NAVY }} />
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
                  <td className="pt-2.5 text-right text-muted-foreground">{transaction_count}</td>
                  <td className="pt-2.5 text-right">{formatCurrency(totalRev)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* ── Service Breakdown ─────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Revenue by Service</h2>
        {services.length === 0 ? empty("No data for selected period") : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Service / Product</th>
                  <th className="text-right pb-2 font-medium">Txns</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s, i) => {
                  const pct = totalRev > 0 ? (s.revenue / totalRev) * 100 : 0;
                  return (
                    <tr key={s.service} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="py-2.5 font-medium">{s.service}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{s.count}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(s.revenue)}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: AES_NAVY }} />
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

      {/* ── Payment Types ─────────────────────────────────────────────── */}
      <Card className="p-4 md:p-5">
        <h2 className="text-base font-semibold text-foreground mb-4">Payment Types</h2>
        {paymentTypes.length === 0 ? empty("No data for selected period") : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 font-medium">Type</th>
                  <th className="text-right pb-2 font-medium">Txns</th>
                  <th className="text-right pb-2 font-medium">Revenue ex-VAT</th>
                  <th className="text-left pb-2 pl-4 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {paymentTypes.map((p, i) => {
                  const pct = totalRev > 0 ? (p.revenue / totalRev) * 100 : 0;
                  return (
                    <tr key={p.type} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                      <td className="py-2.5 font-medium">{p.type}</td>
                      <td className="py-2.5 text-right text-muted-foreground">{p.count}</td>
                      <td className="py-2.5 text-right font-medium">{formatCurrency(p.revenue)}</td>
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct.toFixed(1)}%`, backgroundColor: AES_NAVY }} />
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

export default function AestheticsDeepPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo }) => (
        <AestheticsDeepContent dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </DashboardShell>
  );
}
