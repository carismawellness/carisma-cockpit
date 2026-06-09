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
import {
  weekLabelsToDateObjects,
  getFilteredIndices,
  sumFiltered,
  formatDateRangeLabel,
} from "@/lib/utils/mock-date-filter";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  Star,
} from "lucide-react";
import { ReconBadge } from "@/components/dashboard/ReconBadge";

/* ------------------------------------------------------------------ */
/*  MOCK DATA                                                          */
/* ------------------------------------------------------------------ */

const MOCK_WEEKS = [
  "05-Jan", "12-Jan", "19-Jan", "26-Jan",
  "02-Feb", "09-Feb", "16-Feb", "23-Feb",
  "02-Mar", "09-Mar", "16-Mar", "23-Mar",
  "30-Mar", "06-Apr", "13-Apr", "20-Apr",
];

const MOCK_SPA_REVENUE = [
  94998, 60568, 49599, 55589, 63111, 70994, 89422, 80348,
  78251, 72287, 82943, 84696, 79120, 86340, 91205, 77480,
];
const MOCK_AES_REVENUE = [
  9356, 26242, 0, 50, 16704, 13171, 6435, 466,
  16972, 17258, 2450, 0, 14830, 18420, 11760, 15390,
];
const MOCK_SLIM_REVENUE = [
  0, 0, 0, 0, 0, 798, 3803, 0,
  6502, 7418, 8957, 1894, 9240, 10560, 8730, 11200,
];

const MOCK_SPA_EBITDA = [
  35426, 17202, 8180, 12206, 14586, 19755, 32735, 27942,
  28095, 22141, 28555, 33552, 29840, 34120, 36480, 28960,
];
const MOCK_AES_EBITDA = [
  4420, 21150, -5231, -5951, 10541, 7271, 1056, -4591,
  11795, 12135, -2534, -5007, 9680, 14230, 7540, 10820,
];
const MOCK_SLIM_EBITDA = [
  0, 0, 0, 0, 0, 438, 3443, -1397,
  5373, 6348, 8084, 1029, 7860, 9120, 7240, 9650,
];

const CORPORATE_OVERHEAD = 3224;
const WEEK_DATES = weekLabelsToDateObjects(MOCK_WEEKS, 2026);

/* Weekly revenue trend for sparklines */
const MOCK_TOTAL_REVENUE_WEEKLY = MOCK_WEEKS.map(
  (_, i) => MOCK_SPA_REVENUE[i] + MOCK_AES_REVENUE[i] + MOCK_SLIM_REVENUE[i]
);
const MOCK_EBITDA_WEEKLY = MOCK_WEEKS.map(
  (_, i) =>
    MOCK_SPA_EBITDA[i] + MOCK_AES_EBITDA[i] + MOCK_SLIM_EBITDA[i] - CORPORATE_OVERHEAD
);

