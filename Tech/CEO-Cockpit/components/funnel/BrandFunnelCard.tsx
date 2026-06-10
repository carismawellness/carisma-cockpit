"use client";

import { Card } from "@/components/ui/card";
import { ArrowDown } from "lucide-react";
import { ConstraintBadge } from "./ConstraintBadge";
import {
  detectConstraint,
  overallConversionSeverity,
  leadsPerAgentSeverity,
  severityClasses,
  OVERALL_CONVERSION_BENCHMARK,
  LEADS_PER_DAY_PER_AGENT_MIN,
  type FunnelStage,
} from "@/lib/funnel/constraint-detection";
import { chartColors } from "@/lib/charts/config";
import { useFunnelMetrics } from "@/lib/hooks/useFunnelMetrics";

/* ------------------------------------------------------------------ */
/*  HSL helper                                                         */
/* ------------------------------------------------------------------ */

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 50 };
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ------------------------------------------------------------------ */
/*  Static agent counts per brand (CRM team)                          */
/* ------------------------------------------------------------------ */

const AGENT_COUNTS: Record<string, number> = {
  spa: 4,
  aesthetics: 4,
  slimming: 4,
};

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface BrandFunnelCardProps {
  brand: string;
  dateFrom: Date;
  dateTo: Date;
}

export function BrandFunnelCard({ brand, dateFrom, dateTo }: BrandFunnelCardProps) {
  const { byBrand, isLoading } = useFunnelMetrics(dateFrom, dateTo);
  const metrics = byBrand[brand];

  const color = chartColors[brand as keyof typeof chartColors] ?? "#888";
  const { h, s } = hexToHsl(color);
  const agentCount = AGENT_COUNTS[brand] ?? 4;

  if (isLoading) {
    return (
      <Card className="p-4 md:p-6 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-24 mb-4" />
        <div className="space-y-2">
          <div className="h-10 bg-gray-100 rounded" />
          <div className="h-10 bg-gray-100 rounded w-4/5 mx-auto" />
          <div className="h-10 bg-gray-100 rounded w-3/5 mx-auto" />
        </div>
      </Card>
    );
  }

  // Build funnel stages from real data
  const totalLeads = metrics?.totalLeads ?? 0;
  const totalBooked = metrics?.totalBooked ?? 0;

  const stages: FunnelStage[] = [
    { label: "Leads", value: totalLeads, conversionPct: null },
    {
      label: "Booked",
      value: totalBooked,
      conversionPct: totalLeads > 0 ? Math.round((totalBooked / totalLeads) * 1000) / 10 : 0,
    },
  ];

  const overallConversion = totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;
  const daysInPeriod = Math.max(
    1,
    Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const leadsPerDayPerAgent = agentCount > 0 ? totalLeads / daysInPeriod / agentCount : 0;

  const constraint = detectConstraint(stages);
  const convSeverity = overallConversionSeverity(overallConversion);
  const leadsSeverity = leadsPerAgentSeverity(leadsPerDayPerAgent);

  const maxValue = stages[0]?.value ?? 1;
  const hasData = totalLeads > 0;

  return (
    <Card className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-bold" style={{ color }}>
            {BRAND_LABELS[brand] ?? brand}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasData
              ? `${totalLeads.toLocaleString()} leads → ${totalBooked.toLocaleString()} booked`
              : "No data in period"}
          </p>
        </div>
        {hasData && <ConstraintBadge constraint={constraint} />}
      </div>

      {!hasData ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          CRM data not available for this period
        </p>
      ) : (
        <>
          {/* KPI pills */}
          <div className="flex gap-3 mb-5">
            <div className={`flex-1 text-center py-2 rounded-lg ${severityClasses[convSeverity].bg}`}>
              <p className={`text-lg font-bold ${severityClasses[convSeverity].text}`}>
                {overallConversion.toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Conv (target {OVERALL_CONVERSION_BENCHMARK}%)
              </p>
            </div>
            <div className={`flex-1 text-center py-2 rounded-lg ${severityClasses[leadsSeverity].bg}`}>
              <p className={`text-lg font-bold ${severityClasses[leadsSeverity].text}`}>
                {leadsPerDayPerAgent.toFixed(1)}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Leads/day/agent (min {LEADS_PER_DAY_PER_AGENT_MIN})
              </p>
            </div>
          </div>

          {/* Funnel bars */}
          <div className="space-y-1">
            {stages.map((stage, i) => {
              const widthPct = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
              const displayWidth = Math.max(widthPct, 20);
              const lightness = 40 + (i / Math.max(stages.length - 1, 1)) * 30;
              const bgColor = `hsl(${h}, ${s}%, ${lightness}%)`;
              const textColor = lightness < 55 ? "white" : "#1f2937";
              const dropOff = i > 0 ? stages[i - 1].value - stage.value : 0;

              return (
                <div key={stage.label}>
                  {i > 0 && dropOff > 0 && (
                    <div className="flex items-center justify-center gap-2 py-0.5">
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">
                        {dropOff.toLocaleString()} lost &middot; {stage.conversionPct?.toFixed(1)}%
                      </span>
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex justify-center">
                    <div
                      className="relative rounded-lg px-3 py-2.5 transition-all duration-300"
                      style={{ width: `${displayWidth}%`, backgroundColor: bgColor, minHeight: 40 }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate" style={{ color: textColor }}>
                          {stage.label}
                        </span>
                        <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: textColor }}>
                          {stage.value.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Meta CPL chip */}
          {(metrics?.metaCpl ?? 0) > 0 && (
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Meta CPL: <span className="font-semibold text-foreground">€{metrics!.metaCpl.toFixed(2)}</span></span>
              <span>STL: <span className="font-semibold text-foreground">{metrics!.stlMedian > 0 ? `${metrics!.stlMedian}m` : "—"}</span></span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
