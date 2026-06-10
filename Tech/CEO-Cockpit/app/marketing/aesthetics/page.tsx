"use client";

import { useMemo } from "react";
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

const BRAND_COLOR = "#3B7676";  // aesthetics text-dark (readable for text + borders)

/* ---------- helpers ---------- */

function getFatigueStatus(
  frequency: number,
  ctr: number,
  peakCtr: number
): { label: string; color: string; bg: string; barColor: string } {
  const ctrDrop = peakCtr > 0 ? (peakCtr - ctr) / peakCtr : 0;
  if (frequency > 3.0 && ctrDrop > 0.2)
    return { label: "Fatigued", color: "bg-red-500", bg: "bg-red-50 text-red-700", barColor: "#EF4444" };
  if (frequency >= 2.0 && ctrDrop >= 0.1)
    return { label: "Watch", color: "bg-amber-500", bg: "bg-amber-50 text-amber-700", barColor: "#F59E0B" };
  return { label: "Healthy", color: "bg-green-500", bg: "bg-green-50 text-green-700", barColor: "#22C55E" };
}

function countFatigueStatuses(campaigns: CampaignData[]) {
  let healthy = 0,
    watch = 0,
    fatigued = 0;
  for (const c of campaigns) {
    const s = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
    if (s.label === "Healthy") healthy++;
    else if (s.label === "Watch") watch++;
    else fatigued++;
  }
  return { healthy, watch, fatigued };
}

function roasColor(roas: number): string {
  if (roas >= 5) return "text-green-600";
  if (roas >= 3) return "text-amber-600";
  return "text-red-600";
}

/* ---------- Aggregate Metric Box ---------- */