/* ------------------------------------------------------------------ */
/*  Status helper                                                      */
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
  /* ── Filter by date ────────────────────────────────────────────────── */
  const filteredIdx = useMemo(
    () => getFilteredIndices(WEEK_DATES, dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const totalRevenue = useMemo(
    () => sumFiltered(MOCK_TOTAL_REVENUE_WEEKLY, filteredIdx),
    [filteredIdx]
  );
  const spaRev = useMemo(() => sumFiltered(MOCK_SPA_REVENUE, filteredIdx), [filteredIdx]);
  const aesRev = useMemo(() => sumFiltered(MOCK_AES_REVENUE, filteredIdx), [filteredIdx]);
  const slimRev = useMemo(() => sumFiltered(MOCK_SLIM_REVENUE, filteredIdx), [filteredIdx]);

  const groupEbitda = useMemo(
    () => sumFiltered(MOCK_EBITDA_WEEKLY, filteredIdx),
    [filteredIdx]
  );
  const ebitdaMargin = totalRevenue > 0 ? (groupEbitda / totalRevenue) * 100 : 0;

  const revenueSparkData = useMemo(
    () => filteredIdx.map((i) => MOCK_TOTAL_REVENUE_WEEKLY[i]),
    [filteredIdx]
  );
  const ebitdaSparkData = useMemo(
    () => filteredIdx.map((i) => MOCK_EBITDA_WEEKLY[i]),
    [filteredIdx]
  );

  /* ── Mock KPI values (will be replaced with real data) ─────────── */
  const revPAH = 52;
  const conversionPct = 38.2;
  const blendedROAS = 4.1;
  const speedToLead = 3.2;
  const unrepliedMessages = 0;
  const humanCapitalPct = 41.0;
  const budgetVariance = -3.2;
  const googleRating = 4.7;
  const worstLocation = { name: "Sliema", rating: 4.4 };
  const turnoverRate = 12;

  /* ── Status calculations ──────────────────────────────────────── */
  const revenueStatus = getStatus(totalRevenue, 850000, 765000);
  const ebitdaStatus = getStatus(groupEbitda, 247000, 221000);
  const revPAHStatus = getStatus(revPAH, 45, 35);
  const conversionStatus = getStatus(conversionPct, 35, 25);
  const roasStatus = getStatus(blendedROAS, 3.5, 2.5);
  const stlStatus = getStatus(speedToLead, 5, 15, true);
  const unrepliedStatus: Status = unrepliedMessages === 0 ? "green" : unrepliedMessages <= 5 ? "amber" : "red";
  const hcStatus = humanCapitalPct >= 30 && humanCapitalPct <= 42 ? "green" : humanCapitalPct <= 48 ? "amber" : "red";
  const budgetStatus = getStatus(Math.abs(budgetVariance), 100, 100); // custom
  const budgetStatusCalc: Status = Math.abs(budgetVariance) <= 5 ? "green" : Math.abs(budgetVariance) <= 10 ? "amber" : "red";
  const ratingStatus = getStatus(googleRating, 4.6, 4.3);
  const turnoverStatus = getStatus(turnoverRate, 15, 25, true);

  const subtitle = useMemo(
    () => formatDateRangeLabel(dateFrom, dateTo),
    [dateFrom, dateTo]
  );

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
              {formatCurrency(totalRevenue)}
            </span>
            <div className="flex items-center gap-1 pb-1">
              <TrendIcon trend={3} />
              <span className="text-sm font-medium text-emerald-600">+8% YoY</span>
            </div>
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

        {/* Group EBITDA */}
        <Card className={`p-4 md:p-6 border-2 ${statusColor(ebitdaStatus)}`}>
          <div className="flex items-start justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Group EBITDA (Trailing)
            </p>
            <a href="/finance" className="text-muted-foreground hover:text-foreground">
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <span className="text-3xl md:text-4xl font-bold text-foreground">
              {formatCurrency(groupEbitda)}
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
          {/* RevPAH */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Revenue Per Available Hour</p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {formatCurrency(revPAH)}
                  </span>
                  <div className="flex items-center gap-1 pb-0.5">
                    <TrendIcon trend={3.1} />
                    <span className="text-xs text-emerald-600">+3.1%</span>
                  </div>
                </div>
              </div>
              <span className={`inline-block h-3 w-3 rounded-full ${statusDot(revPAHStatus)}`} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Combines utilization, pricing & staffing efficiency
            </p>
          </Card>

          {/* Conversion Rate */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Consultation Conversion</p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {formatPercent(conversionPct)}
                  </span>
                  <div className="flex items-center gap-1 pb-0.5">
                    <TrendIcon trend={-1.2} />
                    <span className="text-xs text-red-500">-1.2pp</span>
                  </div>
                </div>
              </div>
              <span className={`inline-block h-3 w-3 rounded-full ${statusDot(conversionStatus)}`} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Hinge between ad spend and revenue
            </p>
          </Card>

          {/* Blended ROAS */}
          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Blended ROAS</p>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-foreground">
                    {blendedROAS.toFixed(1)}x
                  </span>
                  <div className="flex items-center gap-1 pb-0.5">
                    <TrendIcon trend={0.3} />
                    <span className="text-xs text-emerald-600">+0.3</span>
                  </div>
                </div>
              </div>
              <span className={`inline-block h-3 w-3 rounded-full ${statusDot(roasStatus)}`} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              EUR return for every EUR spent on ads
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
          {/* Speed to Lead */}
          <Card className={`p-3 md:p-4 border ${stlStatus !== "green" ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Speed to Lead</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{speedToLead.toFixed(1)} min</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(stlStatus)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Target: &lt;5 min</p>
          </Card>

          {/* Unreplied Messages */}
          <Card className={`p-3 md:p-4 border ${unrepliedStatus !== "green" ? "border-red-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Unreplied Messages</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{unrepliedMessages}</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(unrepliedStatus)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {unrepliedMessages === 0 ? "All clear" : "Leads waiting"}
            </p>
          </Card>

          {/* Human Capital % */}
          <Card className={`p-3 md:p-4 border ${hcStatus !== "green" ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Human Capital %</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{formatPercent(humanCapitalPct)}</span>
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(hcStatus)}`} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Staff cost / revenue</p>
          </Card>

          {/* Budget vs Actual */}
          <Card className={`p-3 md:p-4 border ${budgetStatusCalc !== "green" ? "border-amber-300" : "border-border"}`}>
            <p className="text-[11px] text-muted-foreground mb-1">Budget Variance</p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-foreground">{budgetVariance > 0 ? "+" : ""}{budgetVariance.toFixed(1)}%</span>
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
          {/* Google Rating */}
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

          {/* Turnover Rate */}
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

      {/* Alerts & CI Chat */}
      <AlertFeed />
      <CIChat />
    </>
  );
}
