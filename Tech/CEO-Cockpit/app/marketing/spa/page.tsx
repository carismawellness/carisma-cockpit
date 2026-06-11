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
import {
  MarketingPageHeader,
  HeroKPICard,
  AggregateBox,
  EmailRateBar,
  ChannelHeader,
  FatiguePills,
  CplBarChart,
  ChannelBadge,
  ActionBadge,
  EmptyState,
  PortfolioTotals,
  EMAIL_BENCHMARKS,
  getRoasColor,
  getFatigueSummary,
  buildCplChartData,
} from "@/components/marketing/ui";
import {
  Euro,
  TrendingUp,
  Users,
  Wallet,
  MousePointerClick,
  Mail,
  Search,
  Activity,
  AlertTriangle,
} from "lucide-react";

/* ---------- constants ---------- */

const B = BRAND.spa;
const BRAND_COLOR = B.dark;
const BRAND_FILL  = B.soft;

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

  /* --- CPL chart data --- */
  const metaCplChartData   = useMemo(() => buildCplChartData(metaCampaigns), [metaCampaigns]);
  const googleCplChartData = useMemo(() => buildCplChartData(googleCampaigns), [googleCampaigns]);

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
    { key: "channel", label: "Channel", render: (v: unknown) => <ChannelBadge channel={v as string} /> },
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
    { key: "recommendation", label: "Action", align: "center" as const, render: (v: unknown) => <ActionBadge rec={v as string} /> },
  ];

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <MarketingPageHeader
        title="Spa Marketing"
        subtitle={`${formatDateRangeLabel(dateFrom, dateTo)} · Carisma Spa & Wellness`}
        brand={B}
      >
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
      </MarketingPageHeader>

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
            <HeroKPICard brand={B} label="Attributed Revenue" value={formatCurrency(totalRevenue)} icon={Euro} sub="All channels" />
            <HeroKPICard brand={B} label="Total Marketing Spend" value={formatCurrency(totalSpend)} icon={Wallet} sub="Meta + Google" />
            <HeroKPICard brand={B} label="Meta Blended CPL" value={`€${metaBlendedCpl.toFixed(1)}`} icon={MousePointerClick} sub="Cost per lead" />
            <HeroKPICard brand={B} label="Google Blended CPL" value={`€${googleBlendedCpc.toFixed(1)}`} icon={Search} sub="Cost per lead" />
            <HeroKPICard brand={B} label="Total Leads" value={String(totalLeads)} icon={Users} sub="Meta + Google" />
            <HeroKPICard brand={B} label="Blended ROAS" value={totalSpend > 0 ? `${blendedRoas.toFixed(1)}x` : "—"} icon={TrendingUp} sub="Revenue / spend" />
          </div>
        );
      })()}

      {/* ── Section 2: Meta Ads ──────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader
          title="Meta Ads"
          brand={B}
          channelLabel="Meta"
          channelVariant="meta"
          roasLabel="Meta ROAS"
          roasValue={metaTotalSpend > 0 ? `${metaRoasNum.toFixed(1)}x` : "—"}
        />

        {metaCampaigns.length > 0 ? (
          <>
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
                <CplBarChart data={metaCplChartData} brand={B} className="h-[180px] md:h-[220px]" />
              )}
            </div>

            <DataTable columns={campaignColumns} data={metaCampaigns as unknown as Record<string, unknown>[]} />
          </>
        ) : !isLoading ? (
          <EmptyState message="No Meta campaign data for this period." />
        ) : (
          <>
            <ChartSkeleton height={200} className="mb-6" />
            <TableSkeleton rows={5} columns={8} />
          </>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox brand={B} label="Attributed Revenue" value={metaTotalAttributed > 0 ? formatCurrency(metaTotalAttributed) : "—"} icon={Euro} />
          <AggregateBox brand={B} label="Ad Spend" value={metaTotalSpend > 0 ? formatCurrency(metaTotalSpend) : "—"} icon={Wallet} />
          <AggregateBox brand={B} label="ROAS" value={metaRoasNum > 0 ? `${metaRoas}x` : "—"} valueColor={metaRoasNum > 0 ? getRoasColor(metaRoasNum) : undefined} icon={TrendingUp} />
        </div>
      </Card>

      {/* ── Section 3: Google Ads ────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader
          title="Google Ads"
          brand={B}
          channelLabel="Google"
          channelVariant="google"
          roasLabel="Google ROAS"
          roasValue={googleTotalSpend > 0 ? `${googleRoasNum.toFixed(1)}x` : "—"}
        />

        {googleCampaigns.length > 0 ? (
          <>
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
                <CplBarChart data={googleCplChartData} brand={B} className="h-[160px] md:h-[200px]" />
              )}
            </div>

            <DataTable columns={campaignColumns} data={googleCampaigns as unknown as Record<string, unknown>[]} />
          </>
        ) : !isLoading ? (
          <EmptyState icon={Search} message="No Google Ads data for this period." />
        ) : (
          <>
            <ChartSkeleton height={180} className="mb-6" />
            <TableSkeleton rows={5} columns={8} />
          </>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox brand={B} label="Attributed Revenue" value={googleTotalAttributed > 0 ? formatCurrency(googleTotalAttributed) : "—"} icon={Euro} />
          <AggregateBox brand={B} label="Ad Spend" value={googleTotalSpend > 0 ? formatCurrency(googleTotalSpend) : "—"} icon={Wallet} />
          <AggregateBox brand={B} label="ROAS" value={googleRoasNum > 0 ? `${googleRoas}x` : "—"} valueColor={googleRoasNum > 0 ? getRoasColor(googleRoasNum) : undefined} icon={TrendingUp} />
        </div>
      </Card>

      {/* ── Section 4: Email Marketing (Klaviyo) ─────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Email Marketing" brand={B} channelLabel="Klaviyo" channelVariant="email" />

        <div className="flex flex-col md:flex-row gap-6 mb-6 p-5 rounded-xl" style={{ backgroundColor: `${BRAND_FILL}30`, border: `1px solid ${BRAND_FILL}` }}>
          <EmailRateBar label="Open Rate" value={emailOpenRate || 0} max={60} color="#22C55E" benchmark={EMAIL_BENCHMARKS.open} />
          <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
          <EmailRateBar label="Click Rate" value={emailClickRate || 0} max={10} color={BRAND_COLOR} benchmark={EMAIL_BENCHMARKS.click} />
          <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
          <EmailRateBar label="Unsubscribe Rate" value={emailUnsubRate || 0} max={2} color="#EF4444" benchmark={EMAIL_BENCHMARKS.unsub} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox brand={B} label="Campaigns Sent" value={String(campaignCount)} icon={Mail} />
          <AggregateBox brand={B} label="Total Subscribers" value={emailTotalSubscribers.toLocaleString()} icon={Users} />
          <AggregateBox brand={B} label="Active Flows" value={String(flowCount)} icon={Activity} />
        </div>

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
        <ChannelHeader title="Search Console Rankings" brand={B} channelLabel="SEO" channelVariant="seo" />
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          Where carismaspa.com ranks for your tracked keywords on Google.
        </p>
        <KeywordRankingsTable brand="spa" brandColor={BRAND_COLOR} dateFrom={dateFrom} dateTo={dateTo} />
      </Card>

      {/* ── Section 5: Profitability Matrix ─────────────────────────── */}
      {profitabilityData.length > 0 && (
        <Card className="p-5 md:p-6">
          <ChannelHeader title="Profitability Matrix" brand={B} />
          <p className="text-sm text-gray-500 -mt-3 mb-5">
            Cross-channel campaign analysis with budget scaling recommendations
          </p>

          <DataTable columns={profitabilityColumns} data={profitabilityData as unknown as Record<string, unknown>[]} />

          <PortfolioTotals
            brand={B}
            items={[
              { label: "Campaigns", value: String(profitabilityData.length) },
              { label: "Total Leads", value: String(profitabilityTotals.totalLeads) },
              { label: "Total Spend", value: formatCurrency(profitabilityTotals.totalSpend) },
              { label: "Total Revenue", value: formatCurrency(profitabilityTotals.totalRevenue) },
              { label: "Blended ROAS", value: `${profitabilityTotals.totalRoas.toFixed(1)}x`, color: getRoasColor(profitabilityTotals.totalRoas) },
              { label: "Total Profit", value: formatCurrency(profitabilityTotals.totalProfit), color: profitabilityTotals.totalProfit >= 0 ? "#22C55E" : "#EF4444" },
            ]}
          />
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
