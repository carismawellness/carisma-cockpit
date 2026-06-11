"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { toLocalDateStr } from "@/lib/utils/dates";
import { BRAND, type BrandKey } from "@/lib/constants/design-tokens";
import {
  overallConversionSeverity,
  severityClasses,
} from "@/lib/funnel/constraint-detection";
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
/*  Campaign table                                                     */
/* ------------------------------------------------------------------ */

function RoasCell({ roas }: { roas: number | null }) {
  if (roas === null || roas <= 0) {
    return (
      <div className="text-center py-1 rounded-lg bg-gray-50">
        <span className="text-sm font-bold text-gray-400">—</span>
      </div>
    );
  }
  const sev = roasSeverity(roas);
  return (
    <div className={`text-center py-1 rounded-lg ${severityClasses[sev].bg}`}>
      <span className={`text-sm font-bold ${severityClasses[sev].text}`}>{roas.toFixed(1)}x</span>
    </div>
  );
}

// Fixed column widths so the Spa / Aesthetics / Slimming tables line up
// vertically. Campaign column takes the remaining space; every numeric
// column gets the same fixed width across all three brand tables.
const COLS = {
  campaign:   "auto",
  conv:       "84px",
  cpl:        "72px",
  aov:        "80px",
  spend:      "88px",
  dailySpend: "100px",
  expRev:     "96px",
  expRoas:    "92px",
} as const;
const MIN_TABLE_WIDTH = 720;

function CampaignTable({ campaigns, totals, brandColor }: {
  campaigns: DrilldownCampaign[];
  totals: DrilldownBrand["totals"];
  brandColor: string;
}) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <div className="px-4 md:px-0" style={{ minWidth: MIN_TABLE_WIDTH }}>
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: COLS.campaign }} />
            <col style={{ width: COLS.conv }} />
            <col style={{ width: COLS.cpl }} />
            <col style={{ width: COLS.aov }} />
            <col style={{ width: COLS.spend }} />
            <col style={{ width: COLS.dailySpend }} />
            <col style={{ width: COLS.expRev }} />
            <col style={{ width: COLS.expRoas }} />
          </colgroup>
          <thead>
            <tr className="border-b border-warm-border">
              <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Campaign</th>
              <th className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider" style={{ color: brandColor }}>Conv %</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">CPL</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">AOV</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Spend</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Daily Spend</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Exp. Rev</th>
              <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Exp. ROAS</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map(c => {
              const convSev = c.conversionPct !== null ? overallConversionSeverity(c.conversionPct) : "off";
              return (
                <tr key={c.campaignId} className="border-b border-warm-border/50 last:border-0">
                  <td className="py-2.5 pr-3 text-sm font-medium text-foreground truncate">{c.campaignName}</td>

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

                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">
                    {c.cpl !== null ? `€${c.cpl.toFixed(1)}` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">{formatCurrency(c.aov)}</td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">{formatCurrency(c.spend)}</td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">
                    {c.dailySpend > 0 ? `${formatCurrency(c.dailySpend)}/d` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-2 text-center text-sm text-foreground tabular-nums">
                    {c.expectedRevenue > 0 ? formatCurrency(c.expectedRevenue) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2 px-2"><RoasCell roas={c.expectedRoas} /></td>
                </tr>
              );
            })}
          </tbody>

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
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">
                {totals.avgCpl !== null ? `€${totals.avgCpl.toFixed(1)}` : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-muted-foreground">—</td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">{formatCurrency(totals.spend)}</td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">
                {totals.dailySpend > 0 ? `${formatCurrency(totals.dailySpend)}/d` : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2.5 px-2 text-center text-sm font-semibold text-foreground tabular-nums">
                {totals.expectedRevenue > 0 ? formatCurrency(totals.expectedRevenue) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2 px-2"><RoasCell roas={totals.expectedRoas} /></td>
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
    const from = toLocalDateStr(dateFrom);
    const to   = toLocalDateStr(dateTo);
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
        <div className="space-y-6">
          <TableSkeleton rows={5} columns={6} />
          <TableSkeleton rows={5} columns={6} />
        </div>
      )}

      {!loading && brandData && (
        <div className="space-y-6">
          {BRANDS.map(brand => {
            const d          = brandData[brand.slug];
            const brandColor = BRAND[brand.slug as BrandKey]?.dark ?? "#888";
            const campaigns  = d?.campaigns ?? [];

            return (
              <Card key={brand.slug} className="p-4 md:p-6">
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: brandColor }}>
                  {brand.label}
                </h3>

                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No campaign data for this period</p>
                ) : (
                  <CampaignTable campaigns={campaigns} totals={d.totals} brandColor={brandColor} />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
