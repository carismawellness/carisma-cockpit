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
import type { CampaignData } from "@/lib/types/ads";

/* ---------- brand colours ---------- */

const BRAND = {
  spa: { name: "Spa", color: "#EFE7D7" },
  aesthetics: { name: "Aesthetics", color: "#DEEBEB" },
  slimming: { name: "Slimming", color: "#C9D8C1" },
} as const;

type BrandKey = keyof typeof BRAND;
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
                  <td key={key} className={`py-3 px-4 text-right font-bold ${colorClass}`}>
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
      const googleLeads = google.reduce((s, c) => s + c.totalLeads, 0);
      const googleSpend = google.reduce((s, c) => s + c.totalSpend, 0);
      return {
        revenue: formatCurrency(revenue),
        spend: formatCurrency(spend),
        roas: spend > 0 ? `${(revenue / spend).toFixed(1)}x` : "—",
        roasNum: spend > 0 ? revenue / spend : 0,
        cpl: metaLeads > 0 ? `€${(metaSpend / metaLeads).toFixed(1)}` : "—",
        cpc: googleLeads > 0 ? `€${(googleSpend / googleLeads).toFixed(1)}` : "—",
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
      const spend = campaigns.reduce((s, c) => s + c.totalSpend, 0);
      const revenue = campaigns.reduce((s, c) => s + c.attributedRevenue, 0);
      const expectedRevenue = Math.round(revenue * 1.15);
      const roas = spend > 0 ? expectedRevenue / spend : 0;
      return {
        expectedRevenue: formatCurrency(expectedRevenue),
        spend: formatCurrency(spend),
        roas: `${roas.toFixed(1)}x`,
        roasNum: roas,
      };
    }

    const metaSpaM = channelMetrics(metaSpa.data?.campaigns ?? []);
    const metaAesM = channelMetrics(metaAes.data?.campaigns ?? []);
    const metaSlimM = channelMetrics(metaSlim.data?.campaigns ?? []);
    const googleSpaM = channelMetrics(googleSpa.data?.campaigns ?? []);
    const googleAesM = channelMetrics(googleAes.data?.campaigns ?? []);
    const googleSlimM = channelMetrics(googleSlim.data?.campaigns ?? []);

    const fmtSubs = (n: number) => n > 0 ? n.toLocaleString() : "—";
    const fmtPct = (n: number) => n > 0 ? `${(n * 100).toFixed(1)}%` : "—";

    return [
      {
        channel: "Meta Ads",
        rows: [
          { metric: "Expected Revenue", spa: metaSpaM.expectedRevenue, aesthetics: metaAesM.expectedRevenue, slimming: metaSlimM.expectedRevenue },
          { metric: "Ad Spend", spa: metaSpaM.spend, aesthetics: metaAesM.spend, slimming: metaSlimM.spend },
          {
            metric: "Expected ROAS", spa: metaSpaM.roas, aesthetics: metaAesM.roas, slimming: metaSlimM.roas,
            roasValues: { spa: metaSpaM.roasNum, aesthetics: metaAesM.roasNum, slimming: metaSlimM.roasNum },
          },
        ] as TableRow[],
      },
      {
        channel: "Google Ads",
        rows: [
          { metric: "Expected Revenue", spa: googleSpaM.expectedRevenue, aesthetics: googleAesM.expectedRevenue, slimming: googleSlimM.expectedRevenue },
          { metric: "Ad Spend", spa: googleSpaM.spend, aesthetics: googleAesM.spend, slimming: googleSlimM.spend },
          {
            metric: "Expected ROAS", spa: googleSpaM.roas, aesthetics: googleAesM.roas, slimming: googleSlimM.roas,
            roasValues: { spa: googleSpaM.roasNum, aesthetics: googleAesM.roasNum, slimming: googleSlimM.roasNum },
          },
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
          { metric: "Revenue", spa: "—", aesthetics: "—", slimming: "—" },
          { metric: "ROAS", spa: "—", aesthetics: "—", slimming: "—" },
        ] as TableRow[],
      },
    ];
  }, [metaSpa.data, metaAes.data, metaSlim.data, googleSpa.data, googleAes.data, googleSlim.data, klavSpa, klavAes, klavSlim]);

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
          {/* -- Section 1: Cross-Brand KPI Table -- */}
          <section>
            <Card className="p-3 md:p-6">
              <h2 className="text-lg font-semibold mb-4">Cross-Brand KPIs</h2>
              <BrandTable rows={crossBrandKpis} colorCodeRoas />
            </Card>
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
