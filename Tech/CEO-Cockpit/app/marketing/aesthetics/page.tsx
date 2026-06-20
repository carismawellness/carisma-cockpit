"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataTable } from "@/components/dashboard/DataTable";
import { Card } from "@/components/ui/card";
import { ChartSkeleton, KPIGridSkeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useMetaCampaignsFromDb as useMetaCampaigns, useGoogleCampaignsFromDb as useGoogleCampaigns } from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoOverview } from "@/lib/hooks/useKlaviyoOverview";
import { useKlaviyoPopup } from "@/lib/hooks/useKlaviyoPopup";
import { FlowsTable } from "@/components/marketing/FlowsTable";
import { isNonRevenueCampaign } from "@/lib/funnel/aov";
import { KeywordRankingsTable } from "@/components/marketing/KeywordRankingsTable";
import { WebChannelSection } from "@/components/marketing/WebChannelSection";
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
import { computeBrandCommentary } from "@/lib/commentary/marketing-engine";
import { MktCommentaryPanel } from "@/components/marketing/CommentaryPanel";
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
  BarChart3,
} from "lucide-react";

/* ---------- constants ---------- */

const B = BRAND.aesthetics;
const BRAND_COLOR = B.dark;
const BRAND_FILL  = B.soft;

/* ---------- content component ---------- */

