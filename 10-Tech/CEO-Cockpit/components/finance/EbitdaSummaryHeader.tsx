"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/charts/config";

const VAT_RATE = 0.18;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SppyData {
  groupRevenue: number;
  groupEbitda:  number;
  spaRevenue:   number;
  spaEbitda:    number;
  aesRevenue:   number;
  aesEbitda:    number;
  slimRevenue:  number;
  slimEbitda:   number;
}

export interface SummaryData {
  groupRevenue:    number;
  groupEbitda:     number;
  spaRevenue:      number;
  spaEbitda:       number;
  spaCockpitRevenue: number;  // pure daily Cockpit sales (no monthly adjustments)
  aesRevenue:      number;
  aesEbitda:       number;
  slimRevenue:     number;
  slimEbitda:      number;
  periodLabel:     string;
  sppy?:           SppyData | null;
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

function yoyDelta(current: number, prior: number): { pct: number; positive: boolean } | null {
  if (!prior) return null;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  return { pct, positive: pct >= 0 };
}

function YoyBadge({ current, prior, label }: { current: number; prior: number; label?: string }) {
  const delta = yoyDelta(current, prior);
  if (!delta) return null;
  const arrow = delta.positive ? "↑" : "↓";
  const cls   = delta.positive ? "text-emerald-700" : "text-red-600";
  return (
    <span className={`text-[11px] font-medium tabular-nums ${cls}`}>
      {arrow} {Math.abs(delta.pct).toFixed(1)}% vs LY
      {label ? ` · LY ${label}` : ""}
    </span>
  );
}

function fmtC(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `€${(v / 1_000).toFixed(1)}K`;
  return `€${v.toFixed(0)}`;
}

// ── Skeleton placeholder ──────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-200 ${className ?? ""}`} />
  );
}

// ── YoY delta chip ────────────────────────────────────────────────────────────

function DeltaChip({ current, prior }: { current: number; prior: number }) {
  const delta = yoyDelta(current, prior);
  if (!delta) return null;
  const cls   = delta.positive ? "text-emerald-600" : "text-red-500";
  const arrow = delta.positive ? "↑" : "↓";
  return (
    <span className={`text-[10px] font-medium tabular-nums ${cls}`}>
      {arrow}{Math.abs(delta.pct).toFixed(1)}%
    </span>
  );
}

// ── Brand mini-card ───────────────────────────────────────────────────────────

interface BrandCardProps {
  name:         string;
  revenue:      number;
  ebitda:       number;
  border:       string;
  loading:      boolean;
  sppyRevenue?: number | null;
  sppyEbitda?:  number | null;
}

