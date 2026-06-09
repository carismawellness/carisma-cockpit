"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/charts/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SummaryData {
  groupRevenue: number;
  groupEbitda:  number;
  spaRevenue:   number;
  spaEbitda:    number;
  aesRevenue:   number;
  aesEbitda:    number;
  slimRevenue:  number;
  slimEbitda:   number;
  periodLabel:  string;
}

export interface EbitdaSummaryHeaderProps {
  data:    SummaryData | null;
  loading: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeMargin(ebitda: number, revenue: number): number {
  if (!revenue) return 0;
  return (ebitda / revenue) * 100;
}

function ebitdaCardBg(margin: number): string {
  if (margin >= 20) return "bg-emerald-50 border border-emerald-200";
  if (margin >= 10) return "bg-amber-50 border border-amber-200";
  return "bg-red-50 border border-red-200";
}

function statusDot(margin: number): string {
  if (margin >= 20) return "bg-emerald-500";
  if (margin >= 10) return "bg-amber-400";
  return "bg-red-500";
}

function statusLabel(margin: number): string {
  if (margin >= 20) return "On Track";
  if (margin >= 10) return "Watch";
  return "Critical";
}

function ebitdaValueColor(ebitda: number): string {
  return ebitda >= 0 ? "text-emerald-700" : "text-red-600";
}

function marginColor(margin: number): string {
  if (margin >= 20) return "text-emerald-700";
  if (margin >= 10) return "text-amber-600";
  return "text-red-600";
}

// ── Skeleton placeholder ──────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-200 ${className ?? ""}`} />
  );
}

// ── Brand mini-card ───────────────────────────────────────────────────────────

interface BrandCardProps {
  name:     string;
  revenue:  number;
  ebitda:   number;
  border:   string;
  loading:  boolean;
}

function BrandCard({ name, revenue, ebitda, border, loading }: BrandCardProps) {
  const margin = safeMargin(ebitda, revenue);

  return (
    <div className={`flex-1 min-w-0 bg-card rounded-lg border border-border p-3 ${border}`}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-12 ml-auto" />
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-foreground mb-2">{name}</p>
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Revenue</span>
            <span className="tabular-nums font-medium">{formatCurrency(revenue)}</span>
          </div>
          <div className="flex justify-between items-center text-xs mt-0.5">
            <span className="text-muted-foreground">EBITDA</span>
            <span className={`tabular-nums font-medium ${ebitdaValueColor(ebitda)}`}>
              {formatCurrency(ebitda)}
            </span>
          </div>
          <div className="flex justify-between items-center text-xs mt-0.5">
            <span className="text-muted-foreground">Margin</span>
            <span className={`tabular-nums font-semibold ${marginColor(margin)}`}>
              {margin.toFixed(1)}%
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EbitdaSummaryHeader({ data, loading }: EbitdaSummaryHeaderProps) {
  const d: SummaryData = data ?? {
    groupRevenue: 0,
    groupEbitda:  0,
    spaRevenue:   0,
    spaEbitda:    0,
    aesRevenue:   0,
    aesEbitda:    0,
    slimRevenue:  0,
    slimEbitda:   0,
    periodLabel:  "",
  };

  const groupMargin = safeMargin(d.groupEbitda, d.groupRevenue);
  const ebitdaBg    = ebitdaCardBg(groupMargin);
  const periodLabel = d.periodLabel || "period";

  // Revenue trend icon — neutral when no data, trending up when positive ebitda
  const RevIcon = loading || !data
    ? Minus
    : d.groupEbitda >= 0
      ? TrendingUp
      : TrendingDown;

  return (
    <div className="space-y-3">
      {/* Row 1 — Two large KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Card 1 — Group Net Revenue */}
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-3 w-48 mt-1" />
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700/70 mb-1">
                Group Net Revenue
              </p>
              <p className="text-3xl font-bold text-emerald-900 tabular-nums leading-none mb-2">
                {formatCurrency(d.groupRevenue)}
              </p>
              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-800 mb-3">
                <RevIcon className="h-3 w-3 shrink-0" />
                {periodLabel}
              </div>
              <p className="text-xs text-emerald-700/60 tabular-nums">
                Spa {formatCurrency(d.spaRevenue)}
                {"  "}
                Aes {formatCurrency(d.aesRevenue)}
                {"  "}
                Slim {formatCurrency(d.slimRevenue)}
              </p>
            </>
          )}
        </div>

        {/* Card 2 — Group EBITDA */}
        <div className={`rounded-xl p-4 ${loading ? "bg-gray-50 border border-gray-200" : ebitdaBg}`}>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-3 w-44" />
              <div className="flex items-baseline gap-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                Group EBITDA ({periodLabel})
              </p>
              <div className="flex items-baseline gap-2 mb-2">
                <span className={`text-3xl font-bold tabular-nums leading-none ${ebitdaValueColor(d.groupEbitda)}`}>
                  {formatCurrency(d.groupEbitda)}
                </span>
                <span className={`text-sm font-semibold tabular-nums ${marginColor(groupMargin)}`}>
                  {groupMargin.toFixed(1)}% margin
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot(groupMargin)}`} />
                <span>{statusLabel(groupMargin)}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-400">Target 30%</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2 — Brand mini-cards */}
      <div className="flex gap-3">
        <BrandCard
          name="Spa"
          revenue={d.spaRevenue}
          ebitda={d.spaEbitda}
          border="border-l-4 border-l-emerald-500"
          loading={loading}
        />
        <BrandCard
          name="Aesthetics"
          revenue={d.aesRevenue}
          ebitda={d.aesEbitda}
          border="border-l-4 border-l-purple-500"
          loading={loading}
        />
        <BrandCard
          name="Slimming"
          revenue={d.slimRevenue}
          ebitda={d.slimEbitda}
          border="border-l-4 border-l-amber-500"
          loading={loading}
        />
      </div>
    </div>
  );
}
