"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ArrowDown } from "lucide-react";

interface FunnelStage {
  label: string;
  value: number;
  conversionRate?: number;
  showRate?: number;
}

interface FunnelSplit {
  label: string;
  value: number;
  conversionRate: number;
  color?: string;
  description?: string;
}

interface FunnelChartProps {
  stages: FunnelStage[];
  title: string;
  subtitle?: string;
  color?: string;
  /** Optional fork at the end (e.g. Regular vs Max Course) */
  split?: FunnelSplit[];
  /** Stat pills displayed in the header area */
  showRates?: { label: string; value: number }[];
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 50 };

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function FunnelChart({
  stages,
  title,
  color = "#B79E61",
  subtitle,
  split,
  showRates,
}: FunnelChartProps) {
  if (stages.length === 0) return null;

  const maxValue = stages[0].value;
  const { h, s } = hexToHsl(color);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-charcoal">
              {title}
            </CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>

          {/* Stat pills in header */}
          {showRates && showRates.length > 0 && (
            <div className="flex gap-3">
              {showRates.map((pill) => (
                <div
                  key={pill.label}
                  className="text-center px-4 py-2 rounded-lg"
                  style={{
                    backgroundColor: `hsl(${h}, ${s}%, 95%)`,
                  }}
                >
                  <p
                    className="text-xl font-bold"
                    style={{ color: `hsl(${h}, ${s}%, 35%)` }}
                  >
                    {pill.value.toFixed(0)}%
                  </p>
                  <p
                    className="text-[10px] uppercase tracking-wider font-medium"
                    style={{ color: `hsl(${h}, ${s}%, 40%)` }}
                  >
                    {pill.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {stages.map((stage, index) => {
          const widthPct = maxValue > 0 ? (stage.value / maxValue) * 100 : 0;
          const minWidth = 20;
          const displayWidth = Math.max(widthPct, minWidth);

          // Gradient: darker at top, lighter at bottom
          const lightness =
            40 + (index / Math.max(stages.length - 1, 1)) * 30;
          const bgColor = `hsl(${h}, ${s}%, ${lightness}%)`;
          const textColor = lightness < 55 ? "white" : "#1f2937";

          const dropOff =
            index > 0 ? stages[index - 1].value - stage.value : 0;

          return (
            <div key={stage.label}>
              {/* Drop-off indicator */}
              {index > 0 && dropOff > 0 && (
                <div className="flex items-center justify-center gap-2 py-1">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {dropOff.toLocaleString()} lost
                    {stage.conversionRate !== undefined && (
                      <>
                        {" "}
                        &middot; {stage.conversionRate.toFixed(1)}% conversion
                      </>
                    )}
                  </span>
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                </div>
              )}

              {/* Funnel bar */}
              <div className="flex justify-center">
                <div
                  className="relative rounded-lg px-4 py-3 transition-all duration-300"
                  style={{
                    width: `${displayWidth}%`,
                    backgroundColor: bgColor,
                    minHeight: 48,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: textColor }}
                    >
                      {stage.label}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-lg font-bold tabular-nums"
                        style={{ color: textColor }}
                      >
                        {stage.value.toLocaleString()}
                      </span>
                      {stage.showRate !== undefined && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            backgroundColor: `hsl(${h}, ${s}%, ${Math.max(lightness - 12, 20)}%)`,
                            color: "white",
                          }}
                        >
                          {stage.showRate.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Optional split / fork at the bottom */}
        {split && split.length > 0 && (
          <div className="pt-4">
            {/* Divider */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className="h-px flex-1"
                style={{ backgroundColor: `hsl(${h}, ${s}%, 80%)` }}
              />
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: `hsl(${h}, ${s}%, 40%)` }}
              >
                Split
              </span>
              <div
                className="h-px flex-1"
                style={{ backgroundColor: `hsl(${h}, ${s}%, 80%)` }}
              />
            </div>

            <div className="flex gap-6">
              {split.map((branch) => {
                const branchColor = branch.color || color;
                const { h: bh, s: bs } = hexToHsl(branchColor);
                return (
                  <div key={branch.label} className="flex-1">
                    <div
                      className="relative h-16 rounded-xl flex items-center justify-between px-5"
                      style={{
                        background: `linear-gradient(135deg, hsl(${bh}, ${bs}%, 40%), hsl(${bh}, ${bs}%, 55%))`,
                        boxShadow: `0 4px 12px hsla(${bh}, ${bs}%, 40%, 0.3)`,
                      }}
                    >
                      <div className="absolute -top-3 left-4">
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm bg-white"
                          style={{
                            color: branchColor,
                            border: `1px solid ${branchColor}33`,
                          }}
                        >
                          {branch.label}
                        </span>
                      </div>
                      <span className="text-white font-bold text-2xl mt-1">
                        {branch.value}
                      </span>
                      <span className="text-white/80 text-sm font-medium mt-1">
                        {branch.conversionRate.toFixed(0)}% conv
                      </span>
                    </div>
                    {branch.description && (
                      <div className="mt-2 text-center">
                        <span className="text-xs text-muted-foreground">
                          {branch.description}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export type { FunnelStage, FunnelSplit, FunnelChartProps };