function AestheticsMarketingContent({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const queryClient = useQueryClient();
  const metaQuery = useMetaCampaigns("aesthetics", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("aesthetics", dateFrom, dateTo);

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* ---- Fatigue counts ---- */
  const metaFatigue   = useMemo(() => getFatigueSummary(metaCampaigns), [metaCampaigns]);
  const googleFatigue = useMemo(() => getFatigueSummary(googleCampaigns), [googleCampaigns]);
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const totalWatch    = metaFatigue.watch + googleFatigue.watch;

  /* ---- Channel aggregates ---- */
  const metaAggregate = useMemo(() => {
    if (!metaCampaigns.length) return null;
    const totalSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalRevenue = metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    return { totalSpend, totalLeads, totalRevenue, roas };
  }, [metaCampaigns]);

  const googleAggregate = useMemo(() => {
    if (!googleCampaigns.length) return null;
    const totalSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalRevenue = googleCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    return { totalSpend, totalLeads, totalRevenue, roas };
  }, [googleCampaigns]);

  /* ---- Campaign table columns ---- */
  const campaignColumns = [
    {
      key: "campaign",
      label: "Campaign Name",
      render: (v: unknown) => (
        <span className="font-semibold" style={{ color: BRAND_COLOR }}>{v as string}</span>
      ),
    },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "totalSpend", label: "Total Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "totalLeads", label: "Total Leads", align: "right" as const, sortable: true },
    { key: "ctr", label: "CTR", align: "right" as const, sortable: true, render: (v: unknown) => `${(v as number).toFixed(1)}%` },
    { key: "cpm", label: "CPM", align: "right" as const, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "frequency", label: "Freq", align: "right" as const, render: (v: unknown) => (v as number).toFixed(1) },
  ];

  /* ---- CPL chart data ---- */
  const metaCplChartData   = useMemo(() => buildCplChartData(metaCampaigns), [metaCampaigns]);
  const googleCplChartData = useMemo(() => buildCplChartData(googleCampaigns), [googleCampaigns]);

  /* ---- Profitability matrix ---- */
  const profitabilityData = useMemo(() => {
    const allCampaigns = [...metaCampaigns, ...googleCampaigns];
    if (!allCampaigns.length) return [];

    return allCampaigns
      .filter((c) => !isNonRevenueCampaign("aesthetics", c.campaign))
      .map((c) => {
        const attributedRevenue = c.attributedRevenue;
        const roas = c.totalSpend > 0 ? attributedRevenue / c.totalSpend : 0;
        const profit = attributedRevenue - c.totalSpend;
        const recommendation =
          roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";
        const isMeta = metaCampaigns.some((mc) => mc.campaignId === c.campaignId);
        return {
          campaign: c.campaign,
          channel: isMeta ? "Meta" : "Google",
          totalLeads: c.totalLeads,
          totalSpend: c.totalSpend,
          cpl: c.cpl,
          attributedRevenue,
          roas,
          profit,
          recommendation,
        };
      })
      .sort((a, b) => b.profit - a.profit);
  }, [metaCampaigns, googleCampaigns]);

  const profitabilityColumns = [
    {
      key: "campaign",
      label: "Campaign",
      render: (v: unknown) => (
        <span className="font-semibold" style={{ color: BRAND_COLOR }}>{String(v)}</span>
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
    { key: "recommendation", label: "Action", align: "center" as const, render: (v: unknown) => <ActionBadge rec={String(v)} /> },
  ];

  /* ---- Email data (Klaviyo API) ---- */
  const { overview: klaviyo, loading: klaviyoLoading } = useKlaviyoOverview({
    brand: "aesthetics",
    dateFrom,
    dateTo,
  });
  const { popup: klaviyoPopup, loading: popupLoading } = useKlaviyoPopup("aesthetics", dateFrom, dateTo);

  /* ---- Strategic commentary ---- */
  const commentaryResult = useMemo(() => computeBrandCommentary({
    brand: "aesthetics",
    meta: {
      totalSpend: metaAggregate?.totalSpend ?? 0,
      totalLeads: metaAggregate?.totalLeads ?? 0,
      attributedRevenue: metaAggregate?.totalRevenue ?? 0,
      fatigueStats: metaFatigue,
    },
    google: {
      totalSpend: googleAggregate?.totalSpend ?? 0,
      totalLeads: googleAggregate?.totalLeads ?? 0,
      attributedRevenue: googleAggregate?.totalRevenue ?? 0,
      fatigueStats: googleFatigue,
    },
    email: {
      openRate: klaviyo.openRate,
      clickRate: klaviyo.clickRate,
      hasData: !klaviyoLoading && klaviyo.openRate > 0,
    },
  }), [metaAggregate, googleAggregate, metaFatigue, googleFatigue, klaviyo, klaviyoLoading]);

  /* ---- Loading state ---- */
  if (isLoading) {
    return (
      <>
        <MarketingPageHeader
          title="Aesthetics Marketing"
          subtitle="Loading data…"
          brand={B}
        />
        <KPIGridSkeleton count={6} className="grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6" />
        <Card className="p-6">
          <ChartSkeleton height={200} />
        </Card>
        <Card className="p-6">
          <ChartSkeleton height={200} />
        </Card>
      </>
    );
  }

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <MarketingPageHeader
        title="Aesthetics Marketing"
        subtitle={`${formatDateRangeLabel(dateFrom, dateTo)} · Carisma Aesthetics — consult-driven performance`}
        brand={B}
      >
        <SyncButton
          onSync={async () => {
            await Promise.all([
              fetch("/api/etl/meta-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "aesthetics" }) }),
              fetch("/api/etl/google-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "aesthetics" }) }),
              fetch("/api/etl/klaviyo-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brand_slug: "aesthetics" }) }),
            ]);
            await queryClient.invalidateQueries({ queryKey: ["meta-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["google-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["klaviyo"] });
          }}
          isExternalBusy={isLoading}
        />
      </MarketingPageHeader>

      {/* ── Error banners ────────────────────────────────────────────── */}
      {tokenExpired && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm font-semibold text-amber-700">API token expired — update credentials in .env.local</p>
        </div>
      )}

      {apiError && !tokenExpired && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm font-semibold text-red-700">API Error: {apiError}</p>
        </div>
      )}

      {/* ── Creative Fatigue Alert ───────────────────────────────────── */}
      {(totalFatigued > 0 || totalWatch > 0) && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 flex items-center justify-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-sm font-bold text-red-700">
            Creative Fatigue Alert — {totalFatigued + totalWatch} campaign{totalFatigued + totalWatch !== 1 ? "s" : ""} need attention
          </span>
        </div>
      )}

      {/* ── Strategic Commentary ─────────────────────────────────────── */}
      <MktCommentaryPanel title="Aesthetics Marketing Snapshot" result={commentaryResult} loading={isLoading || klaviyoLoading} />

      {/* ── Section 1: Hero KPIs ────────────────────────────────────── */}
      {(() => {
        const totalMetaSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalGoogleSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
        const totalSpend = totalMetaSpend + totalGoogleSpend;
        const totalMetaLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalGoogleLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
        const totalLeads = totalMetaLeads + totalGoogleLeads;
        const totalRevenue = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.attributedRevenue, 0);
        const metaBlendedCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;
        const googleBlendedCpl = totalGoogleLeads > 0 ? totalGoogleSpend / totalGoogleLeads : 0;

        if (totalSpend === 0 && totalLeads === 0) {
          return (
            <Card className="p-6">
              <EmptyState message="No marketing data available for the selected date range." />
            </Card>
          );
        }

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <HeroKPICard brand={B} label="Attributed Revenue" value={formatCurrency(totalRevenue)} icon={Euro} sub="All channels" />
            <HeroKPICard brand={B} label="Total Marketing Spend" value={formatCurrency(totalSpend)} icon={Wallet} sub="Meta + Google" />
            <HeroKPICard brand={B} label="Meta Blended CPL" value={`€${metaBlendedCpl.toFixed(1)}`} icon={MousePointerClick} sub="Cost per lead" />
            <HeroKPICard brand={B} label="Google Blended CPL" value={`€${googleBlendedCpl.toFixed(1)}`} icon={Search} sub="Cost per lead" />
            <HeroKPICard brand={B} label="Total Leads" value={String(totalLeads)} icon={Users} sub="Meta + Google" />
            <HeroKPICard brand={B} label="Blended ROAS" value={totalSpend > 0 ? `${(totalRevenue / totalSpend).toFixed(1)}x` : "—"} icon={TrendingUp} sub="Revenue / spend" />
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
          roasValue={metaAggregate ? `${metaAggregate.roas.toFixed(1)}x` : "—"}
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
        ) : (
          <EmptyState icon={BarChart3} message="No Meta Ads data available for the selected date range." />
        )}

        {metaAggregate && (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <AggregateBox brand={B} label="Attributed Revenue" value={formatCurrency(metaAggregate.totalRevenue)} icon={Euro} />
            <AggregateBox brand={B} label="Ad Spend" value={formatCurrency(metaAggregate.totalSpend)} icon={Wallet} />
            <AggregateBox brand={B} label="ROAS" value={`${metaAggregate.roas.toFixed(1)}x`} valueColor={getRoasColor(metaAggregate.roas)} icon={TrendingUp} />
          </div>
        )}
      </Card>

      {/* ── Section 3: Google Ads ────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader
          title="Google Ads"
          brand={B}
          channelLabel="Google"
          channelVariant="google"
          roasLabel="Google ROAS"
          roasValue={googleAggregate ? `${googleAggregate.roas.toFixed(1)}x` : "—"}
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

            {googleAggregate && (
              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <AggregateBox brand={B} label="Attributed Revenue" value={formatCurrency(googleAggregate.totalRevenue)} icon={Euro} />
                <AggregateBox brand={B} label="Ad Spend" value={formatCurrency(googleAggregate.totalSpend)} icon={Wallet} />
                <AggregateBox brand={B} label="ROAS" value={`${googleAggregate.roas.toFixed(1)}x`} valueColor={getRoasColor(googleAggregate.roas)} icon={TrendingUp} />
              </div>
            )}
          </>
        ) : (
          <EmptyState icon={Search} message="No Google Ads data available for the selected date range." />
        )}
      </Card>

      {/* ── Section 4: Email Marketing (Klaviyo) ─────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Email Marketing" brand={B} channelLabel="Klaviyo" channelVariant="email" />

        {klaviyoLoading ? (
          <div className="space-y-4">
            <ChartSkeleton height={120} withTitle={false} />
            <ChartSkeleton height={80} withTitle={false} />
          </div>
        ) : !klaviyo.hasData ? (
          <EmptyState icon={Mail} message="No email data available for this period." />
        ) : (
          <>
            <div className="flex flex-col md:flex-row gap-6 mb-6 p-5 rounded-xl" style={{ backgroundColor: `${BRAND_FILL}30`, border: `1px solid ${BRAND_FILL}` }}>
              <EmailRateBar label="Open Rate" value={parseFloat((klaviyo.openRate * 100).toFixed(1))} max={60} color="#22C55E" benchmark={EMAIL_BENCHMARKS.open} />
              <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
              <EmailRateBar label="Click Rate" value={parseFloat((klaviyo.clickRate * 100).toFixed(1))} max={10} color={BRAND_COLOR} benchmark={EMAIL_BENCHMARKS.click} />
              <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
              <EmailRateBar label="Unsubscribe Rate" value={parseFloat((klaviyo.unsubscribeRate * 100).toFixed(1))} max={2} color="#EF4444" benchmark={EMAIL_BENCHMARKS.unsub} />
              {(klaviyoPopup.hasData || popupLoading) && (
                <>
                  <div className="hidden md:block w-px self-stretch" style={{ backgroundColor: `${BRAND_FILL}` }} />
                  <EmailRateBar
                    label="Popup Capture Rate"
                    value={popupLoading ? 0 : (klaviyoPopup.captureRatePct ?? 0)}
                    max={16}
                    color={klaviyoPopup.captureRatePct == null ? "#9CA3AF" : klaviyoPopup.captureRatePct >= 8 ? "#22C55E" : klaviyoPopup.captureRatePct >= 5 ? "#F59E0B" : "#EF4444"}
                    benchmark={8}
                  />
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AggregateBox brand={B} label="Total Subscribers" value={klaviyo.totalSubscribers.toLocaleString()} icon={Users} />
              <AggregateBox brand={B} label="Campaigns Sent" value={String(klaviyo.campaignsSent)} icon={Mail} />
              <AggregateBox brand={B} label="Active Flows" value={String(klaviyo.activeFlows)} icon={Activity} />
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Flow Performance</p>
                <div className="flex-1 h-px" style={{ backgroundColor: `${BRAND_FILL}` }} />
              </div>
              <FlowsTable brand="aesthetics" dateFrom={dateFrom} dateTo={dateTo} brandColor={BRAND_COLOR} />
            </div>
          </>
        )}
      </Card>

      {/* ── Section 4b: SEO — Google Search Console ───────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Search Console Rankings" brand={B} channelLabel="SEO" channelVariant="seo" />
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          Where carismaaesthetics.com ranks for your tracked keywords on Google.
        </p>
        <KeywordRankingsTable brand="aesthetics" brandColor={BRAND_COLOR} dateFrom={dateFrom} dateTo={dateTo} />
      </Card>

      {/* ── Section 4c: Web Analytics (GA4) ──────────────────────────── */}
      <WebChannelSection
        brand="aesthetics"
        brandColor={BRAND_COLOR}
        brandFill={BRAND_FILL}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* ── Section 5: Profitability Matrix ─────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Profitability Matrix" brand={B} />
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          Cross-channel campaign profitability with budget scaling recommendations
        </p>

        {profitabilityData.length > 0 ? (
          (() => {
            const totalLeads = profitabilityData.reduce((s, c) => s + c.totalLeads, 0);
            const totalSpend = profitabilityData.reduce((s, c) => s + c.totalSpend, 0);
            const totalRevenue = profitabilityData.reduce((s, c) => s + c.attributedRevenue, 0);
            const totalProfit = totalRevenue - totalSpend;
            const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

            return (
              <>
                <DataTable
                  columns={profitabilityColumns}
                  data={profitabilityData as unknown as Record<string, unknown>[]}
                  pageSize={20}
                />
                <PortfolioTotals
                  brand={B}
                  items={[
                    { label: "Campaigns", value: String(profitabilityData.length) },
                    { label: "Total Leads", value: String(totalLeads) },
                    { label: "Total Spend", value: formatCurrency(totalSpend) },
                    { label: "Total Revenue", value: formatCurrency(totalRevenue) },
                    { label: "Blended ROAS", value: `${blendedRoas.toFixed(1)}x`, color: getRoasColor(blendedRoas) },
                    { label: "Total Profit", value: formatCurrency(totalProfit), color: totalProfit >= 0 ? "#22C55E" : "#EF4444" },
                  ]}
                />
              </>
            );
          })()
        ) : (
          <EmptyState message="No campaign data available for profitability analysis." />
        )}
      </Card>
    </>
  );
}

/* ---------- page export ---------- */

export default function AestheticsMarketingPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <AestheticsMarketingContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
