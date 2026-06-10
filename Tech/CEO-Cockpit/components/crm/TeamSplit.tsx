"use client";

import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useGhlFunnel } from "@/lib/hooks/useGhlFunnel";
import { formatCurrency, formatPercent } from "@/lib/charts/config";
import type { CrmByRepRow } from "@/lib/types/crm";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadge(
  value: number,
  good: boolean,
  label: string,
): React.ReactNode {
  const color = good
    ? "bg-emerald-100 text-emerald-800"
    : "bg-red-100 text-red-800";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${color}`}
    >
      {label}
    </span>
  );
}

interface TeamMetrics {
  sales: number;
  activity: number;
  activityLabel: string;
  bookings: number;
  conversionRate: number;
  conversionCount: number;
  depositPct: number;
  depositCount: number;
  missedPct: number;
  missedCount: number;
}

function aggregateTeam(
  rows: CrmByRepRow[],
  activityKey: "dials" | "conversations",
): TeamMetrics {
  let sales = 0;
  let activity = 0;
  let bookings = 0;
  let convSum = 0;
  let convCount = 0;
  let depSum = 0;
  let depCount = 0;
  let missedSum = 0;
  let missedCount = 0;

  for (const r of rows) {
    sales += r.total_sales ?? 0;
    activity += (r[activityKey] as number) ?? 0;
    bookings += r.bookings ?? 0;
    if (r.conversion_rate_pct !== null) {
      convSum += r.conversion_rate_pct;
      convCount++;
    }
    if (r.deposit_pct !== null) {
      depSum += r.deposit_pct;
      depCount++;
    }
    if (r.missed_pct !== null) {
      missedSum += r.missed_pct;
      missedCount++;
    }
  }

  return {
    sales,
    activity,
    activityLabel: activityKey === "dials" ? "Dials" : "Conversations",
    bookings,
    conversionRate: convCount > 0 ? convSum / convCount : 0,
    conversionCount: convCount,
    depositPct: depCount > 0 ? depSum / depCount : 0,
    depositCount: depCount,
    missedPct: missedCount > 0 ? missedSum / missedCount : 0,
    missedCount: missedCount,
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TeamSplit({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { data, loading } = useKPIData<CrmByRepRow>({
    table: "crm_by_rep",
    dateFrom,
    dateTo,
    brandFilter,
  });

  // Brand-level GHL Lead Conv — same calculation as the Pipeline Funnel widget.
  // Replaces the per-agent booking_eff_pct average we used to show: this is the
  // honest lead → booked-appointment rate from the GHL pipeline mirror.
  const { data: ghl } = useGhlFunnel(dateFrom, dateTo, "cohort");
  const brandLeadConv = (() => {
    if (!ghl?.brands) return null;
    const slugs = brandFilter ? [brandFilter] : ["spa", "aesthetics", "slimming"];
    let won = 0, total = 0;
    for (const slug of slugs) {
      const stages = ghl.brands[slug] ?? {};
      for (const [stage, n] of Object.entries(stages)) {
        total += n;
        if (stage === "Booking Won") won += n;
      }
    }
    return total > 0 ? (won / total) * 100 : null;
  })();

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-56 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const sdrRows = data.filter((r) => r.team_type === "sdr");
  const chatRows = data.filter((r) => r.team_type === "chat");

  const sdr = aggregateTeam(sdrRows, "dials");
  const chat = aggregateTeam(chatRows, "conversations");

  const teams = [
    { title: "SDR - Phone", metrics: sdr },
    { title: "CRM - Chat", metrics: chat },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {teams.map((team) => (
        <Card key={team.title} className="p-6">
          <h3 className="text-base font-semibold text-foreground mb-4">
            {team.title}
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">Sales</span>
              <span className="text-sm font-bold text-foreground">
                {formatCurrency(team.metrics.sales)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">
                {team.metrics.activityLabel}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {team.metrics.activity.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">Bookings</span>
              <span className="text-sm font-semibold text-foreground">
                {team.metrics.bookings.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">Lead Conv. Rate</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {brandLeadConv !== null ? formatPercent(brandLeadConv) : "—"}
                </span>
                {brandLeadConv !== null && statusBadge(
                  brandLeadConv,
                  brandLeadConv >= 15,
                  brandLeadConv >= 15 ? "On Track" : "Below",
                )}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">Deposit %</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {formatPercent(team.metrics.depositPct)}
                </span>
                {statusBadge(
                  team.metrics.depositPct,
                  team.metrics.depositPct >= 70,
                  team.metrics.depositPct >= 70 ? "On Track" : "Below",
                )}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-secondary">Missed %</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {formatPercent(team.metrics.missedPct)}
                </span>
                {statusBadge(
                  team.metrics.missedPct,
                  team.metrics.missedPct <= 12,
                  team.metrics.missedPct <= 12 ? "On Track" : "High",
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
