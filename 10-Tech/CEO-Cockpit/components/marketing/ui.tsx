"use client";

/**
 * Shared presentational components for the brand marketing dashboards
 * (Spa / Aesthetics / Slimming). All components take a `brand` pair from
 * lib/constants/design-tokens BRAND so the three pages stay visually
 * identical while keeping their own brand palette.
 */

import { Card } from "@/components/ui/card";
import type { CampaignData } from "@/lib/types/ads";
import type { LucideIcon } from "lucide-react";
import { BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

export type BrandPair = { dark: string; soft: string };

/** Industry-average email benchmarks (Klaviyo 2024 Health & Wellness report) */
export const EMAIL_BENCHMARKS = { open: 21.5, click: 2.3, unsub: 0.5 };

/* ---------- helpers ---------- */

export function getRoasColor(roas: number): string {
  if (roas >= 5) return "#22C55E";
  if (roas >= 3) return "#F59E0B";
  return "#EF4444";
}

export function getFatigueStatus(frequency: number, ctr: number, peakCtr: number): { label: string; chartColor: string } {
  const ctrDrop = peakCtr > 0 ? (peakCtr - ctr) / peakCtr : 0;
  if (frequency > 3.0 && ctrDrop > 0.2) return { label: "Fatigued", chartColor: "#EF4444" };
  if (frequency >= 2.0 && ctrDrop >= 0.1) return { label: "Watch", chartColor: "#F59E0B" };
  return { label: "Healthy", chartColor: "#22C55E" };
}

export function getFatigueSummary(campaigns: { frequency: number; ctr: number; peakCtr: number }[]) {
  let healthy = 0, watch = 0, fatigued = 0;
  campaigns.forEach((c) => {
    const s = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
    if (s.label === "Healthy") healthy++;
    else if (s.label === "Watch") watch++;
    else fatigued++;
  });
  return { healthy, watch, fatigued };
}

export function buildCplChartData(campaigns: CampaignData[]) {
  return [...campaigns]
    .sort((a, b) => a.cpl - b.cpl)
    .map((c) => {
      const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
      return {
        name: c.campaign.length > 28 ? c.campaign.slice(0, 25) + "..." : c.campaign,
        cpl: c.cpl,
        color: status.chartColor,
      };
    });
}

export const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #F0EDE8",
  borderRadius: "10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  fontSize: "12px",
  fontWeight: 600,
  color: "#1A1A1A",
};

/* ---------- Page Header ---------- */

