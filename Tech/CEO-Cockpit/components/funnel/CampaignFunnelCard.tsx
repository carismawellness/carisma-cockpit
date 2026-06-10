"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import {
  overallConversionSeverity,
  severityClasses,
  OVERALL_CONVERSION_BENCHMARK,
} from "@/lib/funnel/constraint-detection";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CampaignFunnel {
  campaignName: string;
  spend: number;
  cpl: number;
  leads: number;
  contacted: number;
  qualified: number;
  booked: number;
  showed: number;
  conversionPct: number;
  showRatePct: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface CampaignFunnelCardProps {
  campaign: CampaignFunnel;
  brandColor: string;
}

export function CampaignFunnelCard({ campaign, brandColor }: CampaignFunnelCardProps) {
  const convSev = overallConversionSeverity(campaign.conversionPct);
  const showSev = campaign.showRatePct >= 80 ? "green" : campaign.showRatePct >= 65 ? "amber" : "red";

  const stages = [
    { label: "Leads", value: campaign.leads },
    { label: "Contacted", value: campaign.contacted },
    { label: "Qualified", value: campaign.qualified },
    { label: "Booked", value: campaign.booked },
    { label: "Showed", value: campaign.showed },
  ];

  const maxValue = stages[0]?.value ?? 1;

  return (
    <Card className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground truncate">
            {campaign.campaignName}
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Spend: {formatCurrency(campaign.spend)} &middot; CPL: &euro;{campaign.cpl.toFixed(1)}
          </p>
        </div>
        <div className="flex gap-2 ml-3 shrink-0">
          <div className={`text-center px-2 py-1 rounded ${severityClasses[convSev].bg}`}>
            <p className={`text-xs font-bold ${severityClasses[convSev].text}`}>
              {campaign.conversionPct.toFixed(1)}%
            </p>
            <p className="text-[9px] text-muted-foreground">Conv</p>
          </div>
          <div className={`text-center px-2 py-1 rounded ${severityClasses[showSev].bg}`}>
            <p className={`text-xs font-bold ${severityClasses[showSev].text}`}>
              {campaign.showRatePct.toFixed(1)}%
            </p>
            <p className="text-[9px] text-muted-foreground">Show</p>
          </div>
        </div>
      </div>

      {/* Compact horizontal bars — count + conv % per stage */}
      <div className="space-y-1.5">
        {stages.map((stage, i) => {
          const widthPct = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
          const prevValue = i > 0 ? stages[i - 1].value : stage.value;
          const stageConvPct = i === 0
            ? 100
            : prevValue > 0
              ? (stage.value / prevValue) * 100
              : 0;
          return (
            <div key={stage.label} className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground w-16 text-right shrink-0">
                {stage.label}
              </span>
              <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.max(widthPct, 10)}%`,
                    backgroundColor: brandColor,
                    opacity: 0.7 + (widthPct / 100) * 0.3,
                  }}
                >
                  <span className="text-[10px] font-bold tabular-nums text-white">
                    {stage.value.toLocaleString()}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-medium text-muted-foreground tabular-nums w-12 text-right shrink-0">
                {stageConvPct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
