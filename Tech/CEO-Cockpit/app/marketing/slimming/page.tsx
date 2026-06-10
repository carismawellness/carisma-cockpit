"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { CIChat } from "@/components/ci/CIChat";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useMetaCampaignsFromDb as useMetaCampaigns, useGoogleCampaignsFromDb as useGoogleCampaigns } from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoData } from "@/lib/hooks/useKlaviyoData";
import type { CampaignData } from "@/lib/types/ads";
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

/* ---------- constants ---------- */

const BRAND_COLOR = "#3D6B3D";  // slimming text-dark (readable for text + borders)

/* ---------- helpers ---------- */

function getFatigueStatus(frequency: number, ctr: number, peakCtr: number): { label: string; color: string; bg: string; fill: string } {
  const ctrDrop = (peakCtr - ctr) / peakCtr;
  if (frequency > 3.0 && ctrDrop > 0.2) return { label: "Fatigued", color: "bg-red-500", bg: "bg-red-50 text-red-700", fill: "#ef4444" };
  if (frequency >= 2.0 && ctrDrop >= 0.1) return { label: "Watch", color: "bg-amber-500", bg: "bg-amber-50 text-amber-700", fill: "#f59e0b" };
  return { label: "Healthy", color: "bg-green-500", bg: "bg-green-50 text-green-700", fill: "#22c55e" };
}

function getFatigueCounts(campaigns: { frequency: number; ctr: number; peakCtr: number }[]) {
  let fatigued = 0;
  let watch = 0;
  let healthy = 0;
  campaigns.forEach((c) => {
    const s = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
    if (s.label === "Fatigued") fatigued++;
    else if (s.label === "Watch") watch++;
    else healthy++;
  });
  return { fatigued, watch, healthy };
}

function getRoasColor(roas: number): string {
  if (roas >= 5) return "#22c55e";
  if (roas >= 3) return "#f59e0b";
  return "#ef4444";
}

/* ---------- Aggregate Metric Box ---------- */

function AggregateBox({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div
      className="rounded-lg border-2 p-4 text-center"
      style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
    >
      <p className="text-sm text-gray-600">{label}</p>
      <p className="text-xl md:text-2xl font-bold mt-1" style={{ color: valueColor ?? BRAND_COLOR }}>{value}</p>
    </div>
  );
}

/* ---------- Progress Bar ---------- */