export function MarketingPageHeader({
  title,
  subtitle,
  brand,
  icon: Icon = BarChart3,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  brand: BrandPair;
  icon?: LucideIcon;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: brand.soft }}
          >
            <Icon className="h-4 w-4" style={{ color: brand.dark }} />
          </div>
          <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">{title}</h1>
          {badge && (
            <span
              className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border"
              style={{ backgroundColor: brand.soft, color: brand.dark, borderColor: brand.soft }}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 ml-11">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

/* ---------- Hero KPI Card ---------- */

export function HeroKPICard({
  label,
  value,
  brand,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  brand: BrandPair;
  icon?: LucideIcon;
  sub?: string;
}) {
  return (
    <Card className="relative p-5 hover:shadow-md transition-all duration-200 group cursor-default">
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{ backgroundColor: brand.dark }}
      />
      <div className="pl-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-2.5 leading-none">
            {label}
          </p>
          <p className="text-[1.65rem] font-black tracking-tight text-gray-900 leading-none tabular-nums">
            {value}
          </p>
          {sub && <p className="text-[11px] text-gray-400 mt-2 font-medium">{sub}</p>}
        </div>
        {Icon && (
          <div
            className="rounded-xl p-2.5 shrink-0 transition-transform duration-200 group-hover:scale-110"
            style={{ backgroundColor: brand.soft }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: brand.dark }} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- Aggregate Metric Box ---------- */

export function AggregateBox({
  label,
  value,
  brand,
  valueColor,
  icon: Icon,
}: {
  label: string;
  value: string;
  brand: BrandPair;
  valueColor?: string;
  icon?: LucideIcon;
}) {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ borderColor: brand.soft, backgroundColor: `${brand.soft}50` }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        {Icon && (
          <div className="rounded-lg p-1.5" style={{ backgroundColor: brand.soft }}>
            <Icon className="h-3 w-3" style={{ color: brand.dark }} />
          </div>
        )}
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-black tracking-tight tabular-nums" style={{ color: valueColor ?? brand.dark }}>
        {value}
      </p>
    </div>
  );
}

/* ---------- Email Progress Bar with industry benchmark ---------- */

export function EmailRateBar({
  label,
  value,
  max,
  color,
  benchmark,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  benchmark?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const benchmarkPct = benchmark !== undefined ? Math.min((benchmark / max) * 100, 100) : null;
  const isAbove = benchmark !== undefined && value >= benchmark;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-base font-black tabular-nums" style={{ color }}>{value}%</span>
          {benchmark !== undefined && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                isAbove ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
              }`}
            >
              {isAbove ? "▲" : "▼"} avg {benchmark}%
            </span>
          )}
        </div>
      </div>
      <div className="relative w-full h-2 bg-gray-100 rounded-full overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {benchmarkPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-px h-4 bg-gray-400/70 rounded-full"
            style={{ left: `${benchmarkPct}%` }}
          />
        )}
      </div>
      {benchmark !== undefined && (
        <p className="text-[10px] text-gray-400 mt-1.5">Industry avg: {benchmark}%</p>
      )}
    </div>
  );
}

/* ---------- Channel Section Header ---------- */

export function ChannelHeader({
  title,
  brand,
  channelLabel,
  channelVariant,
  roasLabel,
  roasValue,
  children,
}: {
  title: string;
  brand: BrandPair;
  channelLabel?: string;
  channelVariant?: "meta" | "google" | "email" | "seo";
  roasLabel?: string;
  roasValue?: string;
  children?: React.ReactNode;
}) {
  const channelStyles: Record<string, string> = {
    meta:   "bg-blue-50   text-blue-700   border-blue-100",
    google: "bg-emerald-50 text-emerald-700 border-emerald-100",
    email:  "bg-violet-50 text-violet-700  border-violet-100",
    seo:    "bg-orange-50  text-orange-700  border-orange-100",
  };
  const style = channelVariant ? channelStyles[channelVariant] : "";

  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-3">
        <h2 className="text-[15px] font-bold text-gray-900 tracking-tight">{title}</h2>
        {channelLabel && (
          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border ${style}`}>
            {channelLabel}
          </span>
        )}
        {children}
      </div>
      {roasLabel && roasValue && (
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">{roasLabel}</p>
          <p className="text-xl font-black leading-tight tabular-nums" style={{ color: brand.dark }}>{roasValue}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Fatigue Pill Row ---------- */

export function FatiguePills({ healthy, watch, fatigued }: { healthy: number; watch: number; fatigued: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-700">
        <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
        {healthy} Healthy
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-600">
        <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
        {watch} Watch
      </span>
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-600">
        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
        {fatigued} Fatigued
      </span>
    </div>
  );
}

/* ---------- CPL horizontal bar chart ---------- */

export function CplBarChart({
  data,
  brand,
  className,
}: {
  data: { name: string; cpl: number; color: string }[];
  brand: BrandPair;
  className?: string;
}) {
  return (
    <div className={className ?? "h-[180px] md:h-[220px]"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
          <XAxis
            type="number"
            tickFormatter={(v: number) => `€${v}`}
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "#6B7280" }}
            width={150}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: `${brand.soft}40` }}
            formatter={(value) => [`€${Number(value).toFixed(1)}`, "CPL"]}
          />
          <Bar dataKey="cpl" name="CPL" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
            <LabelList
              dataKey="cpl"
              position="right"
              formatter={(v) => `€${Number(v).toFixed(1)}`}
              style={{ fontSize: 11, fontWeight: 700, fill: "#374151" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Table badges ---------- */

export function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
        channel === "Meta"
          ? "bg-blue-50 text-blue-700 border-blue-100"
          : "bg-emerald-50 text-emerald-700 border-emerald-100"
      }`}
    >
      {channel}
    </span>
  );
}

export function ActionBadge({ rec }: { rec: string }) {
  const styles: Record<string, string> = {
    Scale:    "bg-green-50  text-green-700  border-green-200",
    Maintain: "bg-blue-50   text-blue-700   border-blue-200",
    Optimize: "bg-amber-50  text-amber-700  border-amber-200",
    Pause:    "bg-red-50    text-red-700    border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${styles[rec] ?? ""}`}>
      {rec}
    </span>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({ icon: Icon = BarChart3, message }: { icon?: LucideIcon; message: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="h-8 w-8 mx-auto mb-3 text-gray-300" />
      <p className="text-sm font-semibold text-gray-500">{message}</p>
    </div>
  );
}

/* ---------- Portfolio totals strip ---------- */

export function PortfolioTotals({
  brand,
  items,
}: {
  brand: BrandPair;
  items: { label: string; value: string; color?: string }[];
}) {
  return (
    <div
      className="mt-5 rounded-xl border p-5"
      style={{ borderColor: brand.soft, backgroundColor: `${brand.soft}30` }}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 mb-4">
        Portfolio Totals
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {items.map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 mb-1">{label}</p>
            <p className="text-lg font-black tracking-tight tabular-nums" style={{ color: color ?? brand.dark }}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
