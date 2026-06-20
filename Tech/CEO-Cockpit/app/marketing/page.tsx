"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SyncButton } from "@/components/dashboard/SyncButton";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useMetaCampaignsFromDb as useMetaCampaigns, useGoogleCampaignsFromDb as useGoogleCampaigns } from "@/lib/hooks/useAdsCampaigns";
import { useKlaviyoOverview } from "@/lib/hooks/useKlaviyoOverview";
import { useGscRankings } from "@/lib/hooks/useGscRankings";
import { BRAND as BRAND_TOKENS, type BrandKey } from "@/lib/constants/design-tokens";
import type { CampaignData } from "@/lib/types/ads";
import { computeMasterCommentary } from "@/lib/commentary/marketing-engine";
import { MktCommentaryPanel } from "@/components/marketing/CommentaryPanel";
import { AdSpendYoYChart } from "@/components/marketing/AdSpendYoYChart";
import { useSpendComparison } from "@/lib/hooks/useSpendComparison";

/* ---------- brand colours (canonical palette) ---------- */

const BRAND = {
  spa:        { name: "Spa",        color: BRAND_TOKENS.spa.dark },
  aesthetics: { name: "Aesthetics", color: BRAND_TOKENS.aesthetics.dark },
  slimming:   { name: "Slimming",   color: BRAND_TOKENS.slimming.dark },
} as const;

const BRAND_KEYS: BrandKey[] = ["spa", "aesthetics", "slimming"];

/* ---------- helpers ---------- */

function BrandDot({ brand }: { brand: BrandKey }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full shrink-0"
      style={{ backgroundColor: BRAND[brand].color }}
    />
  );
}

function roasColor(value: number): string {
  if (value >= 5) return "text-green-600";
  if (value >= 3) return "text-amber-600";
  return "text-red-600";
}

/* ---------- reusable brand table component ---------- */

interface TableRow {
  metric: string;
  spa: string;
  aesthetics: string;
  slimming: string;
  roasValues?: { spa: number; aesthetics: number; slimming: number };
}

