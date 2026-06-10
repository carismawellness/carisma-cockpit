"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { chartColors, formatCurrency } from "@/lib/charts/config";
import {
  overallConversionSeverity,
  severityClasses,
} from "@/lib/funnel/constraint-detection";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { DrilldownCampaign, DrilldownBrand } from "@/app/api/funnel/campaign-drilldown/route";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BRANDS = [
  { slug: "spa",        label: "Spa"        },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "slimming",   label: "Slimming"   },
] as const;

function roasSeverity(roas: number): "green" | "amber" | "red" {
  if (roas >= 3) return "green";
  if (roas >= 2) return "amber";
  return "red";
}

/* ------------------------------------------------------------------ */
/*  Campaign chart                                                     */
/* ------------------------------------------------------------------ */

function CampaignChart({ campaigns, brandColor }: { campaigns: DrilldownCampaign[]; brandColor: string }) {
  const data = campaigns.map(c => ({
    name: c.campaignName.length > 18 ? c.campaignName.slice(0, 16) + "…" : c.campaignName,
    "Conv %": c.conversionPct ?? 0,
    "CPL": c.cpl,
  }));

  return (
    <div className="h-48 mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            interval={0} angle={-20} textAnchor="end" height={50}
          />
          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value, name) => name === "Conv %" ? `${Number(value).toFixed(1)}%` : `€${Number(value).toFixed(1)}`}
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Conv %" fill={brandColor} radius={[4, 4, 0, 0]} />
          <Bar dataKey="CPL" fill={brandColor} opacity={0.45} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Campaign table                                                     */
/* ------------------------------------------------------------------ */

function CampaignTable({ campaigns, totals, brandColor }: {
  campaigns: DrilldownCampaign[];
  totals: DrilldownBrand["totals"];
  brandColor: string;
}) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="min-w-[700px] px-4 md:px-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border">
              <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
              <th className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider" style={{ color: brandColor }}>Conv %</th>
              <th className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider" style={{ color: brandColor }}>Show %</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">CPL</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Spend</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Exp. Rev</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map(c => {
              const convSev  = c.conversionPct !== null ? overallConversionSeverity(c.conversionPct) : "off";
              const roasSev  = roasSeverity(c.roas);

              return (
                <tr key={c.campaignId} className="border-b border-warm-border/50 last:border-0">
                  <td className="py-2.5 pr-3 text-sm font-medium text-foreground">{c.campaignName}</td>

                  {/* Conv % — brand-level from GHL */}
                  <td className="py-2 px-2">
                    {c.conversionPct !== null ? (
                      <div className={`text-center py-1 rounded-lg ${severityClasses[convSev].bg}`}>
                        <span className={`text-sm font-bold ${severityClasses[convSev].text}`}>{c.conversionPct.toFixed(1)}%</span>
                      </div>
                    ) : (
                      <div className="text-center py-1 rounded-lg bg-gray-50">
                        <span className="text-sm font-bold text-gray-400">—</span>
                      </div>
                    )}
                  </td>

                  {/* Show % — not yet in DB */}
                  <td className="py-2 px-2">
                    <div className="text-center py-1 rounded-lg bg-gray-50">
                      <span className="text-sm font-bold text-gray-400">—</span>
                    </div>
                  </td>

                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">€{c.cpl.toFixed(1)}</td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">{formatCurrency(c.spend)}</td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">
                    {c.expectedRevenue > 0 ? formatCurrency(c.expectedRevenue) : <span className="text-muted-foreground">—</span>}
                  </td>

                  <td className="py-2 px-2">
                    {c.roas > 0 ? (
                      <div className={`text-center py-1 rounded-lg ${severityClasses[roasSev].bg}`}>
                        <span className={`text-sm font-bold ${severityClasses[roasSev].text}`}>{c.roas.toFixed(1)}x</span>
                      </div>
                    ) : (
                      <div className="text-center py-1 rounded-lg bg-gray-50">
                        <span className="text-sm font-bold text-gray-400">—</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Totals row */}
          <tfoot>
            <tr className="border-t-2 border-warm-border">
              <td className="py-2.5 pr-3 text-sm font-semibold text-foreground">Total / Avg</td>
              <td className="py-2 px-2">
                {totals.conversionPct !== null ? (
                  <div className={`text-center py-1 rounded-lg ${severityClasses[overallConversionSeverity(totals.conversionPct)].bg}`}>
                    <span className={`text-sm font-bold ${severityClasses[overallConversionSeverity(totals.conversionPct)].text}`}>
                      {totals.conversionPct.toFixed(1)}%
                    </span>
                  </div>
                ) : (
                  <div className="text-center py-1 rounded-lg bg-gray-50">
                    <span className="text-sm font-bold text-gray-400">—</span>
                  </div>
                )}
              </td>
              <td className="py-2 px-2">
                <div className="text-center py-1 rounded-lg bg-gray-50">
                  <span className="text-sm font-bold text-gray-400">—</span>
                </div>
              </td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">€{totals.avgCpl.toFixed(1)}</td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">{formatCurrency(totals.spend)}</td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">
                {totals.expectedRevenue > 0 ? formatCurrency(totals.expectedRevenue) : <span className="text-muted-foreground">—</span>}
              </td>
              {(() => {
                const roasSev = roasSeverity(totals.roas);
                return (
                  <td className="py-2 px-2">
                    {totals.roas > 0 ? (
                      <div className={`text-center py-1 rounded-lg ${severityClasses[roasSev].bg}`}>
                        <span className={`text-sm font-bold ${severityClasses[roasSev].text}`}>{totals.roas.toFixed(1)}x</span>
                      </div>
                    ) : (
                      <div className="text-center py-1 rounded-lg bg-gray-50">
                        <span className="text-sm font-bold text-gray-400">—</span>
                      </div>
                    )}
                  </td>
                );
              })()}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

interface Props { dateFrom: Date; dateTo: Date }

export function CampaignFunnelPanel({ dateFrom, dateTo }: Props) {
  const [brandData, setBrandData] = useState<Record<string, DrilldownBrand> | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const from = dateFrom.toISOString().slice(0, 10);
    const to   = dateTo.toISOString().slice(0, 10);
    setLoading(true);
    fetch(`/api/funnel/campaign-drilldown?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { setBrandData(d.brands ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dateFrom, dateTo]);

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Campaign Drill-Down</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Per-campaign Meta metrics — conv % sourced at brand level from GHL · show % not yet available
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && brandData && (
        <div className="space-y-6">
          {BRANDS.map(brand => {
            const d          = brandData[brand.slug];
            const brandColor = chartColors[brand.slug as keyof typeof chartColors] ?? "#888";
            const campaigns  = d?.campaigns ?? [];

            return (
              <Card key={brand.slug} className="p-4 md:p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: brandColor }}>
                  {brand.label}
                </h3>

                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No campaign data for this period</p>
                ) : (
                  <>
                    <CampaignTable campaigns={campaigns} totals={d.totals} brandColor={brandColor} />
                    <CampaignChart campaigns={campaigns} brandColor={brandColor} />
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
