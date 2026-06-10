"use client";

import { useMemo } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { AlertFeed } from "@/components/dashboard/AlertFeed";
import { CIChat } from "@/components/ci/CIChat";
import {
  chartColors,
  formatCurrency,
  formatPercent,
} from "@/lib/charts/config";
import { formatDateRangeLabel } from "@/lib/utils/mock-date-filter";
import { useCeoRevenue } from "@/lib/hooks/useCeoRevenue";
import { useFunnelMetrics } from "@/lib/hooks/useFunnelMetrics";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  Star,
} from "lucide-react";
import { ReconBadge } from "@/components/dashboard/ReconBadge";

/* ------------------------------------------------------------------ */
/*  Status helpers                                                      */
/* ------------------------------------------------------------------ */

type Status = "green" | "amber" | "red";

function statusColor(status: Status): string {
  return status === "green"
    ? "bg-emerald-50 border-emerald-200"
    : status === "amber"
      ? "bg-amber-50 border-amber-200"
      : "bg-red-50 border-red-200";
}

function statusDot(status: Status): string {
  return status === "green"
    ? "bg-emerald-500"
    : status === "amber"
      ? "bg-amber-500"
      : "bg-red-500";
}

function statusText(status: Status): string {
  return status === "green"
    ? "text-emerald-700"
    : status === "amber"
      ? "text-amber-700"
      : "text-red-700";
}