function ProgressMetric({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold text-gray-900">{value}%</span>
      </div>
      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

/* ---------- Skeleton loader ---------- */

function SkeletonCard() {
  return (
    <Card className="p-4 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-1/2 mb-2" />
      <div className="h-7 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-1/3" />
    </Card>
  );
}

/* ---------- content component ---------- */

function SlimmingMarketingContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const queryClient = useQueryClient();
  /* ---------- Data fetching via Meta & Google Ads APIs ---------- */

  const metaQuery = useMetaCampaigns("slimming", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("slimming", dateFrom, dateTo);

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* ---------- Fatigue counts ---------- */

  const metaFatigue = useMemo(() => getFatigueCounts(metaCampaigns), [metaCampaigns]);
  const googleFatigue = useMemo(() => getFatigueCounts(googleCampaigns), [googleCampaigns]);
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const totalWatch = metaFatigue.watch + googleFatigue.watch;
  const totalHealthy = metaFatigue.healthy + googleFatigue.healthy;

  /* ---------- Hero KPIs ---------- */

  const heroCards = useMemo(() => {
    const totalMetaSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalGoogleSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalSpend = totalMetaSpend + totalGoogleSpend;
    const totalMetaLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalGoogleLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalLeads = totalMetaLeads + totalGoogleLeads;
    const totalRevenue = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.attributedRevenue, 0);
    const metaBlendedCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;
    const googleBlendedCpl = totalGoogleLeads > 0 ? totalGoogleSpend / totalGoogleLeads : 0;
    const conversionRate = totalLeads > 0 ? ((totalLeads * 0.69 * 0.59) / totalLeads * 100) : 0;
    return [
      { label: "Revenue", value: formatCurrency(totalRevenue) },
      { label: "Total Marketing Spend", value: formatCurrency(totalSpend) },
      { label: "Meta Blended CPL", value: `€${metaBlendedCpl.toFixed(1)}` },
      { label: "Google Blended CPL", value: `€${googleBlendedCpl.toFixed(1)}` },
      { label: "Total Leads", value: String(totalLeads) },
      { label: "Conversion / Leads", value: `${conversionRate.toFixed(1)}%` },
      { label: "Blended ROAS", value: totalSpend > 0 ? `${(totalRevenue / totalSpend).toFixed(1)}x` : "—" },
    ];
  }, [metaCampaigns, googleCampaigns]);

  /* ---------- Meta CPL chart data ---------- */

  const metaCplChartData = useMemo(() =>
    [...metaCampaigns]
      .sort((a, b) => a.cpl - b.cpl)
      .map((c) => {
        const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
        return {
          name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
          cpl: c.cpl,
          fullName: c.campaign,
          fill: status.fill,
          cplLabel: `€${c.cpl.toFixed(1)}`,
        };
      }),
  [metaCampaigns]);

  /* ---------- Google CPL chart data ---------- */

  const googleCplChartData = useMemo(() =>
    [...googleCampaigns]
      .sort((a, b) => a.cpl - b.cpl)
      .map((c) => {
        const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
        return {
          name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
          cpl: c.cpl,
          fullName: c.campaign,
          fill: status.fill,
          cplLabel: `€${c.cpl.toFixed(1)}`,
        };
      }),
  [googleCampaigns]);

  /* ---------- Campaign table columns ---------- */

  const metaColumns = [
    { key: "campaign", label: "Campaign Name" },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "dailyBudget", label: "Daily Budget", align: "right" as const, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalSpend", label: "Total Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalLeads", label: "Total Leads", align: "right" as const, sortable: true },
    { key: "costPerShow", label: "CP Show", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.69)).toFixed(1)}` : "—"; } },
    { key: "costPerResult", label: "CP Result", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.69 * 0.59)).toFixed(1)}` : "—"; } },
    { key: "ctr", label: "CTR", align: "right" as const, sortable: true, render: (v: unknown) => `${(v as number).toFixed(1)}%` },
    { key: "cpm", label: "CPM", align: "right" as const, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "frequency", label: "Freq", align: "right" as const, render: (v: unknown) => (v as number).toFixed(1) },
    { key: "attributedRevenue", label: "Attributed Rev", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
  ];

  const metaTotalAttributed = metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const metaExpectedRevenue = Math.round(metaTotalAttributed * 1.15);
  const metaTotalSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
  const metaExpectedRoasNum = metaTotalSpend > 0 ? metaExpectedRevenue / metaTotalSpend : 0;
  const metaExpectedRoas = metaExpectedRoasNum.toFixed(1);
  const metaRoas = metaTotalSpend > 0 ? metaTotalAttributed / metaTotalSpend : 0;

  const googleColumns = [
    { key: "campaign", label: "Campaign Name" },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "dailyBudget", label: "Daily Budget", align: "right" as const, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalSpend", label: "Total Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalLeads", label: "Total Leads", align: "right" as const, sortable: true },
    { key: "costPerShow", label: "CP Show", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.69)).toFixed(1)}` : "—"; } },
    { key: "costPerResult", label: "CP Result", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.69 * 0.59)).toFixed(1)}` : "—"; } },
    { key: "ctr", label: "CTR", align: "right" as const, sortable: true, render: (v: unknown) => `${(v as number).toFixed(1)}%` },
    { key: "cpm", label: "CPM", align: "right" as const, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "frequency", label: "Freq", align: "right" as const, render: (v: unknown) => (v as number).toFixed(1) },
    { key: "attributedRevenue", label: "Attributed Rev", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
  ];

  const googleTotalAttributed = googleCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const googleExpectedRevenue = Math.round(googleTotalAttributed * 1.15);
  const googleTotalSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
  const googleExpectedRoasNum = googleTotalSpend > 0 ? googleExpectedRevenue / googleTotalSpend : 0;
  const googleExpectedRoas = googleExpectedRoasNum.toFixed(1);
  const googleRoas = googleTotalSpend > 0 ? googleTotalAttributed / googleTotalSpend : 0;

  /* ---------- Consultation Funnel from campaigns ---------- */

  const funnelStats = useMemo(() => {
    const totalLeads = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.totalLeads, 0);
    const totalConsultations = Math.round(totalLeads * 0.69);
    const totalBookings = Math.round(totalLeads * 0.69 * 0.59);
    return { totalLeads, totalConsultations, totalBookings };
  }, [metaCampaigns, googleCampaigns]);

  /* ---------- Profitability Matrix ---------- */

  const profitabilityData = useMemo(() => {
    const metaRows = metaCampaigns.map((c) => {
      const roas = c.totalSpend > 0 ? c.attributedRevenue / c.totalSpend : 0;
      const profit = c.attributedRevenue - c.totalSpend;
      const costPerShow = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.69) : 0;
      const costPerResult = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.69 * 0.59) : 0;
      const netExpectedRevenue = Math.round(c.attributedRevenue * 1.15);
      const recommendation = roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";
      return { campaign: c.campaign, channel: "Meta", totalLeads: c.totalLeads, totalSpend: c.totalSpend, cpl: c.cpl, costPerShow, costPerResult, attributedRevenue: c.attributedRevenue, netExpectedRevenue, roas, profit, recommendation };
    });
    const googleRows = googleCampaigns.map((c) => {
      const roas = c.totalSpend > 0 ? c.attributedRevenue / c.totalSpend : 0;
      const profit = c.attributedRevenue - c.totalSpend;
      const costPerShow = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.69) : 0;
      const costPerResult = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.69 * 0.59) : 0;
      const netExpectedRevenue = Math.round(c.attributedRevenue * 1.15);
      const recommendation = roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";
      return { campaign: c.campaign, channel: "Google", totalLeads: c.totalLeads, totalSpend: c.totalSpend, cpl: c.cpl, costPerShow, costPerResult, attributedRevenue: c.attributedRevenue, netExpectedRevenue, roas, profit, recommendation };
    });
    return [...metaRows, ...googleRows].sort((a, b) => b.profit - a.profit);
  }, [metaCampaigns, googleCampaigns]);

  const profitabilityTotals = useMemo(() => {
    const totalLeads = profitabilityData.reduce((s, r) => s + r.totalLeads, 0);
    const totalSpend = profitabilityData.reduce((s, r) => s + r.totalSpend, 0);
    const totalAttrRevenue = profitabilityData.reduce((s, r) => s + r.attributedRevenue, 0);
    const totalNetExpected = profitabilityData.reduce((s, r) => s + r.netExpectedRevenue, 0);
    const totalProfit = profitabilityData.reduce((s, r) => s + r.profit, 0);
    const blendedRoas = totalSpend > 0 ? totalAttrRevenue / totalSpend : 0;
    const blendedCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const blendedCpShow = totalLeads > 0 ? totalSpend / (totalLeads * 0.69) : 0;
    const blendedCpResult = totalLeads > 0 ? totalSpend / (totalLeads * 0.69 * 0.59) : 0;
    return { totalLeads, totalSpend, totalAttrRevenue, totalNetExpected, totalProfit, blendedRoas, blendedCpl, blendedCpShow, blendedCpResult };
  }, [profitabilityData]);

  const profitabilityColumns = [
    { key: "campaign", label: "Campaign", render: (v: unknown) => <span className="font-medium cursor-pointer hover:underline" style={{ color: BRAND_COLOR }}>{v as string}</span> },
    { key: "channel", label: "Channel", render: (v: unknown) => <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${(v as string) === "Meta" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"}`}>{v as string}</span> },
    { key: "totalLeads", label: "Leads", align: "right" as const, sortable: true },
    { key: "totalSpend", label: "Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "costPerShow", label: "CP Show", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "costPerResult", label: "CP Result", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "attributedRevenue", label: "Attr. Rev", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "netExpectedRevenue", label: "Net Exp. Rev", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "roas", label: "ROAS", align: "right" as const, sortable: true, render: (v: unknown) => { const r = v as number; return <span style={{ color: getRoasColor(r), fontWeight: 600 }}>{r.toFixed(1)}x</span>; } },
    { key: "profit", label: "Profit", align: "right" as const, sortable: true, render: (v: unknown) => { const p = v as number; return <span style={{ color: p >= 0 ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{formatCurrency(p)}</span>; } },
    { key: "recommendation", label: "Action", align: "center" as const, render: (v: unknown) => { const r = v as string; const styles: Record<string, string> = { Scale: "bg-green-100 text-green-800", Maintain: "bg-blue-100 text-blue-800", Optimize: "bg-amber-100 text-amber-800", Pause: "bg-red-100 text-red-800" }; return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${styles[r] ?? ""}`}>{r}</span>; } },
  ];

  /* ---------- Email Marketing (Klaviyo API) ---------- */
  const { overview: klaviyo, loading: klaviyoLoading } = useKlaviyoData({
    brand: "slimming",
    dateFrom,
    dateTo,
  });

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Slimming Marketing Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            {formatDateRangeLabel(dateFrom, dateTo)} · Carisma Slimming — course-based model, launched Feb 2026
          </p>
        </div>
        <SyncButton
          onSync={async () => {
            await Promise.all([
              fetch("/api/etl/meta-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "slimming" }) }),
              fetch("/api/etl/google-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "slimming" }) }),
              fetch("/api/etl/klaviyo-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "slimming" }) }),
            ]);
            await queryClient.invalidateQueries({ queryKey: ["meta-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["google-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["klaviyo"] });
          }}
          isExternalBusy={isLoading}
        />
      </div>

      {/* Loading / Error / Token-expired banners */}
      {isLoading && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-center">
          <p className="text-sm font-medium text-blue-700">Loading ad data from Meta &amp; Google APIs...</p>
        </div>
      )}

      {tokenExpired && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center">
          <p className="text-sm font-semibold text-amber-700">API token expired — update credentials in .env.local</p>
        </div>
      )}

      {apiError && !tokenExpired && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">API Error: {apiError}</p>
        </div>
      )}

      {/* Ad Fatigue Alert — Prominent Centered Banner */}
      {(totalFatigued > 0 || totalWatch > 0) && (
        <div className={`w-full rounded-xl border-2 px-6 py-4 text-center ${
          totalFatigued > 0
            ? "border-red-200 bg-red-50"
            : "border-amber-200 bg-amber-50"
        }`}>
          <div className="flex items-center justify-center gap-3">
            <span className={`h-3 w-3 rounded-full ${totalFatigued > 0 ? "bg-red-500" : "bg-amber-500"}`} />
            <span className={`text-lg font-bold ${totalFatigued > 0 ? "text-red-700" : "text-amber-700"}`}>
              Ad Fatigue Alert
            </span>
          </div>
          <div className="flex items-center justify-center gap-6 mt-2 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="font-semibold text-red-700">{totalFatigued} Fatigued</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="font-semibold text-amber-700">{totalWatch} Watch</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-semibold text-green-700">{totalHealthy} Healthy</span>
            </span>
          </div>
        </div>
      )}

      {/* Section 1: Hero KPIs with "New Brand" badges */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {heroCards.map((kpi) => (
            <Card key={kpi.label} className="p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</p>
              <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
              <p className="text-xs text-gray-400 mt-1">LY: N/A</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                New Brand
              </span>
            </Card>
          ))}
        </div>
      )}

      {/* Consultation Funnel */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Consultation Funnel</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="border-l-4 pl-4" style={{ borderColor: BRAND_COLOR }}>
            <p className="text-sm text-gray-500 mb-1">Total Leads</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{funnelStats.totalLeads}</p>
          </div>
          <div className="border-l-4 pl-4" style={{ borderColor: BRAND_COLOR }}>
            <p className="text-sm text-gray-500 mb-1">Total Consultations</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{funnelStats.totalConsultations}</p>
          </div>
          <div className="border-l-4 pl-4" style={{ borderColor: BRAND_COLOR }}>
            <p className="text-sm text-gray-500 mb-1">Total Bookings</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{funnelStats.totalBookings}</p>
          </div>
        </div>
      </Card>

      {/* Section 2: Meta Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Meta Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Meta ROAS</p>
            <p className="text-xl font-bold" style={{ color: getRoasColor(metaRoas) }}>
              {metaTotalSpend > 0 ? `${metaRoas.toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/4" />
            <div className="h-32 bg-gray-200 rounded" />
          </div>
        ) : (
          <>
            {/* Fatigue Summary Counts */}
            <div className="flex items-center gap-3 text-xs mb-4">
              <span className="text-sm font-medium text-gray-700">Creative Fatigue</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /><span className="text-green-600 font-medium">{metaFatigue.healthy} Healthy</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /><span className="text-amber-600 font-medium">{metaFatigue.watch} Watch</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /><span className="text-red-600 font-medium">{metaFatigue.fatigued} Fatigued</span></span>
            </div>

            {/* CPL by Campaign - Fatigue Color Coded + CPL Labels */}
            {metaCplChartData.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">CPL by Campaign (Best to Worst)</h3>
                <div className="h-[150px] md:h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metaCplChartData} layout="vertical" margin={{ top: 5, right: 50, left: 100, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `€${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}`} />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 4, 4, 0]}>
                        {metaCplChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                        <LabelList dataKey="cplLabel" position="right" style={{ fontSize: 11, fontWeight: 600 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Campaign Table */}
            <DataTable columns={metaColumns} data={metaCampaigns as unknown as Record<string, unknown>[]} />

            {/* Meta Channel Aggregate */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <AggregateBox label="Expected Revenue in Meta" value={formatCurrency(metaExpectedRevenue)} />
              <AggregateBox label="Expected Ad Spend" value={formatCurrency(metaTotalSpend)} />
              <AggregateBox
                label="Expected ROAS"
                value={`${metaExpectedRoas}x`}
                valueColor={getRoasColor(metaExpectedRoasNum)}
              />
            </div>
          </>
        )}
      </Card>

      {/* Section 3: Google Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Google Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Google ROAS</p>
            <p className="text-xl font-bold" style={{ color: getRoasColor(googleRoas) }}>
              {googleTotalSpend > 0 ? `${googleRoas.toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/4" />
            <div className="h-32 bg-gray-200 rounded" />
          </div>
        ) : (
          <>
            {/* Fatigue Summary Counts */}
            <div className="flex items-center gap-3 text-xs mb-4">
              <span className="text-sm font-medium text-gray-700">Creative Fatigue</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /><span className="text-green-600 font-medium">{googleFatigue.healthy} Healthy</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /><span className="text-amber-600 font-medium">{googleFatigue.watch} Watch</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /><span className="text-red-600 font-medium">{googleFatigue.fatigued} Fatigued</span></span>
            </div>

            {/* CPL by Campaign - Fatigue Color Coded + CPL Labels */}
            {googleCplChartData.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">CPL by Campaign (Best to Worst)</h3>
                <div className="h-[140px] md:h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={googleCplChartData} layout="vertical" margin={{ top: 5, right: 50, left: 100, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `€${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}`} />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 4, 4, 0]}>
                        {googleCplChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                        <LabelList dataKey="cplLabel" position="right" style={{ fontSize: 11, fontWeight: 600 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Campaign Table */}
            <DataTable columns={googleColumns} data={googleCampaigns as unknown as Record<string, unknown>[]} />

            {/* Google Channel Aggregate */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <AggregateBox label="Expected Revenue in Google" value={formatCurrency(googleExpectedRevenue)} />
              <AggregateBox label="Expected Ad Spend" value={formatCurrency(googleTotalSpend)} />
              <AggregateBox
                label="Expected ROAS"
                value={`${googleExpectedRoas}x`}
                valueColor={getRoasColor(googleExpectedRoasNum)}
              />
            </div>
          </>
        )}
      </Card>

      {/* Section 4: Email Marketing (Klaviyo API) */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Email Marketing</h2>

        {klaviyoLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border bg-white p-5 h-24" />
              <div className="rounded-lg border bg-white p-5 h-24" />
            </div>
            <div className="space-y-3">
              <div className="h-6 bg-gray-200 rounded w-full" />
              <div className="h-6 bg-gray-200 rounded w-full" />
              <div className="h-6 bg-gray-200 rounded w-full" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg border bg-white p-4 h-20" />
              <div className="rounded-lg border bg-white p-4 h-20" />
              <div className="rounded-lg border bg-white p-4 h-20" />
            </div>
          </div>
        ) : klaviyo.totalRecipients === 0 && klaviyo.totalCampaignsSent === 0 && klaviyo.totalActiveFlows === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
            <p className="text-sm font-medium text-gray-600">No email data available for this period.</p>
          </div>
        ) : (
          <>
            {/* Top: Campaign Revenue + Flow Revenue (not tracked in Klaviyo for service business) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <Card className="p-3 md:p-5 text-center" style={{ borderColor: BRAND_COLOR, borderWidth: 2 }}>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Campaign Revenue</p>
                <p className="text-3xl font-bold text-gray-400 mt-2">&mdash;</p>
                <p className="text-xs text-gray-400 mt-1">Not tracked</p>
              </Card>
              <Card className="p-3 md:p-5 text-center" style={{ borderColor: BRAND_COLOR, borderWidth: 2 }}>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Flow Revenue</p>
                <p className="text-3xl font-bold text-gray-400 mt-2">&mdash;</p>
                <p className="text-xs text-gray-400 mt-1">Not tracked</p>
              </Card>
            </div>

            {/* Middle: Progress bars for key rates */}
            <div className="space-y-4 mb-6">
              <ProgressMetric label="Open Rate" value={parseFloat((klaviyo.overallOpenRate * 100).toFixed(1))} max={50} color={BRAND_COLOR} />
              <ProgressMetric label="Click Rate" value={parseFloat((klaviyo.overallClickRate * 100).toFixed(1))} max={10} color={BRAND_COLOR} />
              <ProgressMetric label="Unsubscribe Rate" value={parseFloat((klaviyo.overallUnsubscribeRate * 100).toFixed(1))} max={2} color="#ef4444" />
            </div>

            {/* Bottom: Email ROAS, Subscribers, Pop-up */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email ROAS</p>
                <p className="text-xl md:text-2xl font-bold text-gray-400 mt-1">&mdash;</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Subscribers</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{klaviyo.totalSubscribers.toLocaleString()}</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Pop-up Capture</p>
                <p className="text-xl md:text-2xl font-bold text-gray-400 mt-1">&mdash;</p>
              </Card>
            </div>
          </>
        )}
      </Card>

      {/* Section 5: Profitability Matrix */}
      <Card className="p-3 md:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Profitability Matrix</h2>
          <p className="text-sm text-gray-500 mt-0.5">Cross-channel campaign profitability with budget scaling recommendations</p>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="h-40 bg-gray-200 rounded" />
          </div>
        ) : profitabilityData.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center">
            <p className="text-sm font-medium text-gray-600">No profitability data available for this period.</p>
          </div>
        ) : (
          <>
            <DataTable columns={profitabilityColumns} data={profitabilityData as unknown as Record<string, unknown>[]} />

            {/* Summary Totals */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Total Leads</p>
                <p className="text-lg font-bold text-gray-900">{profitabilityTotals.totalLeads}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Total Spend</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(profitabilityTotals.totalSpend)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Blended CPL</p>
                <p className="text-lg font-bold text-gray-900">€{profitabilityTotals.blendedCpl.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Blended ROAS</p>
                <p className="text-lg font-bold" style={{ color: getRoasColor(profitabilityTotals.blendedRoas) }}>{profitabilityTotals.blendedRoas.toFixed(1)}x</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Total Profit</p>
                <p className="text-lg font-bold" style={{ color: profitabilityTotals.totalProfit >= 0 ? "#16a34a" : "#dc2626" }}>{formatCurrency(profitabilityTotals.totalProfit)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Total Attr. Revenue</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(profitabilityTotals.totalAttrRevenue)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Net Expected Revenue</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(profitabilityTotals.totalNetExpected)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Blended CP Show</p>
                <p className="text-lg font-bold text-gray-900">€{profitabilityTotals.blendedCpShow.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}>
                <p className="text-xs text-gray-500">Blended CP Result</p>
                <p className="text-lg font-bold text-gray-900">€{profitabilityTotals.blendedCpResult.toFixed(1)}</p>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Section 6: CIChat */}
      <CIChat />
    </>
  );
}

/* ---------- page export ---------- */

export default function SlimmingMarketingPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <SlimmingMarketingContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
