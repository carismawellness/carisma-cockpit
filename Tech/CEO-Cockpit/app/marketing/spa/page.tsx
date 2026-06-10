"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useMetaCampaignsFromDb as useMetaCampaigns, useGoogleCampaignsFromDb as useGoogleCampaigns } from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoOverview } from "@/lib/hooks/useKlaviyoOverview";
import { FlowsTable } from "@/components/marketing/FlowsTable";
import { BRAND } from "@/lib/constants/design-tokens";
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

const BRAND_COLOR = BRAND.spa.dark;  // canonical spa brand color

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
  lastYear,
  yoyLabel,
  positive,
}: {
  label: string;
  value: string;
  lastYear: string;
  yoyLabel: string;
  positive: boolean;
}) {
  return (
    <Card className="p-4 relative">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{value}</p>
      <p className="text-xs text-gray-400 mt-1">LY: {lastYear}</p>
      <p className={`text-xs font-semibold mt-0.5 ${positive ? "text-green-600" : "text-red-600"}`}>
        {yoyLabel} YoY
      </p>
    </Card>
  );
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

/* ---------- Email Progress Bar ---------- */

function EmailRateBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold text-gray-900">{value}%</span>
      </div>
      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

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
  /* --- Fetch real data from Meta, Google & Klaviyo APIs --- */
  const metaQuery = useMetaCampaigns("spa", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("spa", dateFrom, dateTo);
  const klaviyo = useKlaviyoOverview({ brand: "spa", dateFrom, dateTo });

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading || klaviyo.loading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* --- Klaviyo email metrics --- */
  const emailOpenRate = Math.round(klaviyo.overview.openRate * 1000) / 10;
  const emailClickRate = Math.round(klaviyo.overview.clickRate * 1000) / 10;
  const emailUnsubRate = Math.round(klaviyo.overview.unsubscribeRate * 1000) / 10;
  const emailTotalSubscribers = klaviyo.overview.totalSubscribers;
  const campaignCount = klaviyo.overview.campaignsSent;
  const flowCount = klaviyo.overview.activeFlows;

  /* --- Email revenue (Klaviyo API doesn't expose revenue — placeholder until integrated) --- */
  const emailCampaignRev = 0;
  const emailFlowRev = 0;
  const emailTotalRev = emailCampaignRev + emailFlowRev;
  const campaignPct = emailTotalRev > 0 ? Math.round((emailCampaignRev / emailTotalRev) * 100) : 50;
  const flowPct = emailTotalRev > 0 ? Math.round((emailFlowRev / emailTotalRev) * 100) : 50;

  /* --- Fatigue checks --- */
  const metaFatigue = useMemo(() => getFatigueSummary(metaCampaigns), [metaCampaigns]);
  const googleFatigue = useMemo(() => getFatigueSummary(googleCampaigns), [googleCampaigns]);
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const anyFatigued = totalFatigued > 0;

  /* --- Column definitions (shared shape) --- */
  const campaignColumns = [
    {
      key: "campaign",
      label: "Campaign Name",
      render: (v: unknown) => (
        <button
          className="text-left font-medium underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity"
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
          const color =
            status.label === "Fatigued" ? "#EF4444" : status.label === "Watch" ? "#F59E0B" : "#22C55E";
          return {
            name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
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
          const color =
            status.label === "Fatigued" ? "#EF4444" : status.label === "Watch" ? "#F59E0B" : "#22C55E";
          return {
            name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
            cpl: c.cpl,
            color,
          };
        }),
    [googleCampaigns]
  );

  /* --- Meta aggregate values --- */
  const metaTotalAttributed = useMemo(() => metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0), [metaCampaigns]);
  const metaTotalSpend = useMemo(() => metaCampaigns.reduce((s, c) => s + c.totalSpend, 0), [metaCampaigns]);
  const metaRoasNum = metaTotalSpend > 0 ? metaTotalAttributed / metaTotalSpend : 0;
  const metaRoas = metaRoasNum.toFixed(1);

  /* --- Google aggregate values --- */
  const googleTotalAttributed = useMemo(() => googleCampaigns.reduce((s, c) => s + c.attributedRevenue, 0), [googleCampaigns]);
  const googleTotalSpend = useMemo(() => googleCampaigns.reduce((s, c) => s + c.totalSpend, 0), [googleCampaigns]);
  const googleRoasNum = googleTotalSpend > 0 ? googleTotalAttributed / googleTotalSpend : 0;
  const googleRoas = googleRoasNum.toFixed(1);

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
        return {
          campaign: c.campaign,
          channel: c.channel,
          totalLeads: c.totalLeads,
          totalSpend: c.totalSpend,
          cpl: c.cpl,
          attributedRevenue: c.attributedRevenue,
          roas,
          profit,
          profitabilityPct,
          recommendation,
        };
      })
      .sort((a, b) => b.profitabilityPct - a.profitabilityPct);
  }, [metaCampaigns, googleCampaigns]);

  const profitabilityTotals = useMemo(() => {
    const totalLeads = profitabilityData.reduce((s, c) => s + c.totalLeads, 0);
    const totalSpend = profitabilityData.reduce((s, c) => s + c.totalSpend, 0);
    const totalRevenue = profitabilityData.reduce((s, c) => s + c.attributedRevenue, 0);
    const totalProfit = totalRevenue - totalSpend;
    const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const totalProfitPct = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;
    return { totalLeads, totalSpend, totalRevenue, totalProfit, totalRoas, totalProfitPct };
  }, [profitabilityData]);

  const profitabilityColumns = [
    {
      key: "campaign",
      label: "Campaign",
      render: (v: unknown) => (
        <button
          className="text-left font-medium underline decoration-dotted underline-offset-2 hover:opacity-70 transition-opacity"
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
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            (v as string) === "Meta" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
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
        return <span style={{ color: getRoasColor(val), fontWeight: 600 }}>{val.toFixed(1)}x</span>;
      },
    },
    {
      key: "profit",
      label: "Profit",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = v as number;
        return <span style={{ color: val >= 0 ? "#22C55E" : "#EF4444", fontWeight: 600 }}>{formatCurrency(val)}</span>;
      },
    },
    {
      key: "profitabilityPct",
      label: "Profit %",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const val = v as number;
        return <span style={{ color: val >= 0 ? "#22C55E" : "#EF4444", fontWeight: 600 }}>{val.toFixed(0)}%</span>;
      },
    },
    {
      key: "recommendation",
      label: "Action",
      align: "center" as const,
      render: (v: unknown) => {
        const rec = v as string;
        const styles: Record<string, string> = {
          Scale: "bg-green-50 text-green-700 border-green-200",
          Maintain: "bg-blue-50 text-blue-700 border-blue-200",
          Optimize: "bg-amber-50 text-amber-700 border-amber-200",
          Pause: "bg-red-50 text-red-700 border-red-200",
        };
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold ${styles[rec] ?? ""}`}>
            {rec}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Spa Marketing Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">
            {formatDateRangeLabel(dateFrom, dateTo)} · All marketing channels for Carisma Spa &amp; Wellness
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

      {/* Loading / Error / Token States */}
      {isLoading && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-center">
          <p className="text-sm font-medium text-blue-700">Loading ad data from Meta &amp; Google APIs...</p>
        </div>
      )}

      {tokenExpired && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center">
          <p className="text-sm font-semibold text-amber-700">API token expired — update META_ACCESS_TOKEN or Google Ads credentials in .env.local</p>
        </div>
      )}

      {apiError && !tokenExpired && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
          <p className="text-sm font-semibold text-red-700">API Error: {apiError}</p>
        </div>
      )}

      {/* Ad Fatigue Alert Banner */}
      {anyFatigued && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center justify-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-semibold text-red-700">
            Creative Fatigue Alert: {totalFatigued} campaign{totalFatigued !== 1 ? "s" : ""} need attention
          </span>
        </div>
      )}

      {/* Section 1: Hero KPIs */}
      {(() => {
        const totalMetaLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalGoogleLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalLeads = totalMetaLeads + totalGoogleLeads;
        const totalMetaSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalGoogleSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalSpend = totalMetaSpend + totalGoogleSpend;
        const metaBlendedCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;
        const googleBlendedCpc = googleCampaigns.length > 0
          ? googleCampaigns.reduce((s, c) => s + (c.totalSpend / Math.max(c.totalLeads, 1)), 0) / googleCampaigns.length
          : 0;
        const totalRevenue = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.attributedRevenue, 0);
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <HeroKPICard label="Revenue" value={formatCurrency(totalRevenue)} lastYear="—" yoyLabel="—" positive />
            <HeroKPICard label="Total Marketing Spend" value={formatCurrency(totalSpend)} lastYear="—" yoyLabel="—" positive={false} />
            <HeroKPICard label="Meta Blended CPL" value={`€${metaBlendedCpl.toFixed(1)}`} lastYear="—" yoyLabel="—" positive />
            <HeroKPICard label="Google Blended CPL" value={`€${googleBlendedCpc.toFixed(1)}`} lastYear="—" yoyLabel="—" positive />
            <HeroKPICard label="Total Leads" value={String(totalLeads)} lastYear="—" yoyLabel="—" positive />
            <HeroKPICard label="Blended ROAS" value={totalSpend > 0 ? `${(totalRevenue / totalSpend).toFixed(1)}x` : "—"} lastYear="—" yoyLabel="—" positive />
          </div>
        );
      })()}

      {/* Section 2: Meta Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Meta Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Meta ROAS</p>
            <p className="text-xl font-bold" style={{ color: BRAND_COLOR }}>
              {metaTotalSpend > 0 ? `${(metaTotalAttributed / metaTotalSpend).toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {metaCampaigns.length > 0 ? (
          <>
            {/* Fatigue Summary + CPL Chart */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-gray-700">CPL by Campaign (Best to Worst)</h3>
                <span className="text-xs text-gray-500">
                  <span className="text-green-600 font-medium">{metaFatigue.healthy} Healthy</span>
                  {" | "}
                  <span className="text-amber-600 font-medium">{metaFatigue.watch} Watch</span>
                  {" | "}
                  <span className="text-red-600 font-medium">{metaFatigue.fatigued} Fatigued</span>
                </span>
              </div>
              {metaCplChartData.length > 0 && (
                <div className="h-[160px] md:h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={metaCplChartData}
                      layout="vertical"
                      margin={{ top: 5, right: 50, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `€${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}`} />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 4, 4, 0]}>
                        {metaCplChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                        <LabelList
                          dataKey="cpl"
                          position="right"
                          formatter={(v) => `€${Number(v).toFixed(1)}`}
                          style={{ fontSize: 11, fill: "#374151" }}
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
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-gray-600">No Meta campaign data for this period.</p>
          </div>
        ) : null}

        {/* Meta Aggregate Metrics */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox label="Attributed Revenue (Meta)" value={metaTotalAttributed > 0 ? formatCurrency(metaTotalAttributed) : "—"} />
          <AggregateBox label="Ad Spend" value={metaTotalSpend > 0 ? formatCurrency(metaTotalSpend) : "—"} />
          <AggregateBox label="ROAS" value={metaRoasNum > 0 ? `${metaRoas}x` : "—"} valueColor={metaRoasNum > 0 ? getRoasColor(metaRoasNum) : undefined} />
        </div>
      </Card>

      {/* Section 3: Google Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Google Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Google ROAS</p>
            <p className="text-xl font-bold" style={{ color: BRAND_COLOR }}>
              {googleTotalSpend > 0 ? `${(googleTotalAttributed / googleTotalSpend).toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {googleCampaigns.length > 0 ? (
          <>
            {/* Fatigue Summary + CPL Chart */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-gray-700">CPL by Campaign (Best to Worst)</h3>
                <span className="text-xs text-gray-500">
                  <span className="text-green-600 font-medium">{googleFatigue.healthy} Healthy</span>
                  {" | "}
                  <span className="text-amber-600 font-medium">{googleFatigue.watch} Watch</span>
                  {" | "}
                  <span className="text-red-600 font-medium">{googleFatigue.fatigued} Fatigued</span>
                </span>
              </div>
              {googleCplChartData.length > 0 && (
                <div className="h-[150px] md:h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={googleCplChartData}
                      layout="vertical"
                      margin={{ top: 5, right: 50, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `€${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                      <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}`} />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 4, 4, 0]}>
                        {googleCplChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                        <LabelList
                          dataKey="cpl"
                          position="right"
                          formatter={(v) => `€${Number(v).toFixed(1)}`}
                          style={{ fontSize: 11, fill: "#374151" }}
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
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-gray-600">No Google Ads data for this period.</p>
          </div>
        ) : null}

        {/* Google Aggregate Metrics */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox label="Attributed Revenue (Google)" value={googleTotalAttributed > 0 ? formatCurrency(googleTotalAttributed) : "—"} />
          <AggregateBox label="Ad Spend" value={googleTotalSpend > 0 ? formatCurrency(googleTotalSpend) : "—"} />
          <AggregateBox label="ROAS" value={googleRoasNum > 0 ? `${googleRoas}x` : "—"} valueColor={googleRoasNum > 0 ? getRoasColor(googleRoasNum) : undefined} />
        </div>
      </Card>

      {/* Section 4: Email Marketing (hardcoded — Klaviyo) */}
      <Card className="p-3 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Email Marketing</h2>

        {/* Top row: Campaign Revenue vs Flow Revenue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Card className="p-3 md:p-5 border-2" style={{ borderColor: BRAND_COLOR }}>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Campaign Revenue</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(emailCampaignRev)}</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${campaignPct}%`, backgroundColor: BRAND_COLOR }} />
              </div>
              <span className="text-xs font-medium text-gray-500">{campaignPct}% of total</span>
            </div>
          </Card>
          <Card className="p-3 md:p-5 border-2" style={{ borderColor: BRAND_COLOR }}>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Flow Revenue</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatCurrency(emailFlowRev)}</p>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${flowPct}%`, backgroundColor: BRAND_COLOR }} />
              </div>
              <span className="text-xs font-medium text-gray-500">{flowPct}% of total</span>
            </div>
          </Card>
        </div>

        {/* Middle row: Key rates as progress bars */}
        <div className="flex flex-col md:flex-row gap-6 mb-6 p-4 bg-gray-50 rounded-lg">
          <EmailRateBar label="Open Rate" value={emailOpenRate || 0} max={60} color="#22C55E" />
          <EmailRateBar label="Click Rate" value={emailClickRate || 0} max={10} color={BRAND_COLOR} />
          <EmailRateBar label="Unsubscribe Rate" value={emailUnsubRate || 0} max={2} color="#EF4444" />
        </div>

        {/* Bottom row: Accent cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4" style={{ backgroundColor: `${BRAND_COLOR}15`, borderColor: BRAND_COLOR, borderWidth: 1 }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: BRAND_COLOR }}>Campaigns Sent</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{campaignCount}</p>
          </Card>
          <Card className="p-4" style={{ backgroundColor: `${BRAND_COLOR}15`, borderColor: BRAND_COLOR, borderWidth: 1 }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: BRAND_COLOR }}>Total Subscribers</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{emailTotalSubscribers.toLocaleString()}</p>
          </Card>
          <Card className="p-4" style={{ backgroundColor: `${BRAND_COLOR}15`, borderColor: BRAND_COLOR, borderWidth: 1 }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: BRAND_COLOR }}>Active Flows</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{flowCount}</p>
          </Card>
        </div>

        {/* Flow breakdown table */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Flow Performance</h3>
          <FlowsTable brand="spa" dateFrom={dateFrom} dateTo={dateTo} brandColor={BRAND_COLOR} />
        </div>
      </Card>

      {/* Section 5: Profitability Matrix */}
      {profitabilityData.length > 0 && (
        <Card className="p-3 md:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Profitability Matrix</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Cross-channel campaign profitability analysis with budget scaling recommendations
            </p>
          </div>

          <DataTable columns={profitabilityColumns} data={profitabilityData as unknown as Record<string, unknown>[]} />

          {/* Summary Row */}
          <div className="mt-4 rounded-lg border-2 p-4" style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}08` }}>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Total Campaigns</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{profitabilityData.length}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Total Leads</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{profitabilityTotals.totalLeads}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Total Spend</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(profitabilityTotals.totalSpend)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Total Revenue</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">{formatCurrency(profitabilityTotals.totalRevenue)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Blended ROAS</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: getRoasColor(profitabilityTotals.totalRoas) }}>
                  {profitabilityTotals.totalRoas.toFixed(1)}x
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 font-medium uppercase">Total Profit</p>
                <p
                  className="text-lg font-bold mt-0.5"
                  style={{ color: profitabilityTotals.totalProfit >= 0 ? "#22C55E" : "#EF4444" }}
                >
                  {formatCurrency(profitabilityTotals.totalProfit)}
                </p>
              </div>
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
