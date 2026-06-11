"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { ChartSkeleton, KPIGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useMetaCampaignsFromDb as useMetaCampaigns, useGoogleCampaignsFromDb as useGoogleCampaigns } from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoOverview } from "@/lib/hooks/useKlaviyoOverview";
import { FlowsTable } from "@/components/marketing/FlowsTable";
import { KeywordRankingsTable } from "@/components/marketing/KeywordRankingsTable";
import { BRAND } from "@/lib/constants/design-tokens";
import type { CampaignData } from "@/lib/types/ads";
import type { LucideIcon } from "lucide-react";
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
import {
  Euro,
  TrendingUp,
  Users,
  Wallet,
  MousePointerClick,
  BarChart3,
  Mail,
  Search,
  Activity,
  AlertTriangle,
} from "lucide-react";

/* ---------- constants ---------- */

const BRAND_COLOR = BRAND.spa.dark;
const BRAND_FILL  = BRAND.spa.soft;

/** Industry-average email benchmarks (Klaviyo 2024 Health & Wellness report) */
const EMAIL_BENCHMARKS = { open: 21.5, click: 2.3, unsub: 0.5 };

/* ---------- helpers ---------- */

function getFatigueStatus(frequency: number, ctr: number, peakCtr: number): { label: string; color: string; bg: string } {
  const ctrDrop = peakCtr > 0 ? (peakCtr - ctr) / peakCtr : 0;
  if (frequency > 3.0 && ctrDrop > 0.2) return { label: "Fatigued", color: "bg-red-500", bg: "bg-red-50 text-red-700" };
  if (frequency >= 2.0 && ctrDrop >= 0.1) return { label: "Watch", color: "bg-amber-500", bg: "bg-amber-50 text-amber-700" };
  return { label: "Healthy", color: "bg-green-500", bg: "bg-green-50 text-green-700" };
}

function getFatigueSummary(campaigns: { frequency: number; ctr: number; peakCtr: number }[]) {
  let healthy = 0, watch = 0, fatigued = 0;
  campaigns.forEach((c) => {
    const s = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
    if (s.label === "Healthy") healthy++;
    else if (s.label === "Watch") watch++;
    else fatigued++;
  });
  return { healthy, watch, fatigued };
}

function getRoasColor(roas: number): string {
  if (roas >= 5) return "#22C55E";
  if (roas >= 3) return "#F59E0B";
  return "#EF4444";
}

/* ---------- Hero KPI Card ---------- */