function BrandTable({
  rows,
  colorCodeRoas,
}: {
  rows: TableRow[];
  colorCodeRoas?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 pr-4 font-medium text-muted-foreground w-[180px]">Metric</th>
            {BRAND_KEYS.map((key) => (
              <th key={key} className="py-3 px-4 text-right font-medium">
                <span className="inline-flex items-center gap-2 justify-end">
                  <BrandDot brand={key} />
                  {BRAND[key].name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metric} className="border-b last:border-b-0">
              <td className="py-3 pr-4 text-muted-foreground">{row.metric}</td>
              {BRAND_KEYS.map((key) => {
                const isRoas = colorCodeRoas && row.roasValues;
                const colorClass = isRoas ? roasColor(row.roasValues![key]) : "";
                return (
                  <td key={key} className={`py-3 px-4 text-right tabular-nums font-bold ${colorClass}`}>
                    {row[key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- loading skeleton ---------- */

function LoadingSkeleton() {
  return (
    <div className="space-y-6 md:space-y-10 animate-pulse">
      <div className="h-8 bg-muted rounded w-64" />
      <Card className="p-6"><div className="h-48 bg-muted rounded" /></Card>
      <Card className="p-6"><div className="h-36 bg-muted rounded" /></Card>
      <Card className="p-6"><div className="h-48 bg-muted rounded" /></Card>
    </div>
  );
}

/* ---------- content component ---------- */

function MarketingMasterContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const queryClient = useQueryClient();
  /* Fetch real Meta + Google data for all 3 brands */
  const metaSpa = useMetaCampaigns("spa", dateFrom, dateTo);
  const metaAes = useMetaCampaigns("aesthetics", dateFrom, dateTo);
  const metaSlim = useMetaCampaigns("slimming", dateFrom, dateTo);
  const googleSpa = useGoogleCampaigns("spa", dateFrom, dateTo);
  const googleAes = useGoogleCampaigns("aesthetics", dateFrom, dateTo);
  const googleSlim = useGoogleCampaigns("slimming", dateFrom, dateTo);
  const { overview: klavSpa, loading: klavSpaLoading } = useKlaviyoOverview({ brand: "spa", dateFrom, dateTo });
  const { overview: klavAes, loading: klavAesLoading } = useKlaviyoOverview({ brand: "aesthetics", dateFrom, dateTo });
  const { overview: klavSlim, loading: klavSlimLoading } = useKlaviyoOverview({ brand: "slimming", dateFrom, dateTo });
  const { keywords: gscSpa } = useGscRankings({ brand: "spa", dateFrom, dateTo });
  const { keywords: gscAes } = useGscRankings({ brand: "aesthetics", dateFrom, dateTo });
  const { keywords: gscSlim } = useGscRankings({ brand: "slimming", dateFrom, dateTo });

  /* ---- YoY spend comparison (Supabase-backed, handles LY date calc) ---- */
  const spaSpc  = useSpendComparison("spa",        dateFrom, dateTo);
  const aesSpc  = useSpendComparison("aesthetics", dateFrom, dateTo);
  const slimSpc = useSpendComparison("slimming",   dateFrom, dateTo);

  const isLoading =
    metaSpa.isLoading || metaAes.isLoading || metaSlim.isLoading ||
    googleSpa.isLoading || googleAes.isLoading || googleSlim.isLoading ||
    klavSpaLoading || klavAesLoading || klavSlimLoading;
  const anyTokenExpired =
    metaSpa.data?.tokenExpired || metaAes.data?.tokenExpired || metaSlim.data?.tokenExpired ||
    googleSpa.data?.tokenExpired || googleAes.data?.tokenExpired || googleSlim.data?.tokenExpired;
  const anyError =
    metaSpa.data?.error || metaAes.data?.error || metaSlim.data?.error ||
    googleSpa.data?.error || googleAes.data?.error || googleSlim.data?.error;

  /* ---- Compute cross-brand KPIs ---- */
  const crossBrandKpis = useMemo(() => {
    function brandTotals(meta: CampaignData[], google: CampaignData[]) {
      const all = [...meta, ...google];
      const spend = all.reduce((s, c) => s + c.totalSpend, 0);
      const revenue = all.reduce((s, c) => s + c.attributedRevenue, 0);
      const metaLeads = meta.reduce((s, c) => s + c.totalLeads, 0);
      const metaSpend = meta.reduce((s, c) => s + c.totalSpend, 0);
      // CPC uses total clicks across Meta + Google (not leads/conversions)
      const totalClicks = all.reduce((s, c) => s + c.clicks, 0);
      return {
        revenue: formatCurrency(revenue),
        spend: formatCurrency(spend),
        roas: spend > 0 ? `${(revenue / spend).toFixed(1)}x` : "—",
        roasNum: spend > 0 ? revenue / spend : 0,
        cpl: metaLeads > 0 ? `€${(metaSpend / metaLeads).toFixed(1)}` : "—",
        cpc: totalClicks > 0 ? `€${(spend / totalClicks).toFixed(2)}` : "—",
      };
    }

    const spa = brandTotals(metaSpa.data?.campaigns ?? [], googleSpa.data?.campaigns ?? []);
    const aes = brandTotals(metaAes.data?.campaigns ?? [], googleAes.data?.campaigns ?? []);
    const slim = brandTotals(metaSlim.data?.campaigns ?? [], googleSlim.data?.campaigns ?? []);

    return [
      { metric: "Revenue", spa: spa.revenue, aesthetics: aes.revenue, slimming: slim.revenue },
      { metric: "Total Spend", spa: spa.spend, aesthetics: aes.spend, slimming: slim.spend },
      {
        metric: "Blended ROAS",
        spa: spa.roas, aesthetics: aes.roas, slimming: slim.roas,
        roasValues: { spa: spa.roasNum, aesthetics: aes.roasNum, slimming: slim.roasNum },
      },
      { metric: "CPL", spa: spa.cpl, aesthetics: aes.cpl, slimming: slim.cpl },
      { metric: "CPC", spa: spa.cpc, aesthetics: aes.cpc, slimming: slim.cpc },
    ];
  }, [metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data]);

  /* ---- Compute YoY spend chart data ---- */
  const spendChartData = useMemo(() => {
    function sumMonths(months: { metaTY: number; metaLY: number; googleTY: number; googleLY: number }[]) {
      return months.reduce(
        (acc, m) => ({
          metaTY:   acc.metaTY   + m.metaTY,
          metaLY:   acc.metaLY   + m.metaLY,
          googleTY: acc.googleTY + m.googleTY,
          googleLY: acc.googleLY + m.googleLY,
        }),
        { metaTY: 0, metaLY: 0, googleTY: 0, googleLY: 0 }
      );
    }
    const spa  = sumMonths(spaSpc.data  ?? []);
    const aes  = sumMonths(aesSpc.data  ?? []);
    const slim = sumMonths(slimSpc.data ?? []);
    return [
      { brand: "Spa",        ...spa  },
      { brand: "Aesthetics", ...aes  },
      { brand: "Slimming",   ...slim },
    ];
  }, [spaSpc.data, aesSpc.data, slimSpc.data]);

  /* ---- Compute ROAS per channel per brand ---- */
  const spendRoas = useMemo(() => {
    function channelRoas(campaigns: CampaignData[]): number | null {
      const spend   = campaigns.reduce((s, c) => s + c.totalSpend,        0);
      const revenue = campaigns.reduce((s, c) => s + c.attributedRevenue, 0);
      return spend > 0 ? revenue / spend : null;
    }
    return {
      spa:        { metaRoas: channelRoas(metaSpa.data?.campaigns  ?? []), googleRoas: channelRoas(googleSpa.data?.campaigns  ?? []) },
      aesthetics: { metaRoas: channelRoas(metaAes.data?.campaigns  ?? []), googleRoas: channelRoas(googleAes.data?.campaigns  ?? []) },
      slimming:   { metaRoas: channelRoas(metaSlim.data?.campaigns ?? []), googleRoas: channelRoas(googleSlim.data?.campaigns ?? []) },
    };
  }, [metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data]);

  /* ---- Compute fatigue data ---- */
  const fatigueData = useMemo(() => {
    function countFatigue(campaigns: CampaignData[]) {
      let healthy = 0, watch = 0, fatigued = 0;
      for (const c of campaigns) {
        const ctrDrop = c.peakCtr > 0 ? (c.peakCtr - c.ctr) / c.peakCtr : 0;
        if (c.frequency > 3.0 && ctrDrop > 0.2) fatigued++;
        else if (c.frequency >= 2.0 && ctrDrop >= 0.1) watch++;
        else healthy++;
      }
      return { healthy, watch, fatigued };
    }

    const allSpa = [...(metaSpa.data?.campaigns ?? []), ...(googleSpa.data?.campaigns ?? [])];
    const allAes = [...(metaAes.data?.campaigns ?? []), ...(googleAes.data?.campaigns ?? [])];
    const allSlim = [...(metaSlim.data?.campaigns ?? []), ...(googleSlim.data?.campaigns ?? [])];

    return [
      { brand: "spa" as const, ...countFatigue(allSpa) },
      { brand: "aesthetics" as const, ...countFatigue(allAes) },
      { brand: "slimming" as const, ...countFatigue(allSlim) },
    ];
  }, [metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data]);

  /* ---- Compute channel performance ---- */
  const channelByBrand = useMemo(() => {
    function channelMetrics(campaigns: CampaignData[]) {
      const spend   = campaigns.reduce((s, c) => s + c.totalSpend, 0);
      const revenue = campaigns.reduce((s, c) => s + c.attributedRevenue, 0);
      const leads   = campaigns.reduce((s, c) => s + c.totalLeads, 0);
      const clicks  = campaigns.reduce((s, c) => s + c.clicks, 0);
      const roas    = spend > 0 ? revenue / spend : 0;
      return {
        revenue: formatCurrency(revenue),
        spend:   formatCurrency(spend),
        roas:    `${roas.toFixed(1)}x`,
        roasNum: roas,
        cpl:     leads  > 0 ? `€${(spend / leads).toFixed(2)}`  : "—",
        cpc:     clicks > 0 ? `€${(spend / clicks).toFixed(2)}` : "—",
      };
    }

    const metaSpaM  = channelMetrics(metaSpa.data?.campaigns  ?? []);
    const metaAesM  = channelMetrics(metaAes.data?.campaigns  ?? []);
    const metaSlimM = channelMetrics(metaSlim.data?.campaigns ?? []);
    const googleSpaM  = channelMetrics(googleSpa.data?.campaigns  ?? []);
    const googleAesM  = channelMetrics(googleAes.data?.campaigns  ?? []);
    const googleSlimM = channelMetrics(googleSlim.data?.campaigns ?? []);

    const fmtSubs = (n: number) => n > 0 ? n.toLocaleString() : "—";
    const fmtPct = (n: number) => n > 0 ? `${(n * 100).toFixed(1)}%` : "—";

    return [
      {
        channel: "Meta Ads",
        rows: [
          { metric: "Attributed Revenue", spa: metaSpaM.revenue,  aesthetics: metaAesM.revenue,  slimming: metaSlimM.revenue },
          { metric: "Ad Spend",           spa: metaSpaM.spend,    aesthetics: metaAesM.spend,    slimming: metaSlimM.spend },
          {
            metric: "ROAS", spa: metaSpaM.roas, aesthetics: metaAesM.roas, slimming: metaSlimM.roas,
            roasValues: { spa: metaSpaM.roasNum, aesthetics: metaAesM.roasNum, slimming: metaSlimM.roasNum },
          },
          { metric: "CPL (Cost per Lead)",  spa: metaSpaM.cpl,  aesthetics: metaAesM.cpl,  slimming: metaSlimM.cpl },
          { metric: "CPC (Cost per Click)", spa: metaSpaM.cpc,  aesthetics: metaAesM.cpc,  slimming: metaSlimM.cpc },
        ] as TableRow[],
      },
      {
        channel: "Google Ads",
        rows: [
          { metric: "Attributed Revenue",       spa: googleSpaM.revenue,  aesthetics: googleAesM.revenue,  slimming: googleSlimM.revenue },
          { metric: "Ad Spend",                 spa: googleSpaM.spend,    aesthetics: googleAesM.spend,    slimming: googleSlimM.spend },
          {
            metric: "ROAS", spa: googleSpaM.roas, aesthetics: googleAesM.roas, slimming: googleSlimM.roas,
            roasValues: { spa: googleSpaM.roasNum, aesthetics: googleAesM.roasNum, slimming: googleSlimM.roasNum },
          },
          { metric: "CPL (Cost per Conv.)",  spa: googleSpaM.cpl,  aesthetics: googleAesM.cpl,  slimming: googleSlimM.cpl },
          { metric: "CPC (Cost per Click)",  spa: googleSpaM.cpc,  aesthetics: googleAesM.cpc,  slimming: googleSlimM.cpc },
        ] as TableRow[],
      },
      {
        channel: "Email (Klaviyo)",
        rows: [
          { metric: "Subscribers", spa: fmtSubs(klavSpa.totalSubscribers), aesthetics: fmtSubs(klavAes.totalSubscribers), slimming: fmtSubs(klavSlim.totalSubscribers) },
          { metric: "Campaigns Sent", spa: fmtSubs(klavSpa.campaignsSent), aesthetics: fmtSubs(klavAes.campaignsSent), slimming: fmtSubs(klavSlim.campaignsSent) },
          { metric: "Active Flows", spa: fmtSubs(klavSpa.activeFlows), aesthetics: fmtSubs(klavAes.activeFlows), slimming: fmtSubs(klavSlim.activeFlows) },
          { metric: "Open Rate", spa: fmtPct(klavSpa.openRate), aesthetics: fmtPct(klavAes.openRate), slimming: fmtPct(klavSlim.openRate) },
          { metric: "Click Rate", spa: fmtPct(klavSpa.clickRate), aesthetics: fmtPct(klavAes.clickRate), slimming: fmtPct(klavSlim.clickRate) },
        ] as TableRow[],
      },
      {
        channel: "Search Console (Organic SEO)",
        rows: (() => {
          // Cross-brand summary: just the 3 KPIs that matter at this level.
          // (Per-keyword detail renders below the table in its own block.)
          function summary(rows: typeof gscSpa) {
            let imp = 0, clicks = 0;
            for (const r of rows) {
              imp += r.impressions ?? 0;
              clicks += r.clicks ?? 0;
            }
            return { imp, clicks, ctr: imp > 0 ? clicks / imp : 0 };
          }
          const s = summary(gscSpa);
          const a = summary(gscAes);
          const sl = summary(gscSlim);
          return [
            { metric: "Impressions", spa: fmtSubs(s.imp), aesthetics: fmtSubs(a.imp), slimming: fmtSubs(sl.imp) },
            { metric: "Clicks", spa: fmtSubs(s.clicks), aesthetics: fmtSubs(a.clicks), slimming: fmtSubs(sl.clicks) },
            { metric: "CTR", spa: fmtPct(s.ctr), aesthetics: fmtPct(a.ctr), slimming: fmtPct(sl.ctr) },
          ] as TableRow[];
        })(),
      },
    ];
  }, [metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data, klavSpa, klavAes, klavSlim, gscSpa, gscAes, gscSlim]);

  /* ---- Strategic commentary ---- */
  const commentaryResult = useMemo(() => {
    function buildBrand(brand: "spa" | "aesthetics" | "slimming", meta: CampaignData[], google: CampaignData[], klav: { openRate: number; clickRate: number; hasData: boolean }, klavLoading: boolean) {
      const f = fatigueData.find(x => x.brand === brand) ?? { healthy: 0, watch: 0, fatigued: 0 };
      return {
        brand,
        meta: {
          totalSpend: meta.reduce((s, c) => s + c.totalSpend, 0),
          totalLeads: meta.reduce((s, c) => s + c.totalLeads, 0),
          attributedRevenue: meta.reduce((s, c) => s + c.attributedRevenue, 0),
          fatigueStats: { healthy: f.healthy, watch: f.watch, fatigued: f.fatigued },
        },
        google: {
          totalSpend: google.reduce((s, c) => s + c.totalSpend, 0),
          totalLeads: google.reduce((s, c) => s + c.totalLeads, 0),
          attributedRevenue: google.reduce((s, c) => s + c.attributedRevenue, 0),
          fatigueStats: { healthy: 0, watch: 0, fatigued: 0 },
        },
        email: {
          openRate: klav.openRate,
          clickRate: klav.clickRate,
          hasData: !klavLoading && klav.hasData,
        },
      };
    }
    return computeMasterCommentary({
      spa:        buildBrand("spa",        metaSpa.data?.campaigns  ?? [], googleSpa.data?.campaigns  ?? [], klavSpa,  klavSpaLoading),
      aesthetics: buildBrand("aesthetics", metaAes.data?.campaigns  ?? [], googleAes.data?.campaigns  ?? [], klavAes,  klavAesLoading),
      slimming:   buildBrand("slimming",   metaSlim.data?.campaigns ?? [], googleSlim.data?.campaigns ?? [], klavSlim, klavSlimLoading),
    });
  }, [fatigueData, metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data, klavSpa, klavAes, klavSlim, klavSpaLoading, klavAesLoading, klavSlimLoading]);

  /* ---- Check if any data loaded ---- */
  const totalCampaigns =
    (metaSpa.data?.campaigns?.length ?? 0) + (metaAes.data?.campaigns?.length ?? 0) +
    (metaSlim.data?.campaigns?.length ?? 0) + (googleSpa.data?.campaigns?.length ?? 0) +
    (googleAes.data?.campaigns?.length ?? 0) + (googleSlim.data?.campaigns?.length ?? 0);
  const hasKlaviyoData = klavSpa.hasData || klavAes.hasData || klavSlim.hasData;
  const hasAnyData = totalCampaigns > 0 || hasKlaviyoData;

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6 md:space-y-10">
      {/* -- Page header -- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Marketing Master</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRangeLabel(dateFrom, dateTo)} · Cross-brand marketing performance overview
          </p>
        </div>
        <SyncButton
          onSync={async () => {
            await Promise.all([
              fetch("/api/etl/meta-campaigns", { method: "POST" }),
              fetch("/api/etl/google-campaigns", { method: "POST" }),
              fetch("/api/etl/klaviyo-sync", { method: "POST" }),
            ]);
            await queryClient.invalidateQueries({ queryKey: ["meta-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["google-campaigns-db"] });
            await queryClient.invalidateQueries({ queryKey: ["klaviyo"] });
          }}
          isExternalBusy={isLoading}
        />
      </div>

      {/* -- Token / error warnings -- */}
      {anyTokenExpired && (
        <Card className="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            One or more ad platform tokens have expired. Some data may be incomplete.
            Re-authenticate in Settings to restore full data.
          </p>
        </Card>
      )}

      {anyError && !anyTokenExpired && (
        <Card className="p-4 border-red-300 bg-red-50 dark:bg-red-950/20">
          <p className="text-sm text-red-800 dark:text-red-200">
            Error loading ad data: {anyError}
          </p>
        </Card>
      )}

      {!hasAnyData && (
        <Card className="p-6 text-center">
          <p className="text-muted-foreground">No campaign data available for the selected date range.</p>
          <p className="text-xs text-muted-foreground mt-1">
            {anyTokenExpired
              ? "Refresh your ad platform tokens to restore live data."
              : "Data is fetched directly from Meta Ads, Google Ads, and Klaviyo APIs."}
          </p>
        </Card>
      )}

      {hasAnyData && (
        <>
          {/* -- Strategic Commentary -- */}
          <MktCommentaryPanel result={commentaryResult} loading={isLoading} />

          {/* -- Section 1: Cross-Brand KPI Table -- */}
          <section>
            <Card className="p-3 md:p-6">
              <h2 className="text-lg font-semibold mb-4">Cross-Brand KPIs</h2>
              <BrandTable rows={crossBrandKpis} colorCodeRoas />
            </Card>
          </section>

          {/* -- Section 1b: Ad Spend YoY + ROAS Chart -- */}
          <section>
            <AdSpendYoYChart
              rows={spendChartData}
              roas={spendRoas}
              loading={spaSpc.isLoading || aesSpc.isLoading || slimSpc.isLoading}
              dateLabel={formatDateRangeLabel(dateFrom, dateTo)}
            />
          </section>

          {/* -- Section 2: Creative Fatigue by Brand -- */}
          <section>
            <Card className="p-3 md:p-6">
              <h2 className="text-lg font-semibold mb-4 md:mb-6 text-center">Creative Fatigue by Brand</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                {fatigueData.map((f) => {
                  const b = BRAND[f.brand];
                  const total = f.healthy + f.watch + f.fatigued;
                  if (total === 0) return (
                    <div key={f.brand} className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2">
                        <BrandDot brand={f.brand} />
                        <span className="font-semibold text-base">{b.name}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">No ads tracked</p>
                    </div>
                  );
                  const healthyPct = (f.healthy / total) * 100;
                  const watchPct = (f.watch / total) * 100;
                  const fatiguedPct = (f.fatigued / total) * 100;

                  return (
                    <div key={f.brand} className="flex flex-col items-center gap-4">
                      <div className="flex items-center gap-2">
                        <BrandDot brand={f.brand} />
                        <span className="font-semibold text-base">{b.name}</span>
                      </div>
                      <div className="w-full h-6 rounded-full overflow-hidden flex bg-muted">
                        {healthyPct > 0 && (
                          <div className="h-full bg-green-500 transition-all" style={{ width: `${healthyPct}%` }} title={`${f.healthy} Healthy`} />
                        )}
                        {watchPct > 0 && (
                          <div className="h-full bg-amber-400 transition-all" style={{ width: `${watchPct}%` }} title={`${f.watch} Watch`} />
                        )}
                        {fatiguedPct > 0 && (
                          <div className="h-full bg-red-500 transition-all" style={{ width: `${fatiguedPct}%` }} title={`${f.fatigued} Fatigued`} />
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs font-medium flex-wrap justify-center">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                          {f.healthy} Healthy
                        </span>
                        <span className="text-muted-foreground">|</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                          {f.watch} Watch
                        </span>
                        <span className="text-muted-foreground">|</span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                          {f.fatigued} Fatigued
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* -- Section 3: Channel Performance by Brand -- */}
          <section className="space-y-4 md:space-y-6">
            <h2 className="text-lg font-semibold">Channel Performance by Brand</h2>
            {channelByBrand.map((ch) => (
              <Card key={ch.channel} className="p-3 md:p-6">
                <h3 className="font-semibold mb-4">{ch.channel}</h3>
                <BrandTable rows={ch.rows} colorCodeRoas />
                {ch.channel === "Search Console (Organic SEO)" && (
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      { brand: "spa" as const, label: "Spa", color: BRAND.spa.color, keywords: gscSpa },
                      { brand: "aesthetics" as const, label: "Aesthetics", color: BRAND.aesthetics.color, keywords: gscAes },
                      { brand: "slimming" as const, label: "Slimming", color: BRAND.slimming.color, keywords: gscSlim },
                    ]).map(({ brand, label, color, keywords }) => (
                      <div key={brand} className="rounded-lg border bg-white p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                          <h4 className="text-sm font-semibold">{label}</h4>
                        </div>
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="text-left font-medium pb-1">Keyword</th>
                              <th className="text-right font-medium pb-1">Position</th>
                              <th className="text-right font-medium pb-1">Δ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {[...keywords]
                              .sort((a, b) => {
                                // sort by current position (best first); nulls go last
                                if (a.position === null && b.position === null) return 0;
                                if (a.position === null) return 1;
                                if (b.position === null) return -1;
                                return a.position - b.position;
                              })
                              .map((k) => {
                                const posStr = k.position === null ? "—" : k.position.toFixed(1);
                                let chgEl;
                                if (k.positionChange === null) {
                                  chgEl = <span className="text-gray-400">—</span>;
                                } else if (Math.abs(k.positionChange) < 0.1) {
                                  chgEl = <span className="text-gray-400">·</span>;
                                } else if (k.positionChange > 0) {
                                  chgEl = <span className="text-emerald-600">▲ {k.positionChange.toFixed(1)}</span>;
                                } else {
                                  chgEl = <span className="text-red-600">▼ {Math.abs(k.positionChange).toFixed(1)}</span>;
                                }
                                return (
                                  <tr key={k.keyword}>
                                    <td className="py-1 truncate max-w-[140px]" title={k.keyword}>{k.keyword}</td>
                                    <td className="py-1 text-right tabular-nums font-semibold">{posStr}</td>
                                    <td className="py-1 text-right tabular-nums">{chgEl}</td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </section>
        </>
      )}

      <section>
      </section>
    </div>
  );
}

/* ---------- page export ---------- */

export default function MarketingPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <MarketingMasterContent
          dateFrom={dateFrom}
          dateTo={dateTo}
          brandFilter={brandFilter}
        />
      )}
    </DashboardShell>
  );
}