function TrendIcon({ trend }: { trend: number }) {
  if (trend > 0)
    return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (trend < 0)
    return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function getStatus(value: number, green: number, amber: number, inverse = false): Status {
  if (inverse) {
    if (value <= green) return "green";
    if (value <= amber) return "amber";
    return "red";
  }
  if (value >= green) return "green";
  if (value >= amber) return "amber";
  return "red";
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function CEOPage() {
  return (
    <DashboardShell>
      {({ dateFrom, dateTo, brandFilter }) => (
        <CEOContent dateFrom={dateFrom} dateTo={dateTo} brandFilter={brandFilter} />
      )}
    </DashboardShell>
  );
}

function CEOContent({
  dateFrom,
  dateTo,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { spaRev, aesRev, slimRev, totalRev, weeklyData, isLoading: revLoading } =
    useCeoRevenue(dateFrom, dateTo);

  const { byBrand, isLoading: crmLoading } = useFunnelMetrics(dateFrom, dateTo);

  const isLoading = revLoading || crmLoading;

  /* ── Derived KPIs from real CRM data ──────────────────────────────── */
  const totalUnreplied = useMemo(() => {
    return (
      (byBrand.spa?.unrepliedWhatsapp ?? 0) +
      (byBrand.aesthetics?.unrepliedWhatsapp ?? 0) +
      (byBrand.slimming?.unrepliedWhatsapp ?? 0)
    );
  }, [byBrand]);

  const blendedConversion = useMemo(() => {
    const totalLeads =
      (byBrand.spa?.totalLeads ?? 0) +
      (byBrand.aesthetics?.totalLeads ?? 0) +
      (byBrand.slimming?.totalLeads ?? 0);
    const totalBooked =
      (byBrand.spa?.totalBooked ?? 0) +
      (byBrand.aesthetics?.totalBooked ?? 0) +
      (byBrand.slimming?.totalBooked ?? 0);
    return totalLeads > 0 ? (totalBooked / totalLeads) * 100 : 0;
  }, [byBrand]);

  const blendedSTL = useMemo(() => {
    const stlValues = ["spa", "aesthetics", "slimming"]
      .map(b => byBrand[b]?.stlMedian ?? 0)
      .filter(v => v > 0);
    if (stlValues.length === 0) return 0;
    return Math.round((stlValues.reduce((s, v) => s + v, 0) / stlValues.length) * 10) / 10;
  }, [byBrand]);

  const blendedROAS = useMemo(() => {
    const totalSpend = ["spa", "aesthetics", "slimming"].reduce(
      (s, b) => s + (byBrand[b]?.metaSpend ?? 0), 0
    );
    const totalSales = totalRev;
    return totalSpend > 0 ? Math.round((totalSales / totalSpend) * 10) / 10 : 0;
  }, [byBrand, totalRev]);

  /* ── Sparkline data ────────────────────────────────────────────────── */
  const revenueSparkData = weeklyData.map(w => w.total);
  // Approximate EBITDA: ~35% margin on spa, ~55% on aes+slim (service margins)
  const ebitdaSparkData = weeklyData.map(w =>
    Math.round(w.spa * 0.35 + w.aes * 0.52 + w.slim * 0.48)
  );

  const approxEbitda = Math.round(spaRev * 0.35 + aesRev * 0.52 + slimRev * 0.48);
  const ebitdaMargin = totalRev > 0 ? (approxEbitda / totalRev) * 100 : 0;

  /* ── Status calculations ──────────────────────────────────────────── */
  const revenueStatus = getStatus(totalRev, 850000, 765000);
  const ebitdaStatus = getStatus(approxEbitda, 247000, 221000);
  const conversionStatus = getStatus(blendedConversion, 20, 10);
  const roasStatus = getStatus(blendedROAS, 3.5, 2.5);
  const stlStatus = getStatus(blendedSTL, 5, 15, true);
  const unrepliedStatus: Status =
    totalUnreplied === 0 ? "green" : totalUnreplied <= 10 ? "amber" : "red";

  /* ── Static indicators (no source yet) ───────────────────────────── */
  const googleRating = 4.7;
  const worstLocation = { name: "Sliema", rating: 4.4 };
  const turnoverRate = 12;
  const humanCapitalPct = 41.0;
  const budgetVariance = -3.2;
  const hcStatus = humanCapitalPct >= 30 && humanCapitalPct <= 42
    ? "green" : humanCapitalPct <= 48 ? "amber" : "red" as Status;
  const budgetStatusCalc: Status =
    Math.abs(budgetVariance) <= 5 ? "green" : Math.abs(budgetVariance) <= 10 ? "amber" : "red";
  const ratingStatus = getStatus(googleRating, 4.6, 4.3);
  const turnoverStatus = getStatus(turnoverRate, 15, 25, true);

  const subtitle = useMemo(() => formatDateRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-100 rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-40 bg-gray-100 rounded" />
          <div className="h-40 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Morning Pulse
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <ReconBadge dateFrom={dateFrom} dateTo={dateTo} />
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  SECTION 1: The Money Line                                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Group Net Revenue */}
        <Card className={`p-4 md:p-6 border-2 ${statusColor(revenueStatus)}`}>
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Group Net Revenue
            </p>
            <a href="/sales" className="text-muted-foreground hover:text-foreground">
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl md:text-4xl font-bold text-foreground">
              {formatCurrency(totalRev)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium" style={{ color: chartColors.spa }}>Spa</span>{" "}
              {formatCurrency(spaRev)}
            </span>
            <span>
              <span className="font-medium" style={{ color: chartColors.aesthetics }}>Aes</span>{" "}
              {formatCurrency(aesRev)}
            </span>
            <span>
              <span className="font-medium" style={{ color: chartColors.slimming }}>Slim</span>{" "}
              {formatCurrency(slimRev)}
            </span>
          </div>
          <div className="mt-3">
            <Sparkline data={revenueSparkData} width={200} height={32} color={chartColors.spa} />
          </div>
        </Card>

        {/* Group EBITDA (approximate) */}
        <Card className={`p-4 md:p-6 border-2 ${statusColor(ebitdaStatus)}`}>
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Group EBITDA (Est.)
            </p>
            <a href="/finance" className="text-muted-foreground hover:text-foreground">
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl md:text-4xl font-bold text-foreground">
              {formatCurrency(approxEbitda)}
            </span>
            <span className="text-sm text-muted-foreground pb-1">
              {formatPercent(ebitdaMargin)} margin
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDot(ebitdaStatus)}`} />
            <span className={statusText(ebitdaStatus)}>
              {ebitdaStatus === "green" ? "On track" : ebitdaStatus === "amber" ? "Below budget" : "Critical"}
            </span>
            <span className="text-muted-foreground ml-1">· see Finance for full P&L</span>
          </div>
          <div className="mt-3">
            <Sparkline data={ebitdaSparkData} width={200} height={32} color="#16a34a" />
          </div>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  SECTION 2: The Revenue Engine                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Revenue Engine
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Conversion Rate (real from CRM) */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Consultation Conversion</p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {blendedConversion > 0 ? formatPercent(blendedConversion) : "—"}
                  </span>
                </div>
              </div>
              <span className={`inline-block h-3 w-3 rounded-full ${blendedConversion > 0 ? statusDot(conversionStatus) : "bg-gray-300"}`} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Lead-to-booking across all brands
            </p>
          </Card>

          {/* Blended ROAS */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Blended ROAS</p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {blendedROAS > 0 ? `${blendedROAS.toFixed(1)}x` : "—"}
                  </span>
                </div>
              </div>
              <span className={`inline-block h-3 w-3 rounded-full ${blendedROAS > 0 ? statusDot(roasStatus) : "bg-gray-300"}`} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Revenue ÷ Meta ad spend
            </p>
          </Card>

          {/* Meta CPL across all brands */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Blended CPL (Meta)</p>
                <div className="flex items-end gap-2">
                  {(() => {
                    const totalSpend = ["spa", "aesthetics", "slimming"].reduce(
                      (s, b) => s + (byBrand[b]?.metaSpend ?? 0), 0
                    );
                    const totalMetaLeads = ["spa", "aesthetics", "slimming"].reduce(
                      (s, b) => s + (byBrand[b]?.metaLeads ?? 0), 0
                    );
                    const cpl = totalMetaLeads > 0 ? totalSpend / totalMetaLeads : 0;
                    return (
                      <span className="text-2xl font-bold text-foreground">
                        {cpl > 0 ? formatCurrency(cpl) : "—"}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <span className="inline-block h-3 w-3 rounded-full bg-gray-300" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Meta spend ÷ leads generated
            </p>
          </Card>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  SECTION 3: Early Warning System                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Early Warning System
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Speed to Lead (real) */}
          <Card className={`p-3 md:p-4 border ${stlStatus !== "green" && blendedSTL > 0 ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Speed to Lead</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">
                {blendedSTL > 0 ? `${blendedSTL.toFixed(1)} min` : "—"}
              </span>
              {blendedSTL > 0 && (
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(stlStatus)}`} />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Target: &lt;5 min</p>
          </Card>

          {/* Unreplied Messages (real) */}
          <Card className={`p-3 md:p-4 border ${unrepliedStatus !== "green" ? "border-red-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Unreplied WhatsApp</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{totalUnreplied}</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(unrepliedStatus)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {totalUnreplied === 0 ? "All clear" : "Leads waiting"}
            </p>
          </Card>

          {/* Human Capital % (static) */}
          <Card className={`p-3 md:p-4 border ${hcStatus !== "green" ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Human Capital %</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{formatPercent(humanCapitalPct)}</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(hcStatus as Status)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Staff cost / revenue</p>
          </Card>

          {/* Budget vs Actual (static) */}
          <Card className={`p-3 md:p-4 border ${budgetStatusCalc !== "green" ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Budget Variance</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">
                {budgetVariance > 0 ? "+" : ""}{budgetVariance.toFixed(1)}%
              </span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(budgetStatusCalc)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Group vs plan</p>
          </Card>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  SECTION 4: Brand & Reputation                                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Brand & Reputation
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Google Rating (Avg)</p>
                <div className="flex items-center gap-2">
                  <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
                  <span className="text-2xl font-bold text-foreground">{googleRating.toFixed(1)}</span>
                  <span className={`inline-block h-3 w-3 rounded-full ${statusDot(ratingStatus)}`} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Lowest location</p>
                <p className="text-sm font-medium text-foreground">
                  {worstLocation.name}{" "}
                  <span className={worstLocation.rating < 4.3 ? "text-red-500" : "text-amber-600"}>
                    {worstLocation.rating.toFixed(1)}
                  </span>
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Staff Turnover (Rolling 3M)</p>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-foreground">{formatPercent(turnoverRate)}</span>
                  <span className={`inline-block h-3 w-3 rounded-full ${statusDot(turnoverStatus)}`} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Annualized</p>
                <p className={`text-sm font-medium ${turnoverStatus === "green" ? "text-emerald-600" : "text-amber-600"}`}>
                  Healthy
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <AlertFeed />
      <CIChat />
    </>
  );
}
