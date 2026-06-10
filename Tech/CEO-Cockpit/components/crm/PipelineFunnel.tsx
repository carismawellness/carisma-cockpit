"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useGhlFunnel } from "@/lib/hooks/useGhlFunnel";

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

// Active pipeline stages shown in the funnel — ordered by count desc at render
const FUNNEL_STAGES = ["New Leads", "Call Back", "Contacted", "Booking Won", "Active Member"];

// Terminal / dormant stages shown in the outcomes strip
const OUTCOME_STAGES = ["Booking Lost", "No Show", "Nurturing"];

// Darker accents of the brand palette for legibility on the funnel bars
const BRAND_ACCENT: Record<string, string> = {
  spa:        "#C9A875",
  aesthetics: "#7BAFAF",
  slimming:   "#8DB37F",
};

export function PipelineFunnel({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { data, isLoading } = useGhlFunnel(dateFrom, dateTo);

  const brands = brandFilter ? [brandFilter] : ["spa", "aesthetics", "slimming"];
  const isSingleBrand = brands.length === 1;

  const stageRows = useMemo(() => {
    return FUNNEL_STAGES.map((stage) => {
      const segments = brands.map((b) => ({
        brand: b,
        value: data?.brands[b]?.[stage] ?? 0,
      }));
      const total = segments.reduce((s, v) => s + v.value, 0);
      return { stage, total, segments };
    });
  }, [data, brands]);

  const sortedStages = useMemo(
    () => stageRows.filter((s) => s.total > 0).sort((a, b) => b.total - a.total),
    [stageRows],
  );
  const maxTotal = sortedStages[0]?.total ?? 0;

  const outcomes = OUTCOME_STAGES.map((stage) => ({
    stage,
    total: brands.reduce((s, b) => s + (data?.brands[b]?.[stage] ?? 0), 0),
  }));

  const sumByStages = (stages: string[]) =>
    stages.reduce(
      (s, st) => s + brands.reduce((sb, b) => sb + (data?.brands[b]?.[st] ?? 0), 0),
      0,
    );

  const totalActive  = sumByStages(["New Leads", "Call Back", "Contacted"]);
  const totalWon     = sumByStages(["Booking Won"]);
  const totalLost    = sumByStages(["Booking Lost"]);
  const totalNoShow  = sumByStages(["No Show"]);
  const closeDen     = totalWon + totalLost + totalNoShow;
  const winRate      = closeDen > 0 ? ((totalWon / closeDen) * 100).toFixed(1) : "—";

  if (isLoading) {
    return <div className="h-[600px] rounded-xl bg-gray-100 animate-pulse" />;
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Pipeline Funnel</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Current snapshot · Call Pipeline · from GHL CRM
          </p>
        </div>
        <div className="flex gap-6 text-right shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {totalActive.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Booking Won</p>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">
              {totalWon.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {winRate === "—" ? "—" : `${winRate}%`}
            </p>
          </div>
        </div>
      </div>

      {/* Funnel bars, sorted large→small, centered */}
      <div className="space-y-4 py-2">
        {sortedStages.map(({ stage, total, segments }) => {
          const widthPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
          return (
            <div key={stage} className="flex items-center gap-4">
              <div className="w-36 shrink-0 text-right">
                <p className="text-sm font-semibold text-gray-700">{stage}</p>
              </div>
              <div className="flex-1 flex justify-center">
                <div
                  style={{ width: `${Math.max(widthPct, 3)}%` }}
                  className="flex h-16 rounded-md overflow-hidden shadow-sm ring-1 ring-gray-200/70 transition-all"
                >
                  {segments.map(({ brand, value }) => {
                    if (value === 0) return null;
                    const segPct = (value / total) * 100;
                    return (
                      <div
                        key={brand}
                        style={{ width: `${segPct}%`, backgroundColor: BRAND_ACCENT[brand] }}
                        className="flex items-center justify-center text-white text-sm font-bold"
                        title={`${BRAND_LABELS[brand]}: ${value.toLocaleString()}`}
                      >
                        {segPct > 12 ? value.toLocaleString() : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="w-24 shrink-0 text-left">
                <p className="text-xl font-bold text-gray-900 tabular-nums">
                  {total.toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {!isSingleBrand && (
        <div className="flex items-center justify-center gap-5 pt-3 pb-1 text-xs">
          {brands.map((b) => (
            <div key={b} className="flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: BRAND_ACCENT[b] }}
              />
              <span className="text-gray-600">{BRAND_LABELS[b]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-5 mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
          Outcomes &amp; Dormant
        </p>
        <div className="grid grid-cols-3 gap-3">
          {outcomes.map(({ stage, total }) => {
            const color =
              stage === "Booking Lost"
                ? "text-red-600"
                : stage === "No Show"
                  ? "text-orange-600"
                  : "text-gray-700";
            return (
              <div key={stage} className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{stage}</p>
                <p className={`text-lg font-bold tabular-nums ${color}`}>
                  {total.toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {!isSingleBrand && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {brands.map((b) => {
            const brandActive =
              (data?.brands[b]?.["New Leads"] ?? 0) +
              (data?.brands[b]?.["Call Back"] ?? 0) +
              (data?.brands[b]?.["Contacted"] ?? 0);
            const brandWon    = data?.brands[b]?.["Booking Won"]  ?? 0;
            const brandLost   = data?.brands[b]?.["Booking Lost"] ?? 0;
            const brandNoShow = data?.brands[b]?.["No Show"]      ?? 0;
            const brandDen    = brandWon + brandLost + brandNoShow;
            const brandWin    = brandDen > 0 ? ((brandWon / brandDen) * 100).toFixed(1) : "—";
            return (
              <div key={b} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: BRAND_ACCENT[b] }}
                  />
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {BRAND_LABELS[b]}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Active</span>
                    <span className="font-semibold text-gray-900 tabular-nums">{brandActive}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Won</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">{brandWon}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Win rate</span>
                    <span className="font-semibold text-gray-900 tabular-nums">
                      {brandWin === "—" ? "—" : `${brandWin}%`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
