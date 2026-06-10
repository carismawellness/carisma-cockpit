"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  severityClasses,
  severityColor,
  overallConversionSeverity,
  leadsPerAgentSeverity,
  OVERALL_CONVERSION_BENCHMARK,
  LEADS_PER_DAY_PER_AGENT_MIN,
} from "@/lib/funnel/constraint-detection";
import { chartColors } from "@/lib/charts/config";
import type { BrandHeatmapMetrics } from "@/app/api/funnel/constraint-heatmap/route";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const BRANDS = ["spa", "aesthetics", "slimming"] as const;
const BRAND_LABELS: Record<string, string> = { spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming" };

/* ------------------------------------------------------------------ */
/*  Row builder                                                        */
/* ------------------------------------------------------------------ */

type HeatmapCell = { formatted: string; severity: "green" | "amber" | "red" | "off" };
type HeatmapRow  = { metric: string; benchmark: string | null; cells: HeatmapCell[] };

function buildRows(brands: Record<string, BrandHeatmapMetrics>): HeatmapRow[] {
  function cell(
    v: number | null,
    format: (n: number) => string,
    sev: (n: number) => "green" | "amber" | "red",
  ): HeatmapCell {
    if (v === null || v === undefined) return { formatted: "—", severity: "off" };
    return { formatted: format(v), severity: sev(v) };
  }

  return [
    {
      metric: "Ad Refresh", benchmark: "≤14d",
      cells: BRANDS.map(b => cell(
        brands[b]?.ad_refresh_days,
        n => `${n}d`,
        n => (n <= 14 ? "green" : n <= 30 ? "amber" : "red"),
      )),
    },
    {
      metric: "Daily Leads", benchmark: null,
      cells: BRANDS.map(b => cell(
        brands[b]?.daily_leads,
        n => Math.round(n).toString(),
        () => "green",
      )),
    },
    {
      metric: "Cost per Lead", benchmark: "≤€12",
      cells: BRANDS.map(b => cell(
        brands[b]?.cpl,
        n => `€${n.toFixed(1)}`,
        n => severityColor(12, n),  // lower is better: severityColor(max, actual)
      )),
    },
    {
      metric: "Speed to Lead", benchmark: "≤5m",
      cells: BRANDS.map(b => cell(
        brands[b]?.speed_to_lead_min,
        n => `${n.toFixed(1)}m`,
        n => severityColor(5, n),
      )),
    },
    {
      metric: "Leads/Day/Agent", benchmark: String(LEADS_PER_DAY_PER_AGENT_MIN),
      cells: BRANDS.map(b => cell(
        brands[b]?.leads_per_agent,
        n => n.toFixed(1),
        n => leadsPerAgentSeverity(n),
      )),
    },
    {
      metric: "Booking Conversion", benchmark: `${OVERALL_CONVERSION_BENCHMARK}%`,
      cells: BRANDS.map(b => cell(
        brands[b]?.booking_conversion,
        n => `${n.toFixed(1)}%`,
        n => overallConversionSeverity(n),
      )),
    },
    {
      metric: "Deposit Rate", benchmark: "70%",
      cells: BRANDS.map(b => cell(
        brands[b]?.deposit_rate,
        n => `${n.toFixed(1)}%`,
        n => severityColor(n, 70),
      )),
    },
    {
      metric: "Show Rate", benchmark: "80%",
      cells: BRANDS.map(b => cell(
        brands[b]?.show_rate_pct,
        n => `${n.toFixed(1)}%`,
        n => severityColor(n, 80),
      )),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props { dateFrom: Date; dateTo: Date }

export function ConstraintHeatmap({ dateFrom, dateTo }: Props) {
  const [brands, setBrands] = useState<Record<string, BrandHeatmapMetrics> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const from = dateFrom.toISOString().slice(0, 10);
    const to   = dateTo.toISOString().slice(0, 10);
    setLoading(true);
    fetch(`/api/funnel/constraint-heatmap?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(d => { setBrands(d.brands ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const rows = brands ? buildRows(brands) : [];

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Constraint Heatmap</h2>
        <p className="text-xs text-muted-foreground mt-0.5">2-second scan: which metrics are off?</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && brands && (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="min-w-[540px] px-4 md:px-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground uppercase tracking-wider w-48">Metric</th>
                  <th className="text-center py-2 px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Target</th>
                  {BRANDS.map(b => (
                    <th key={b} className="text-center py-2 px-3 text-xs font-semibold uppercase tracking-wider w-28"
                        style={{ color: chartColors[b] }}>
                      {BRAND_LABELS[b]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.metric} className="border-b border-warm-border/50 last:border-0">
                    <td className="py-2.5 pr-4 text-sm font-medium text-foreground">{row.metric}</td>
                    <td className="py-2.5 px-2 text-center text-xs text-muted-foreground">{row.benchmark ?? "-"}</td>
                    {row.cells.map((cell, i) => {
                      const c = severityClasses[cell.severity];
                      return (
                        <td key={BRANDS[i]} className="py-2.5 px-3">
                          <div className={`text-center py-1.5 rounded-lg ${c.bg}`}>
                            <span className={`text-sm font-bold ${c.text}`}>{cell.formatted}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-warm-border/50">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Legend:</span>
        {(["green", "amber", "red", "off"] as const).map(sev => (
          <span key={sev} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-sm ${severityClasses[sev].bg} border ${severityClasses[sev].border}`} />
            {sev === "green" ? "On track" : sev === "amber" ? "Watch" : sev === "red" ? "Action needed" : "No data"}
          </span>
        ))}
      </div>
    </Card>
  );
}