function HeroKPICard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  sub?: string;
}) {
  return (
    <Card className="relative p-5 hover:shadow-md transition-all duration-200 group cursor-default">
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
        style={{ backgroundColor: BRAND_COLOR }}
      />
      {/* Content */}
      <div className="pl-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-2.5 leading-none">
            {label}
          </p>
          <p className="text-[1.65rem] font-black tracking-tight text-gray-900 leading-none tabular-nums">
            {value}
          </p>
          {sub && (
            <p className="text-[11px] text-gray-400 mt-2 font-medium">{sub}</p>
          )}
        </div>
        {Icon && (
          <div
            className="rounded-xl p-2.5 shrink-0 transition-transform duration-200 group-hover:scale-110"
            style={{ backgroundColor: BRAND_FILL }}
          >
            <Icon className="h-[18px] w-[18px]" style={{ color: BRAND_COLOR }} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- Aggregate Metric Box ---------- */

function AggregateBox({
  label,
  value,
  valueColor,
  icon: Icon,
}: {
  label: string;
  value: string;
  valueColor?: string;
  icon?: LucideIcon;
}) {
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ borderColor: BRAND_FILL, backgroundColor: `${BRAND_FILL}50` }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        {Icon && (
          <div className="rounded-lg p-1.5" style={{ backgroundColor: BRAND_FILL }}>
            <Icon className="h-3 w-3" style={{ color: BRAND_COLOR }} />
          </div>
        )}
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">{label}</p>
      </div>
      <p className="text-xl font-black tracking-tight tabular-nums" style={{ color: valueColor ?? BRAND_COLOR }}>
        {value}
      </p>
    </div>
  );
}

/* ---------- Email Progress Bar ---------- */

function EmailRateBar({
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
          <span className="text-base font-black" style={{ color }}>{value}%</span>
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

function ChannelHeader({
  title,
  channelLabel,
  channelVariant,
  roasLabel,
  roasValue,
  children,
}: {
  title: string;
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
          <p className="text-xl font-black leading-tight" style={{ color: BRAND_COLOR }}>{roasValue}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Fatigue Pill Row ---------- */

function FatiguePills({ healthy, watch, fatigued }: { healthy: number; watch: number; fatigued: number }) {
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

/* ---------- Chart Tooltip style ---------- */

const TOOLTIP_STYLE = {
  background: "#ffffff",
  border: "1px solid #F0EDE8",
  borderRadius: "10px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  fontSize: "12px",
  fontWeight: 600,
  color: "#1A1A1A",
};

/* ---------- content component ---------- */

function SpaMarketingContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const queryClient = useQueryClient();
  const metaQuery = useMetaCampaigns("spa", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("spa", dateFrom, dateTo);
  const klaviyo = useKlaviyoOverview({ brand: "spa", dateFrom, dateTo });

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading || klaviyo.loading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* --- Klaviyo email metrics --- */
  const emailOpenRate    = Math.round(klaviyo.overview.openRate * 1000) / 10;
  const emailClickRate   = Math.round(klaviyo.overview.clickRate * 1000) / 10;
  const emailUnsubRate   = Math.round(klaviyo.overview.unsubscribeRate * 1000) / 10;
  const emailTotalSubscribers = klaviyo.overview.totalSubscribers;
  const campaignCount    = klaviyo.overview.campaignsSent;
  const flowCount        = klaviyo.overview.activeFlows;

  /* --- Fatigue checks --- */
  const metaFatigue   = useMemo(() => getFatigueSummary(metaCampaigns), [metaCampaigns]);
  const googleFatigue = useMemo(() => getFatigueSummary(googleCampaigns), [googleCampaigns]);
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const anyFatigued   = totalFatigued > 0;

  /* --- Column definitions (shared shape) --- */
  const campaignColumns = [
    {
      key: "campaign",
      label: "Campaign Name",
      render: (v: unknown) => (
        <button
          className="text-left font-semibold underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity"
          style={{ color: BRAND_COLOR }}
        >
          {v as string}
        </button>
      ),
    },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    {
      key: "dailyBudget",
      label: "Daily Budget",
      align: "right" as const,
      render: (v: unknown) => (v as number) > 0 ? formatCurrency(v as number) : "—",
    },
    { key: "totalSpend", label: "Total Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalLeads", label: "Total Leads", align: "right" as const, sortable: true },
    { key: "ctr", label: "CTR", align: "right" as const, sortable: true, render: (v: unknown) => `${(v as number).toFixed(1)}%` },
    { key: "cpm", label: "CPM", align: "right" as const, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "frequency", label: "Freq", align: "right" as const, render: (v: unknown) => (v as number).toFixed(1) },
    {
      key: "attributedRevenue",
      label: "Attributed Rev",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => (v as number) > 0 ? formatCurrency(v as number) : "—",
    },
  ];

  /* --- CPL chart data builders --- */
  const metaCplChartData = useMemo(
    () =>
      [...metaCampaigns]
        .sort((a, b) => a.cpl - b.cpl)
        .map((c) => {
          const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
          const color = status.label === "Fatigued" ? "#EF4444" : status.label === "Watch" ? "#F59E0B" : "#22C55E";
          return {
            name: c.campaign.length > 28 ? c.campaign.slice(0, 25) + "..." : c.campaign,
            cpl: c.cpl,
            color,
          };
        }),
    [metaCampaigns]
  );

  const googleCplChartData = useMemo(
    () =>
      [...googleCampaigns]
        .sort((a, b) => a.cpl - b.cpl)
        .map((c) => {
          const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
          const color = status.label === "Fatigued" ? "#EF4444" : status.label === "Watch" ? "#F59E0B" : "#22C55E";
          return {
            name: c.campaign.length > 28 ? c.campaign.slice(0, 25) + "..." : c.campaign,
            cpl: c.cpl,
            color,
          };
        }),
    [googleCampaigns]
  );

  /* --- Meta aggregate values --- */
  const metaTotalAttributed = useMemo(() => metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0), [metaCampaigns]);
  const metaTotalSpend      = useMemo(() => metaCampaigns.reduce((s, c) => s + c.totalSpend, 0), [metaCampaigns]);
  const metaRoasNum         = metaTotalSpend > 0 ? metaTotalAttributed / metaTotalSpend : 0;
  const metaRoas            = metaRoasNum.toFixed(1);

  /* --- Google aggregate values --- */
  const googleTotalAttributed = useMemo(() => googleCampaigns.reduce((s, c) => s + c.attributedRevenue, 0), [googleCampaigns]);
  const googleTotalSpend      = useMemo(() => googleCampaigns.reduce((s, c) => s + c.totalSpend, 0), [googleCampaigns]);
  const googleRoasNum         = googleTotalSpend > 0 ? googleTotalAttributed / googleTotalSpend : 0;
  const googleRoas            = googleRoasNum.toFixed(1);

  /* --- Profitability Matrix --- */
  const profitabilityData = useMemo(() => {
    const allCampaigns = [
      ...metaCampaigns.map((c) => ({ ...c, channel: "Meta" as const })),
      ...googleCampaigns.map((c) => ({ ...c, channel: "Google" as const })),
    ];
    return allCampaigns
      .map((c) => {
        const roas = c.totalSpend > 0 ? c.attributedRevenue / c.totalSpend : 0;
        const profit = c.attributedRevenue - c.totalSpend;
        const profitabilityPct = c.totalSpend > 0 ? ((c.attributedRevenue - c.totalSpend) / c.totalSpend) * 100 : 0;
        const recommendation = roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";
        return { campaign: c.campaign, channel: c.channel, totalLeads: c.totalLeads, totalSpend: c.totalSpend, cpl: c.cpl, attributedRevenue: c.attributedRevenue, roas, profit, profitabilityPct, recommendation };
      })
      .sort((a, b) => b.profitabilityPct - a.profitabilityPct);
  }, [metaCampaigns, googleCampaigns]);

  const profitabilityTotals = useMemo(() => {
    const totalLeads   = profitabilityData.reduce((s, c) => s + c.totalLeads, 0);
    const totalSpend   = profitabilityData.reduce((s, c) => s + c.totalSpend, 0);
    const totalRevenue = profitabilityData.reduce((s, c) => s + c.attributedRevenue, 0);
    const totalProfit  = totalRevenue - totalSpend;
    const totalRoas    = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const totalProfitPct = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;
    return { totalLeads, totalSpend, totalRevenue, totalProfit, totalRoas, totalProfitPct };
  }, [profitabilityData]);

  const profitabilityColumns = [
    {
      key: "campaign",
      label: "Campaign",
      render: (v: unknown) => (
        <button
          className="text-left font-semibold underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity"
          style={{ color: BRAND_COLOR }}
        >
          {v as string}
        </button>
      ),
    },
    {
      key: "channel",
      label: "Channel",
      render: (v: unknown) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
            (v as string) === "Meta"
              ? "bg-blue-50 text-blue-700 border-blue-100"
              : "bg-emerald-50 text-emerald-700 border-emerald-100"
          }`}
        >
          {v as string}
        </span>
      ),
    },
    { key: "totalLeads", label: "Leads", align: "right" as const, sortable: true },
    { key: "totalSpend", label: "Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "attributedRevenue", label: "Revenue", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    {
      key: "roas",
      label: "ROAS",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = v as number;
        return <span style={{ color: getRoasColor(val), fontWeight: 700 }}>{val.toFixed(1)}x</span>;
      },
    },
    {
      key: "profit",
      label: "Profit",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = v as number;
        return <span style={{ color: val >= 0 ? "#22C55E" : "#EF4444", fontWeight: 700 }}>{formatCurrency(val)}</span>;
      },
    },
    {
      key: "profitabilityPct",
      label: "Profit %",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = v as number;
        return <span style={{ color: val >= 0 ? "#22C55E" : "#EF4444", fontWeight: 700 }}>{val.toFixed(0)}%</span>;
      },
    },
    {
      key: "recommendation",
      label: "Action",
      align: "center" as const,
      render: (v: unknown) => {
        const rec = v as string;
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
      },
    },
  ];

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: BRAND_FILL }}
            >
              <BarChart3 className="h-4 w-4" style={{ color: BRAND_COLOR }} />
            </div>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">
              Spa Marketing
            </h1>
          </div>
          <p className="text-sm text-gray-500 ml-11">
            {formatDateRangeLabel(dateFrom, dateTo)} · Carisma Spa &amp; Wellness
          </p>
        </div>
        <SyncButton
          onSync={async () => {
            await Promise.all([
              fetch("/api/etl/meta-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "spa" }) }),
              fetch("/api/etl/google-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "spa" }) }),
              fetch("/api/etl/klaviyo-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "spa" }) }),
            ]);
            await queryClient.invalidateQueries({ queryKey: ["meta-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["google-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["klaviyo"] });
          }}
          isExternalBusy={isLoading}
        />
      </div>

      {/* ── Loading skeleton ─────────────────────────────────────────── */}
      {isLoading && (
        <KPIGridSkeleton count={6} className="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6" />
      )}

      {/* ── Error banners ────────────────────────────────────────────── */}
      {tokenExpired && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold text-amber-700">
            API token expired — update META_ACCESS_TOKEN or Google Ads credentials in .env.local
          </p>
        </div>
      )}

      {apiError && !tokenExpired && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm font-semibold text-red-700">API Error: {apiError}</p>
        </div>
      )}

      {/* ── Creative Fatigue Alert ───────────────────────────────────── */}
      {anyFatigued && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-center justify-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-sm font-bold text-red-700">
            Creative Fatigue Alert — {totalFatigued} campaign{totalFatigued !== 1 ? "s" : ""} need immediate attention
          </span>
        </div>
      )}

      {/* ── Section 1: Hero KPIs ────────────────────────────────────── */}
      {!isLoading && (() => {
        const totalMetaLeads    = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalGoogleLeads  = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalLeads        = totalMetaLeads + totalGoogleLeads;
        const totalMetaSpend    = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalGoogleSpend  = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalSpend        = totalMetaSpend + totalGoogleSpend;
        const metaBlendedCpl    = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;
        const googleBlendedCpc  = googleCampaigns.length > 0
          ? googleCampaigns.reduce((s, c) => s + (c.totalSpend / Math.max(c.totalLeads, 1)), 0) / googleCampaigns.length
          : 0;
        const totalRevenue = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.attributedRevenue, 0);
        const blendedRoas  = totalSpend > 0 ? totalRevenue / totalSpend : 0;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <HeroKPICard
              label="Attributed Revenue"
              value={formatCurrency(totalRevenue)}
              icon={Euro}
              sub="All channels"
            />
            <HeroKPICard
              label="Total Marketing Spend"
              value={formatCurrency(totalSpend)}
              icon={Wallet}
              sub="Meta + Google"
            />
            <HeroKPICard
              label="Meta Blended CPL"
              value={`€${metaBlendedCpl.toFixed(1)}`}
              icon={MousePointerClick}
              sub="Cost per lead"
            />
            <HeroKPICard
              label="Google Blended CPL"
              value={`€${googleBlendedCpc.toFixed(1)}`}
              icon={Search}
              sub="Cost per lead"
            />
            <HeroKPICard
              label="Total Leads"
              value={String(totalLeads)}
              icon={Users}
              sub="Meta + Google"
            />
            <HeroKPICard
              label="Blended ROAS"
              value={totalSpend > 0 ? `${blendedRoas.toFixed(1)}x` : "—"}
              icon={TrendingUp}
              sub="Revenue / spend"
            />
          </div>
        );
      })()}

      {/* ── Section 2: Meta Ads ──────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader
          title="Meta Ads"
          channelLabel="Meta"
          channelVariant="meta"
          roasLabel="Meta ROAS"
          roasValue={metaTotalSpend > 0 ? `${metaRoasNum.toFixed(1)}x` : "—"}
        />

        {metaCampaigns.length > 0 ? (
          <>
            {/* Fatigue summary + CPL chart */}
            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 mb-2">
                    CPL by Campaign — Best to Worst
                  </p>
                  <FatiguePills {...metaFatigue} />
                </div>
              </div>
              {metaCplChartData.length > 0 && (
                <div className="h-[180px] md:h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={metaCplChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
                    >
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
                        cursor={{ fill: `${BRAND_FILL}40` }}
                        formatter={(value) => [`€${Number(value).toFixed(1)}`, "CPL"]}
                      />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 6, 6, 0]} maxBarSize={28}>
                        {metaCplChartData.map((entry, i) => (
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
              )}
            </div>

            {/* Campaign Table */}
            <DataTable columns={campaignColumns} data={metaCampaigns as unknown as Record<string, unknown>[]} />
          </>
        ) : !isLoading ? (
          <div className="py-12 text-center">
            <BarChart3 className="h-8 w-8 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-semibold text-gray-500">No Meta campaign data for this period.</p>
          </div>
        ) : (
          <>
            <ChartSkeleton height={200} className="mb-6" />
            <TableSkeleton rows={5} columns={8} />
          </>
        )}

        {/* Meta Aggregate Metrics */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox
            label="Attributed Revenue"
            value={metaTotalAttributed > 0 ? formatCurrency(metaTotalAttributed) : "—"}
            icon={Euro}
          />
          <AggregateBox
            label="Ad Spend"
            value={metaTotalSpend > 0 ? formatCurrency(metaTotalSpend) : "—"}
            icon={Wallet}
          />
          <AggregateBox
            label="ROAS"
            value={metaRoasNum > 0 ? `${metaRoas}x` : "—"}
            valueColor={metaRoasNum > 0 ? getRoasColor(metaRoasNum) : undefined}
            icon={TrendingUp}
          />
        </div>
      </Card>

      {/* ── Section 3: Google Ads ────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader
          title="Google Ads"
          channelLabel="Google"
          channelVariant="google"
          roasLabel="Google ROAS"
          roasValue={googleTotalSpend > 0 ? `${googleRoasNum.toFixed(1)}x` : "—"}
        />

        {googleCampaigns.length > 0 ? (
          <>
            {/* Fatigue summary + CPL chart */}
            <div className="mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 mb-2">
                    CPL by Campaign — Best to Worst
                  </p>
                  <FatiguePills {...googleFatigue} />
                </div>
              </div>
              {googleCplChartData.length > 0 && (
                <div className="h-[160px] md:h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={googleCplChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
                    >
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
                        cursor={{ fill: `${BRAND_FILL}40` }}
                        formatter={(value) => [`€${Number(value).toFixed(1)}`, "CPL"]}
                      />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 6, 6, 0]} maxBarSize={28}>
                        {googleCplChartData.map((entry, i) => (
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
              )}
            </div>

            {/* Campaign Table */}
            <DataTable columns={campaignColumns} data={googleCampaigns as unknown as Record<string, unknown>[]} />
          </>
        ) : !isLoading ? (
          <div className="py-12 text-center">
            <Search className="h-8 w-8 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-semibold text-gray-500">No Google Ads data for this period.</p>
          </div>
        ) : (
          <>
            <ChartSkeleton height={180} className="mb-6" />
            <TableSkeleton rows={5} columns={8} />
          </>
        )}

        {/* Google Aggregate Metrics */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox
            label="Attributed Revenue"
            value={googleTotalAttributed > 0 ? formatCurrency(googleTotalAttributed) : "—"}
            icon={Euro}
          />
          <AggregateBox
            label="Ad Spend"
            value={googleTotalSpend > 0 ? formatCurrency(googleTotalSpend) : "—"}
            icon={Wallet}
          />
          <AggregateBox
            label="ROAS"
            value={googleRoasNum > 0 ? `${googleRoas}x` : "—"}
            valueColor={googleRoasNum > 0 ? getRoasColor(googleRoasNum) : undefined}
            icon={TrendingUp}
          />
        </div>
      </Card>

      {/* ── Section 4: Email Marketing (Klaviyo) ─────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Email Marketing" channelLabel="Klaviyo" channelVariant="email" />

        {/* Key rate bars with industry benchmarks */}
        <div className="flex flex-col md:flex-row gap-6 mb-6 p-5 rounded-xl" style={{ backgroundColor: `${BRAND_FILL}30`, border: `1px solid ${BRAND_FILL}` }}>
          <EmailRateBar
            label="Open Rate"
            value={emailOpenRate || 0}
            max={60}
            color="#22C55E"
            benchmark={EMAIL_BENCHMARKS.open}
          />
          <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
          <EmailRateBar
            label="Click Rate"
            value={emailClickRate || 0}
            max={10}
            color={BRAND_COLOR}
            benchmark={EMAIL_BENCHMARKS.click}
          />
          <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
          <EmailRateBar
            label="Unsubscribe Rate"
            value={emailUnsubRate || 0}
            max={2}
            color="#EF4444"
            benchmark={EMAIL_BENCHMARKS.unsub}
          />
        </div>

        {/* Email KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className="rounded-xl p-4 border"
            style={{ backgroundColor: `${BRAND_FILL}30`, borderColor: BRAND_FILL }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className="rounded-lg p-1.5" style={{ backgroundColor: BRAND_FILL }}>
                <Mail className="h-3 w-3" style={{ color: BRAND_COLOR }} />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Campaigns Sent</p>
            </div>
            <p className="text-xl font-black tracking-tight" style={{ color: BRAND_COLOR }}>{campaignCount}</p>
          </div>

          <div
            className="rounded-xl p-4 border"
            style={{ backgroundColor: `${BRAND_FILL}30`, borderColor: BRAND_FILL }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className="rounded-lg p-1.5" style={{ backgroundColor: BRAND_FILL }}>
                <Users className="h-3 w-3" style={{ color: BRAND_COLOR }} />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Total Subscribers</p>
            </div>
            <p className="text-xl font-black tracking-tight" style={{ color: BRAND_COLOR }}>
              {emailTotalSubscribers.toLocaleString()}
            </p>
          </div>

          <div
            className="rounded-xl p-4 border"
            style={{ backgroundColor: `${BRAND_FILL}30`, borderColor: BRAND_FILL }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className="rounded-lg p-1.5" style={{ backgroundColor: BRAND_FILL }}>
                <Activity className="h-3 w-3" style={{ color: BRAND_COLOR }} />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-500">Active Flows</p>
            </div>
            <p className="text-xl font-black tracking-tight" style={{ color: BRAND_COLOR }}>{flowCount}</p>
          </div>
        </div>

        {/* Flow breakdown table */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Flow Performance</p>
            <div className="flex-1 h-px" style={{ backgroundColor: `${BRAND_FILL}` }} />
          </div>
          <FlowsTable brand="spa" dateFrom={dateFrom} dateTo={dateTo} brandColor={BRAND_COLOR} />
        </div>
      </Card>

      {/* ── Section 4b: SEO — Google Search Console ───────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Search Console Rankings" channelLabel="SEO" channelVariant="seo" />
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          Where carismaspa.com ranks for your tracked keywords on Google.
        </p>
        <KeywordRankingsTable brand="spa" brandColor={BRAND_COLOR} />
      </Card>

      {/* ── Section 5: Profitability Matrix ─────────────────────────── */}
      {profitabilityData.length > 0 && (
        <Card className="p-5 md:p-6">
          <ChannelHeader title="Profitability Matrix" />
          <p className="text-sm text-gray-500 -mt-3 mb-5">
            Cross-channel campaign analysis with budget scaling recommendations
          </p>

          <DataTable columns={profitabilityColumns} data={profitabilityData as unknown as Record<string, unknown>[]} />

          {/* Summary Totals Row */}
          <div
            className="mt-5 rounded-xl border p-5"
            style={{ borderColor: BRAND_FILL, backgroundColor: `${BRAND_FILL}30` }}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 mb-4">
              Portfolio Totals
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: "Campaigns", value: String(profitabilityData.length) },
                { label: "Total Leads", value: String(profitabilityTotals.totalLeads) },
                { label: "Total Spend", value: formatCurrency(profitabilityTotals.totalSpend) },
                { label: "Total Revenue", value: formatCurrency(profitabilityTotals.totalRevenue) },
                {
                  label: "Blended ROAS",
                  value: `${profitabilityTotals.totalRoas.toFixed(1)}x`,
                  color: getRoasColor(profitabilityTotals.totalRoas),
                },
                {
                  label: "Total Profit",
                  value: formatCurrency(profitabilityTotals.totalProfit),
                  color: profitabilityTotals.totalProfit >= 0 ? "#22C55E" : "#EF4444",
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400 mb-1">{label}</p>
                  <p
                    className="text-lg font-black tracking-tight"
                    style={{ color: color ?? BRAND_COLOR }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

/* ---------- page export ---------- */

export default function SpaMarketingPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <SpaMarketingContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