function BrandCard({ name, revenue, ebitda, border, loading, sppyRevenue, sppyEbitda }: BrandCardProps) {
  const margin     = safeMargin(ebitda, revenue);
  const sppyMargin = (sppyRevenue && sppyEbitda != null) ? safeMargin(sppyEbitda, sppyRevenue) : null;
  const incVat     = revenue * (1 + VAT_RATE);

  return (
    <div className={`flex-1 min-w-0 bg-card rounded-lg border border-border p-3 ${border}`}>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-3 w-16 ml-auto" />
          <Skeleton className="h-4 w-16 ml-auto" />
          <Skeleton className="h-4 w-12 ml-auto" />
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-foreground mb-2">{name}</p>

          {/* Revenue ex-VAT */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-muted-foreground">Revenue ex-VAT</span>
            <span className="flex items-center gap-1.5 tabular-nums font-medium">
              {sppyRevenue != null && <DeltaChip current={revenue} prior={sppyRevenue} />}
              {formatCurrency(revenue)}
            </span>
          </div>
          {sppyRevenue != null && (
            <div className="flex justify-end text-[10px] text-muted-foreground/60 tabular-nums -mt-0.5 mb-0.5">
              LY {formatCurrency(sppyRevenue)}
            </div>
          )}

          {/* Revenue inc-VAT */}
          <div className="flex justify-between items-center text-xs mt-0.5">
            <span className="text-muted-foreground">Revenue inc-VAT</span>
            <span className="tabular-nums font-medium text-foreground/70">
              {fmtC(incVat)}
            </span>
          </div>

          {/* EBITDA */}
          <div className="flex justify-between items-center text-xs mt-1.5 pt-1.5 border-t border-dashed border-border/50">
            <span className="text-muted-foreground">EBITDA</span>
            <span className={`flex items-center gap-1.5 tabular-nums font-medium ${ebitdaValueColor(ebitda)}`}>
              {sppyEbitda != null && <DeltaChip current={ebitda} prior={sppyEbitda} />}
              {formatCurrency(ebitda)}
            </span>
          </div>
          {sppyEbitda != null && (
            <div className="flex justify-end text-[10px] text-muted-foreground/60 tabular-nums -mt-0.5 mb-0.5">
              LY {formatCurrency(sppyEbitda)}
            </div>
          )}

          {/* Margin */}
          <div className="flex justify-between items-center text-xs mt-0.5">
            <span className="text-muted-foreground">Margin</span>
            <span className={`flex items-center gap-1.5 tabular-nums font-semibold ${marginColor(margin)}`}>
              {sppyMargin != null && <DeltaChip current={margin} prior={sppyMargin} />}
              {margin.toFixed(1)}%
            </span>
          </div>
          {sppyMargin != null && (
            <div className="flex justify-end text-[10px] text-muted-foreground/60 tabular-nums -mt-0.5">
              LY {sppyMargin.toFixed(1)}%
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function EbitdaSummaryHeader({ data, loading }: EbitdaSummaryHeaderProps) {
  const d: SummaryData = data ?? {
    groupRevenue:    0,
    groupEbitda:     0,
    spaRevenue:      0,
    spaEbitda:       0,
    spaCockpitRevenue: 0,
    aesRevenue:      0,
    aesEbitda:       0,
    slimRevenue:     0,
    slimEbitda:      0,
    periodLabel:     "",
  };

  const groupMargin  = safeMargin(d.groupEbitda, d.groupRevenue);
  const ebitdaBg     = ebitdaCardBg(groupMargin);
  const periodLabel  = d.periodLabel || "period";
  const groupIncVat  = d.groupRevenue * (1 + VAT_RATE);

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
              <p className="text-3xl font-bold text-emerald-900 tabular-nums leading-none mb-0.5">
                {formatCurrency(d.groupRevenue)}
                <span className="text-sm font-normal text-emerald-700/60 ml-2">ex-VAT</span>
              </p>
              <p className="text-sm text-emerald-700/70 tabular-nums mb-2">
                {fmtC(groupIncVat)}
                <span className="text-xs font-normal ml-1.5">inc-VAT</span>
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
              {d.sppy && (
                <p className="mt-1">
                  <YoyBadge current={d.groupRevenue} prior={d.sppy.groupRevenue} label={formatCurrency(d.sppy.groupRevenue)} />
                </p>
              )}
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
              {d.sppy && (
                <p className="mt-1">
                  <YoyBadge current={d.groupEbitda} prior={d.sppy.groupEbitda} label={formatCurrency(d.sppy.groupEbitda)} />
                </p>
              )}
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
          sppyRevenue={d.sppy?.spaRevenue ?? null}
          sppyEbitda={d.sppy?.spaEbitda ?? null}
        />
        <BrandCard
          name="Aesthetics"
          revenue={d.aesRevenue}
          ebitda={d.aesEbitda}
          border="border-l-4 border-l-purple-500"
          loading={loading}
          sppyRevenue={d.sppy?.aesRevenue ?? null}
          sppyEbitda={d.sppy?.aesEbitda ?? null}
        />
        <BrandCard
          name="Slimming"
          revenue={d.slimRevenue}
          ebitda={d.slimEbitda}
          border="border-l-4 border-l-amber-500"
          loading={loading}
          sppyRevenue={d.sppy?.slimRevenue ?? null}
          sppyEbitda={d.sppy?.slimEbitda ?? null}
        />
      </div>

    </div>
  );
}
