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
  Target,
  ClipboardCheck,
  CalendarCheck,
} from "lucide-react";

/* ---------- constants ---------- */

const B = BRAND.slimming;
const BRAND_COLOR = B.dark;
const BRAND_FILL  = B.soft;

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
  const metaQuery = useMetaCampaigns("slimming", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("slimming", dateFrom, dateTo);

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* ---------- Fatigue counts ---------- */
  const metaFatigue   = useMemo(() => getFatigueSummary(metaCampaigns), [metaCampaigns]);
  const googleFatigue = useMemo(() => getFatigueSummary(googleCampaigns), [googleCampaigns]);
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const totalWatch    = metaFatigue.watch + googleFatigue.watch;
  const totalHealthy  = metaFatigue.healthy + googleFatigue.healthy;

  /* ---------- Hero KPIs ---------- */
  const heroKpis = useMemo(() => {
    const totalMetaSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalGoogleSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalSpend = totalMetaSpend + totalGoogleSpend;
    const totalMetaLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalGoogleLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalLeads = totalMetaLeads + totalGoogleLeads;
    const totalRevenue = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.attributedRevenue, 0);
    const metaBlendedCpl = totalMetaLeads > 0 ? totalMetaSpend / totalMetaLeads : 0;
    const googleBlendedCpl = totalGoogleLeads > 0 ? totalGoogleSpend / totalGoogleLeads : 0;
    const conversionRate = totalLeads > 0 ? ((totalLeads * 0.75 * 0.75) / totalLeads * 100) : 0;
    return { totalSpend, totalLeads, totalRevenue, metaBlendedCpl, googleBlendedCpl, conversionRate };
  }, [metaCampaigns, googleCampaigns]);

  /* ---------- CPL chart data ---------- */
  const metaCplChartData   = useMemo(() => buildCplChartData(metaCampaigns), [metaCampaigns]);
  const googleCplChartData = useMemo(() => buildCplChartData(googleCampaigns), [googleCampaigns]);

  /* ---------- Campaign table columns (incl. consult-funnel costs) ---------- */
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
    { key: "costPerShow", label: "CP Show", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.75)).toFixed(1)}` : "—"; } },
    { key: "costPerResult", label: "CP Result", align: "right" as const, sortable: true, render: (_v: unknown, row: Record<string, unknown>) => { const spend = row.totalSpend as number; const leads = row.totalLeads as number; return leads > 0 ? `€${(spend / (leads * 0.75 * 0.75)).toFixed(1)}` : "—"; } },
    { key: "ctr", label: "CTR", align: "right" as const, sortable: true, render: (v: unknown) => `${(v as number).toFixed(1)}%` },
    { key: "cpm", label: "CPM", align: "right" as const, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "frequency", label: "Freq", align: "right" as const, render: (v: unknown) => (v as number).toFixed(1) },
    { key: "attributedRevenue", label: "Exp. Revenue", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
  ];

  const metaTotalAttributed = metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const metaTotalSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
  const metaRoasNum = metaTotalSpend > 0 ? metaTotalAttributed / metaTotalSpend : 0;

  const googleTotalAttributed = googleCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
  const googleTotalSpend = googleCampaigns.reduce((s, c) => s + c.totalSpend, 0);
  const googleRoasNum = googleTotalSpend > 0 ? googleTotalAttributed / googleTotalSpend : 0;

  /* ---------- Consultation Funnel from campaigns ---------- */
  const funnelStats = useMemo(() => {
    const totalLeads = [...metaCampaigns, ...googleCampaigns].reduce((s, c) => s + c.totalLeads, 0);
    const totalConsultations = Math.round(totalLeads * 0.75);
    const totalBookings = Math.round(totalLeads * 0.75 * 0.75);
    return { totalLeads, totalConsultations, totalBookings };
  }, [metaCampaigns, googleCampaigns]);

  /* ---------- Profitability Matrix ---------- */
  const profitabilityData = useMemo(() => {
    const toRow = (c: CampaignData, channel: "Meta" | "Google") => {
      // (non-revenue campaigns already filtered before calling toRow)
      const roas = c.totalSpend > 0 ? c.attributedRevenue / c.totalSpend : 0;
      const profit = c.attributedRevenue - c.totalSpend;
      const costPerShow = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.75) : 0;
      const costPerResult = c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * 0.75 * 0.75) : 0;
      const recommendation = roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";
      return { campaign: c.campaign, channel, totalLeads: c.totalLeads, totalSpend: c.totalSpend, cpl: c.cpl, costPerShow, costPerResult, attributedRevenue: c.attributedRevenue, roas, profit, recommendation };
    };
    return [
      ...metaCampaigns.filter((c) => !isNonRevenueCampaign("slimming", c.campaign)).map((c) => toRow(c, "Meta")),
      ...googleCampaigns.filter((c) => !isNonRevenueCampaign("slimming", c.campaign)).map((c) => toRow(c, "Google")),
    ].sort((a, b) => b.profit - a.profit);
  }, [metaCampaigns, googleCampaigns]);

  const profitabilityTotals = useMemo(() => {
    const totalLeads = profitabilityData.reduce((s, r) => s + r.totalLeads, 0);
    const totalSpend = profitabilityData.reduce((s, r) => s + r.totalSpend, 0);
    const totalAttrRevenue = profitabilityData.reduce((s, r) => s + r.attributedRevenue, 0);
    const totalProfit = profitabilityData.reduce((s, r) => s + r.profit, 0);
    const blendedRoas = totalSpend > 0 ? totalAttrRevenue / totalSpend : 0;
    const blendedCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const blendedCpShow = totalLeads > 0 ? totalSpend / (totalLeads * 0.75) : 0;
    const blendedCpResult = totalLeads > 0 ? totalSpend / (totalLeads * 0.75 * 0.75) : 0;
    return { totalLeads, totalSpend, totalAttrRevenue, totalProfit, blendedRoas, blendedCpl, blendedCpShow, blendedCpResult };
  }, [profitabilityData]);

  const profitabilityColumns = [
    {
      key: "campaign",
      label: "Campaign",
      render: (v: unknown) => (
        <span className="font-semibold" style={{ color: BRAND_COLOR }}>{v as string}</span>
      ),
    },
    { key: "channel", label: "Channel", render: (v: unknown) => <ChannelBadge channel={v as string} /> },
    { key: "totalLeads", label: "Leads", align: "right" as const, sortable: true },
    { key: "totalSpend", label: "Spend", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    { key: "cpl", label: "CPL", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "costPerShow", label: "CP Show", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "costPerResult", label: "CP Result", align: "right" as const, sortable: true, render: (v: unknown) => `€${(v as number).toFixed(1)}` },
    { key: "attributedRevenue", label: "Revenue", align: "right" as const, sortable: true, render: (v: unknown) => formatCurrency(v as number) },
    {
      key: "roas",
      label: "ROAS",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const r = v as number;
        return <span style={{ color: getRoasColor(r), fontWeight: 700 }}>{r.toFixed(1)}x</span>;
      },
    },
    {
      key: "profit",
      label: "Profit",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => {
        const p = v as number;
        return <span style={{ color: p >= 0 ? "#22C55E" : "#EF4444", fontWeight: 700 }}>{formatCurrency(p)}</span>;
      },
    },
    { key: "recommendation", label: "Action", align: "center" as const, render: (v: unknown) => <ActionBadge rec={v as string} /> },
  ];

  /* ---------- Email Marketing (Klaviyo API) ---------- */
  const { overview: klaviyo, loading: klaviyoLoading } = useKlaviyoOverview({
    brand: "slimming",
    dateFrom,
    dateTo,
  });
  const { popup: klaviyoPopup, loading: popupLoading } = useKlaviyoPopup("slimming", dateFrom, dateTo);

  /* ---------- Strategic commentary ---------- */
  const commentaryResult = useMemo(() => {
    const metaLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const googleLeads = googleCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    return computeBrandCommentary({
      brand: "slimming",
      meta: {
        totalSpend: metaTotalSpend,
        totalLeads: metaLeads,
        attributedRevenue: metaTotalAttributed,
        fatigueStats: metaFatigue,
      },
      google: {
        totalSpend: googleTotalSpend,
        totalLeads: googleLeads,
        attributedRevenue: googleTotalAttributed,
        fatigueStats: googleFatigue,
      },
      email: {
        openRate: klaviyo.openRate,
        clickRate: klaviyo.clickRate,
        hasData: !klaviyoLoading && klaviyo.openRate > 0,
      },
    });
  }, [metaCampaigns, googleCampaigns, metaTotalSpend, metaTotalAttributed, googleTotalSpend, googleTotalAttributed, metaFatigue, googleFatigue, klaviyo, klaviyoLoading]);

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <MarketingPageHeader
        title="Slimming Marketing"
        subtitle={`${formatDateRangeLabel(dateFrom, dateTo)} · Carisma Slimming — course-based model`}
        brand={B}
        badge="New Brand · Feb 2026"
      >
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

      {/* ── Strategic Commentary ─────────────────────────────────────── */}
      <MktCommentaryPanel title="Slimming Marketing Snapshot" result={commentaryResult} loading={isLoading || klaviyoLoading} />

      {/* ── Creative Fatigue Alert with full breakdown ───────────────── */}
      {(totalFatigued > 0 || totalWatch > 0) && (
        <div className={`rounded-xl border p-4 ${
          totalFatigued > 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
        }`}>
          <div className="flex items-center justify-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full animate-pulse shrink-0 ${totalFatigued > 0 ? "bg-red-500" : "bg-amber-400"}`} />
            <span className={`text-sm font-bold ${totalFatigued > 0 ? "text-red-700" : "text-amber-700"}`}>
              Creative Fatigue Alert
            </span>
          </div>
          <div className="flex items-center justify-center mt-2.5">
            <FatiguePills healthy={totalHealthy} watch={totalWatch} fatigued={totalFatigued} />
          </div>
        </div>
      )}

      {/* ── Section 1: Hero KPIs ────────────────────────────────────── */}
      {isLoading ? (
        <KPIGridSkeleton count={7} className="grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <HeroKPICard brand={B} label="Attributed Revenue" value={formatCurrency(heroKpis.totalRevenue)} icon={Euro} sub="All channels" />
          <HeroKPICard brand={B} label="Total Marketing Spend" value={formatCurrency(heroKpis.totalSpend)} icon={Wallet} sub="Meta + Google" />
          <HeroKPICard brand={B} label="Meta Blended CPL" value={`€${heroKpis.metaBlendedCpl.toFixed(1)}`} icon={MousePointerClick} sub="Cost per lead" />
          <HeroKPICard brand={B} label="Google Blended CPL" value={`€${heroKpis.googleBlendedCpl.toFixed(1)}`} icon={Search} sub="Cost per lead" />
          <HeroKPICard brand={B} label="Total Leads" value={String(heroKpis.totalLeads)} icon={Users} sub="Meta + Google" />
          <HeroKPICard brand={B} label="Conversion / Leads" value={`${heroKpis.conversionRate.toFixed(1)}%`} icon={Target} sub="Assumed funnel" />
          <HeroKPICard brand={B} label="Blended ROAS" value={heroKpis.totalSpend > 0 ? `${(heroKpis.totalRevenue / heroKpis.totalSpend).toFixed(1)}x` : "—"} icon={TrendingUp} sub="Revenue / spend" />
        </div>
      )}

      {/* ── Consultation Funnel ─────────────────────────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Consultation Funnel" brand={B} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AggregateBox brand={B} label="Total Leads" value={String(funnelStats.totalLeads)} icon={Users} />
          <AggregateBox brand={B} label="Consultations · assumed 75% show" value={String(funnelStats.totalConsultations)} icon={ClipboardCheck} />
          <AggregateBox brand={B} label="Bookings · assumed 75% close" value={String(funnelStats.totalBookings)} icon={CalendarCheck} />
        </div>
      </Card>

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

        {isLoading ? (
          <>
            <ChartSkeleton height={160} className="mb-6" />
            <TableSkeleton rows={4} columns={7} />
          </>
        ) : metaCampaigns.length > 0 ? (
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
                <CplBarChart data={metaCplChartData} brand={B} className="h-[160px] md:h-[200px]" />
              )}
            </div>

            <DataTable columns={campaignColumns} data={metaCampaigns as unknown as Record<string, unknown>[]} />

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <AggregateBox brand={B} label="Attributed Revenue" value={formatCurrency(metaTotalAttributed)} icon={Euro} />
              <AggregateBox brand={B} label="Ad Spend" value={formatCurrency(metaTotalSpend)} icon={Wallet} />
              <AggregateBox brand={B} label="ROAS" value={`${metaRoasNum.toFixed(1)}x`} valueColor={getRoasColor(metaRoasNum)} icon={TrendingUp} />
            </div>
          </>
        ) : (
          <EmptyState icon={BarChart3} message="No Meta campaign data for this period." />
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
          roasValue={googleTotalSpend > 0 ? `${googleRoasNum.toFixed(1)}x` : "—"}
        />

        {isLoading ? (
          <>
            <ChartSkeleton height={160} className="mb-6" />
            <TableSkeleton rows={4} columns={7} />
          </>
        ) : googleCampaigns.length > 0 ? (
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
                <CplBarChart data={googleCplChartData} brand={B} className="h-[150px] md:h-[180px]" />
              )}
            </div>

            <DataTable columns={campaignColumns} data={googleCampaigns as unknown as Record<string, unknown>[]} />

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <AggregateBox brand={B} label="Attributed Revenue" value={formatCurrency(googleTotalAttributed)} icon={Euro} />
              <AggregateBox brand={B} label="Ad Spend" value={formatCurrency(googleTotalSpend)} icon={Wallet} />
              <AggregateBox brand={B} label="ROAS" value={`${googleRoasNum.toFixed(1)}x`} valueColor={getRoasColor(googleRoasNum)} icon={TrendingUp} />
            </div>
          </>
        ) : (
          <EmptyState icon={Search} message="No Google Ads data for this period." />
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
              <AggregateBox brand={B} label="Subscribers" value={klaviyo.totalSubscribers.toLocaleString()} icon={Users} />
              <AggregateBox brand={B} label="Campaigns Sent" value={String(klaviyo.campaignsSent)} icon={Mail} />
              <AggregateBox brand={B} label="Active Flows" value={String(klaviyo.activeFlows)} icon={Activity} />
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 mb-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">Flow Performance</p>
                <div className="flex-1 h-px" style={{ backgroundColor: `${BRAND_FILL}` }} />
              </div>
              <FlowsTable brand="slimming" dateFrom={dateFrom} dateTo={dateTo} brandColor={BRAND_COLOR} />
            </div>
          </>
        )}
      </Card>

      {/* ── Section 4b: SEO — Google Search Console ───────────────────── */}
      <Card className="p-5 md:p-6">
        <ChannelHeader title="Search Console Rankings" brand={B} channelLabel="SEO" channelVariant="seo" />
        <p className="text-sm text-gray-500 -mt-3 mb-5">
          Where carismaslimming.com ranks for your tracked keywords on Google.
        </p>
        <KeywordRankingsTable brand="slimming" brandColor={BRAND_COLOR} dateFrom={dateFrom} dateTo={dateTo} />
      </Card>

      {/* ── Section 4c: Web Analytics (GA4) ──────────────────────────── */}
      <WebChannelSection
        brand="slimming"
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

        {isLoading ? (
          <TableSkeleton rows={6} columns={8} />
        ) : profitabilityData.length === 0 ? (
          <EmptyState message="No profitability data available for this period." />
        ) : (
          <>
            <DataTable columns={profitabilityColumns} data={profitabilityData as unknown as Record<string, unknown>[]} />

            <PortfolioTotals
              brand={B}
              items={[
                { label: "Total Leads", value: String(profitabilityTotals.totalLeads) },
                { label: "Total Spend", value: formatCurrency(profitabilityTotals.totalSpend) },
                { label: "Blended CPL", value: `€${profitabilityTotals.blendedCpl.toFixed(1)}` },
                { label: "CP Show", value: `€${profitabilityTotals.blendedCpShow.toFixed(1)}` },
                { label: "CP Result", value: `€${profitabilityTotals.blendedCpResult.toFixed(1)}` },
                { label: "Total Revenue", value: formatCurrency(profitabilityTotals.totalAttrRevenue) },
                { label: "Blended ROAS", value: `${profitabilityTotals.blendedRoas.toFixed(1)}x`, color: getRoasColor(profitabilityTotals.blendedRoas) },
                { label: "Total Profit", value: formatCurrency(profitabilityTotals.totalProfit), color: profitabilityTotals.totalProfit >= 0 ? "#22C55E" : "#EF4444" },
              ]}
            />
          </>
        )}
      </Card>
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