function AggregateBox({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border-2 p-4 text-center ${className ?? ""}`}
      style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
    >
      <p className="text-sm text-gray-600">{label}</p>
      <p className="text-xl md:text-2xl font-bold mt-1" style={{ color: BRAND_COLOR }}>
        {value}
      </p>
    </div>
  );
}

/* ---------- Email Progress Bar ---------- */

function EmailRateBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="font-semibold text-gray-900">{value}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-100">
        <div
          className="h-3 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: BRAND_COLOR }}
        />
      </div>
    </div>
  );
}

/* ---------- Skeleton loader ---------- */

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-white p-4 animate-pulse">
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-20 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-200 rounded" />
    </div>
  );
}

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
  /* ---- fetch campaign data from Meta & Google APIs ---- */
  const metaQuery = useMetaCampaigns("aesthetics", dateFrom, dateTo);
  const googleQuery = useGoogleCampaigns("aesthetics", dateFrom, dateTo);

  const metaCampaigns: CampaignData[] = metaQuery.data?.campaigns ?? [];
  const googleCampaigns: CampaignData[] = googleQuery.data?.campaigns ?? [];

  const isLoading = metaQuery.isLoading || googleQuery.isLoading;
  const apiError = metaQuery.data?.error || googleQuery.data?.error;
  const tokenExpired = metaQuery.data?.tokenExpired || googleQuery.data?.tokenExpired;

  /* ---- Fatigue counts ---- */
  const metaFatigue = useMemo(
    () => countFatigueStatuses(metaCampaigns),
    [metaCampaigns]
  );
  const googleFatigue = useMemo(
    () => countFatigueStatuses(googleCampaigns),
    [googleCampaigns]
  );
  const totalFatigued = metaFatigue.fatigued + googleFatigue.fatigued;
  const totalWatch = metaFatigue.watch + googleFatigue.watch;

  /* ---- Meta aggregate ---- */
  const metaAggregate = useMemo(() => {
    if (!metaCampaigns.length) return null;
    const totalSpend = metaCampaigns.reduce((s, c) => s + c.totalSpend, 0);
    const totalLeads = metaCampaigns.reduce((s, c) => s + c.totalLeads, 0);
    const totalRevenue = metaCampaigns.reduce((s, c) => s + c.attributedRevenue, 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    return { totalSpend, totalLeads, totalRevenue, roas };
  }, [metaCampaigns]);

  /* ---- Google aggregate ---- */
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
    { key: "campaign", label: "Campaign Name" },
    {
      key: "cpl",
      label: "CPL",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => `€${(v as number).toFixed(1)}`,
    },
    {
      key: "totalSpend",
      label: "Total Spend",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => formatCurrency(v as number),
    },
    { key: "totalLeads", label: "Total Leads", align: "right" as const, sortable: true },
    {
      key: "costPerShow",
      label: "CP Show",
      align: "right" as const,
      sortable: true,
      render: (_v: unknown, row: Record<string, unknown>) => {
        const leads = row.totalLeads as number;
        const spend = row.totalSpend as number;
        return leads > 0 ? `€${(spend / (leads * 0.6)).toFixed(1)}` : "—";
      },
    },
    {
      key: "costPerResult",
      label: "CP Result",
      align: "right" as const,
      sortable: true,
      render: (_v: unknown, row: Record<string, unknown>) => {
        const leads = row.totalLeads as number;
        const spend = row.totalSpend as number;
        return leads > 0 ? `€${(spend / (leads * 0.6 * 0.58)).toFixed(1)}` : "—";
      },
    },
    {
      key: "ctr",
      label: "CTR",
      align: "right" as const,
      sortable: true,
      render: (v: unknown) => `${(v as number).toFixed(1)}%`,
    },
    {
      key: "cpm",
      label: "CPM",
      align: "right" as const,
      render: (v: unknown) => `€${(v as number).toFixed(1)}`,
    },
    {
      key: "frequency",
      label: "Freq",
      align: "right" as const,
      render: (v: unknown) => (v as number).toFixed(1),
    },
  ];

  /* ---- CPL chart data ---- */
  const metaCplChartData = useMemo(
    () =>
      [...metaCampaigns]
        .sort((a, b) => a.cpl - b.cpl)
        .map((c) => {
          const status = getFatigueStatus(c.frequency, c.ctr, c.peakCtr);
          return {
            name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
            cpl: parseFloat(c.cpl.toFixed(2)),
            fullName: c.campaign,
            barColor: status.barColor,
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
          return {
            name: c.campaign.length > 25 ? c.campaign.slice(0, 22) + "..." : c.campaign,
            cpl: parseFloat(c.cpl.toFixed(2)),
            fullName: c.campaign,
            barColor: status.barColor,
          };
        }),
    [googleCampaigns]
  );

  /* ---- Profitability matrix ---- */
  const profitabilityData = useMemo(() => {
    const allCampaigns = [...metaCampaigns, ...googleCampaigns];
    if (!allCampaigns.length) return [];
    const SHOW_RATE = 0.6;
    const BOOKING_RATE = 0.58;

    return allCampaigns
      .map((c) => {
        const attributedRevenue = c.attributedRevenue;
        const roas = c.totalSpend > 0 ? attributedRevenue / c.totalSpend : 0;
        const profit = attributedRevenue - c.totalSpend;
        const costPerShow =
          c.totalLeads > 0 ? c.totalSpend / (c.totalLeads * SHOW_RATE) : 0;
        const costPerResult =
          c.totalLeads > 0
            ? c.totalSpend / (c.totalLeads * SHOW_RATE * BOOKING_RATE)
            : 0;
        const netExpectedRevenue = Math.round(attributedRevenue * 1.15);
        const recommendation =
          roas >= 5 ? "Scale" : roas >= 3 ? "Maintain" : roas >= 2 ? "Optimize" : "Pause";

        // Determine channel from which array the campaign came from
        const isMeta = metaCampaigns.some((mc) => mc.campaignId === c.campaignId);
        return {
          campaign: c.campaign,
          channel: isMeta ? "Meta" : "Google",
          totalLeads: c.totalLeads,
          totalSpend: c.totalSpend,
          cpl: c.cpl,
          costPerShow,
          costPerResult,
          attributedRevenue,
          netExpectedRevenue,
          roas,
          profit,
          recommendation,
        };
      })
      .sort((a, b) => b.profit - a.profit);
  }, [metaCampaigns, googleCampaigns]);

  /* ---- Email data (Klaviyo API) ---- */
  const { overview: klaviyo, loading: klaviyoLoading } = useKlaviyoData({
    brand: "aesthetics",
    dateFrom,
    dateTo,
  });

  /* ---- Loading state ---- */
  if (isLoading) {
    return (
      <>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">
            Aesthetics Marketing Dashboard
          </h1>
          <p className="text-sm text-text-secondary mt-1">Loading data…</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="rounded-lg border bg-white p-6 animate-pulse h-48" />
        <div className="rounded-lg border bg-white p-6 animate-pulse h-48" />
      </>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">
          Aesthetics Marketing Dashboard
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {formatDateRangeLabel(dateFrom, dateTo)} · Carisma Aesthetics — consult-driven
          performance
        </p>
      </div>

      {/* API status banners */}
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

      {/* Ad Fatigue Alert Banner */}
      {(totalFatigued > 0 || totalWatch > 0) && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-center justify-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-semibold text-red-700">
            Creative Fatigue Alert: {totalFatigued + totalWatch} campaigns need attention
          </span>
        </div>
      )}

      {/* Section 1: Hero KPIs */}
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
        const conversionRate = totalLeads > 0 ? ((totalLeads * 0.60 * 0.58) / totalLeads * 100) : 0;

        const heroKpis = [
          { label: "Revenue", value: formatCurrency(totalRevenue) },
          { label: "Total Marketing Spend", value: formatCurrency(totalSpend) },
          { label: "Meta Blended CPL", value: `€${metaBlendedCpl.toFixed(1)}` },
          { label: "Google Blended CPL", value: `€${googleBlendedCpl.toFixed(1)}` },
          { label: "Total Leads", value: String(totalLeads) },
          { label: "Conversion / Leads", value: `${conversionRate.toFixed(1)}%` },
          { label: "Blended ROAS", value: totalSpend > 0 ? `${(totalRevenue / totalSpend).toFixed(1)}x` : "—" },
        ];

        if (totalSpend === 0 && totalLeads === 0) {
          return (
            <Card className="p-6 text-center text-gray-500">
              No marketing data available for the selected date range.
            </Card>
          );
        }

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {heroKpis.map((kpi) => (
              <Card key={kpi.label} className="p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</p>
                <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
              </Card>
            ))}
          </div>
        );
      })()}

      {/* Consultation Funnel KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Total Leads
          </p>
          <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">
            {metaCampaigns.reduce((s, c) => s + c.totalLeads, 0) + googleCampaigns.reduce((s, c) => s + c.totalLeads, 0)}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Total Consultations
          </p>
          <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">
            {Math.round((metaCampaigns.reduce((s, c) => s + c.totalLeads, 0) + googleCampaigns.reduce((s, c) => s + c.totalLeads, 0)) * 0.60)}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Total Bookings
          </p>
          <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">
            {Math.round((metaCampaigns.reduce((s, c) => s + c.totalLeads, 0) + googleCampaigns.reduce((s, c) => s + c.totalLeads, 0)) * 0.60 * 0.58)}
          </p>
        </Card>
      </div>

      {/* Section 2: Meta Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Meta Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Meta ROAS</p>
            <p className="text-xl font-bold" style={{ color: BRAND_COLOR }}>
              {metaAggregate ? `${metaAggregate.roas.toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {metaCampaigns.length > 0 ? (
          <>
            {/* Fatigue summary counts */}
            <div className="flex items-center gap-4 mb-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {metaFatigue.healthy} Healthy
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {metaFatigue.watch} Watch
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {metaFatigue.fatigued} Fatigued
              </span>
            </div>

            {/* CPL by Campaign */}
            {metaCplChartData.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  CPL by Campaign (Best to Worst)
                </h3>
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
                          <Cell key={i} fill={entry.barColor} />
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
              </div>
            )}

            {/* Campaign Table */}
            <DataTable
              columns={campaignColumns}
              data={metaCampaigns as unknown as Record<string, unknown>[]}
            />
          </>
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 mb-4">
            No Meta Ads data available for the selected date range.
          </div>
        )}

        {/* Channel Aggregate Metrics */}
        {metaAggregate && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <AggregateBox
              label="Expected Revenue in Meta"
              value={formatCurrency(Math.round(metaAggregate.totalRevenue * 1.15))}
            />
            <AggregateBox
              label="Expected Ad Spend"
              value={formatCurrency(metaAggregate.totalSpend)}
            />
            <div
              className="rounded-lg border-2 p-4 text-center"
              style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
            >
              <p className="text-sm text-gray-600">Expected ROAS</p>
              <p
                className={`text-xl md:text-2xl font-bold mt-1 ${roasColor(metaAggregate.roas)}`}
              >
                {metaAggregate.roas.toFixed(1)}x
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Section 3: Google Ads */}
      <Card className="p-3 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Google Ads</h2>
          <div className="text-right">
            <p className="text-sm text-gray-500">Google ROAS</p>
            <p className="text-xl font-bold" style={{ color: BRAND_COLOR }}>
              {googleAggregate ? `${googleAggregate.roas.toFixed(1)}x` : "—"}
            </p>
          </div>
        </div>

        {googleCampaigns.length > 0 ? (
          <>
            {/* Fatigue summary counts */}
            <div className="flex items-center gap-4 mb-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {googleFatigue.healthy} Healthy
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {googleFatigue.watch} Watch
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                {googleFatigue.fatigued} Fatigued
              </span>
            </div>

            {/* CPL by Campaign */}
            {googleCplChartData.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  CPL by Campaign (Best to Worst)
                </h3>
                <div className="h-[150px] md:h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={googleCplChartData}
                      layout="vertical"
                      margin={{ top: 5, right: 50, left: 100, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(v: number) => `€${v}`} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11 }}
                        width={130}
                      />
                      <Tooltip formatter={(value) => `€${Number(value).toFixed(1)}`} />
                      <Bar dataKey="cpl" name="CPL" radius={[0, 4, 4, 0]}>
                        {googleCplChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.barColor} />
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
              </div>
            )}

            {/* Campaign Table */}
            <DataTable
              columns={campaignColumns}
              data={googleCampaigns as unknown as Record<string, unknown>[]}
            />

            {/* Channel Aggregate Metrics */}
            {googleAggregate && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <AggregateBox
                  label="Expected Revenue in Google"
                  value={formatCurrency(Math.round(googleAggregate.totalRevenue * 1.15))}
                />
                <AggregateBox
                  label="Expected Ad Spend"
                  value={formatCurrency(googleAggregate.totalSpend)}
                />
                <div
                  className="rounded-lg border-2 p-4 text-center"
                  style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
                >
                  <p className="text-sm text-gray-600">Expected ROAS</p>
                  <p
                    className={`text-xl md:text-2xl font-bold mt-1 ${roasColor(googleAggregate.roas)}`}
                  >
                    {googleAggregate.roas.toFixed(1)}x
                  </p>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
            No Google Ads data available for the selected date range.
          </div>
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
              <Card className="p-3 md:p-5 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Campaign Revenue
                </p>
                <p className="text-3xl font-bold text-gray-400 mt-2">&mdash;</p>
                <p className="text-xs text-gray-400 mt-1">Not tracked</p>
              </Card>
              <Card className="p-3 md:p-5 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Flow Revenue
                </p>
                <p className="text-3xl font-bold text-gray-400 mt-2">&mdash;</p>
                <p className="text-xs text-gray-400 mt-1">Not tracked</p>
              </Card>
            </div>

            {/* Middle: Key Rates as Progress Bars */}
            <div className="space-y-4 mb-6">
              <EmailRateBar label="Open Rate" value={parseFloat((klaviyo.overallOpenRate * 100).toFixed(1))} max={100} />
              <EmailRateBar label="Click Rate" value={parseFloat((klaviyo.overallClickRate * 100).toFixed(1))} max={10} />
              <EmailRateBar label="Unsubscribe Rate" value={parseFloat((klaviyo.overallUnsubscribeRate * 100).toFixed(1))} max={2} />
            </div>

            {/* Bottom: Summary Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Email ROAS
                </p>
                <p className="text-xl md:text-2xl font-bold text-gray-400 mt-1">&mdash;</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Total Subscribers
                </p>
                <p className="text-xl md:text-2xl font-bold text-gray-900 mt-1">{klaviyo.totalSubscribers.toLocaleString()}</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Pop-up Capture Rate
                </p>
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
          <p className="text-sm text-gray-500 mt-1">
            Cross-channel campaign profitability with budget scaling recommendations
          </p>
        </div>

        {profitabilityData.length > 0 ? (
          (() => {
            const totalLeads = profitabilityData.reduce((s, c) => s + c.totalLeads, 0);
            const totalSpend = profitabilityData.reduce((s, c) => s + c.totalSpend, 0);
            const totalRevenue = profitabilityData.reduce((s, c) => s + c.attributedRevenue, 0);
            const totalProfit = totalRevenue - totalSpend;
            const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
            const totalNetExpected = profitabilityData.reduce(
              (s, c) => s + c.netExpectedRevenue,
              0
            );

            const recBadge = (rec: string) => {
              const styles: Record<string, string> = {
                Scale: "bg-green-100 text-green-700",
                Maintain: "bg-blue-100 text-blue-700",
                Optimize: "bg-amber-100 text-amber-700",
                Pause: "bg-red-100 text-red-700",
              };
              return (
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${styles[rec] ?? ""}`}
                >
                  {rec}
                </span>
              );
            };

            const profitabilityColumns = [
              {
                key: "campaign",
                label: "Campaign",
                render: (v: unknown) => (
                  <span
                    className="font-medium cursor-pointer hover:underline"
                    style={{ color: BRAND_COLOR }}
                  >
                    {String(v)}
                  </span>
                ),
              },
              { key: "channel", label: "Channel" },
              { key: "totalLeads", label: "Leads", align: "right" as const, sortable: true },
              {
                key: "totalSpend",
                label: "Spend",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => formatCurrency(v as number),
              },
              {
                key: "cpl",
                label: "CPL",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => `€${(v as number).toFixed(1)}`,
              },
              {
                key: "costPerShow",
                label: "CP Show",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => `€${(v as number).toFixed(1)}`,
              },
              {
                key: "costPerResult",
                label: "CP Result",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => `€${(v as number).toFixed(1)}`,
              },
              {
                key: "attributedRevenue",
                label: "Revenue",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => formatCurrency(v as number),
              },
              {
                key: "netExpectedRevenue",
                label: "Net Exp Rev",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => formatCurrency(v as number),
              },
              {
                key: "roas",
                label: "ROAS",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => (
                  <span className={roasColor(v as number)}>{(v as number).toFixed(1)}x</span>
                ),
              },
              {
                key: "profit",
                label: "Profit",
                align: "right" as const,
                sortable: true,
                render: (v: unknown) => (
                  <span
                    className={
                      (v as number) >= 0
                        ? "text-green-600 font-semibold"
                        : "text-red-600 font-semibold"
                    }
                  >
                    {formatCurrency(v as number)}
                  </span>
                ),
              },
              {
                key: "recommendation",
                label: "Action",
                align: "center" as const,
                render: (v: unknown) => recBadge(String(v)),
              },
            ];

            return (
              <>
                <DataTable
                  columns={profitabilityColumns}
                  data={profitabilityData as unknown as Record<string, unknown>[]}
                  pageSize={20}
                />

                {/* Summary totals */}
                <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4">
                  <AggregateBox label="Total Leads" value={String(totalLeads)} />
                  <AggregateBox label="Total Spend" value={formatCurrency(totalSpend)} />
                  <AggregateBox label="Total Revenue" value={formatCurrency(totalRevenue)} />
                  <AggregateBox
                    label="Net Expected Rev"
                    value={formatCurrency(totalNetExpected)}
                  />
                  <div
                    className="rounded-lg border-2 p-4 text-center"
                    style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
                  >
                    <p className="text-sm text-gray-600">Blended ROAS</p>
                    <p
                      className={`text-xl md:text-2xl font-bold mt-1 ${roasColor(blendedRoas)}`}
                    >
                      {blendedRoas.toFixed(1)}x
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex justify-center">
                  <div
                    className="rounded-lg border-2 px-8 py-4 text-center"
                    style={{ borderColor: BRAND_COLOR, backgroundColor: `${BRAND_COLOR}10` }}
                  >
                    <p className="text-sm text-gray-600">Total Profit</p>
                    <p
                      className={`text-2xl md:text-3xl font-bold mt-1 ${
                        totalProfit >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(totalProfit)}
                    </p>
                  </div>
                </div>
              </>
            );
          })()
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            No campaign data available for profitability analysis.
          </div>
        )}
      </Card>

      {/* Section 6: CIChat */}
      <CIChat />
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
