"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useGhlFunnel } from "@/lib/hooks/useGhlFunnel";
import { BRAND } from "@/lib/constants/design-tokens";

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

const FUNNEL_STAGES = ["New Leads", "Call Back", "Contacted", "Booking Won", "Active Member"];
const OUTCOME_STAGES = ["Booking Lost", "No Show", "Nurturing"];

// Canonical brand palette — dark variant for primary marks on light backgrounds.
const BRAND_ACCENT: Record<string, string> = {
  spa:        BRAND.spa.dark,
  aesthetics: BRAND.aesthetics.dark,
  slimming:   BRAND.slimming.dark,
};

function BrandFunnel({
  brand,
  stages,
  outcomes,
}: {
  brand: string;
  stages: Record<string, number>;
  outcomes: Record<string, number>;
}) {
  const color = BRAND_ACCENT[brand];

  const orderedStages = useMemo(
    () =>
      FUNNEL_STAGES.map((s) => ({ stage: s, value: stages[s] ?? 0 }))
        .filter((s) => s.value > 0),
    [stages],
  );

  const maxValue = Math.max(...orderedStages.map((s) => s.value), 0);

  const won    = stages["Booking Won"]  ?? 0;
  const lost   = outcomes["Booking Lost"] ?? 0;
  const noShow = outcomes["No Show"]    ?? 0;
  const active = (stages["New Leads"] ?? 0) + (stages["Call Back"] ?? 0) + (stages["Contacted"] ?? 0);
  const den    = won + lost + noShow;
  const winRate = den > 0 ? ((won / den) * 100).toFixed(1) : "—";

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
        <h4 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          {BRAND_LABELS[brand]}
        </h4>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Active</p>
          <p className="text-lg font-bold text-gray-900 tabular-nums">{active.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Won</p>
          <p className="text-lg font-bold text-emerald-600 tabular-nums">{won.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Win Rate</p>
          <p className="text-lg font-bold text-gray-900 tabular-nums">
            {winRate === "—" ? "—" : `${winRate}%`}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {orderedStages.map(({ stage, value }, idx) => {
          const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
          // Conversion to prior stage — first stage has no prior, so blank.
          const prior = idx > 0 ? orderedStages[idx - 1].value : 0;
          const stagePct = idx > 0 && prior > 0 ? (value / prior) * 100 : null;
          return (
            <div key={stage} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-right">
                <p className="text-xs font-medium text-gray-600">{stage}</p>
              </div>
              <div className="flex-1 flex justify-center">
                <div
                  style={{
                    width: `${Math.max(widthPct, 4)}%`,
                    backgroundColor: color,
                  }}
                  className="h-10 rounded-md shadow-sm flex items-center justify-center text-white text-xs font-bold transition-all"
                  title={`${stage}: ${value.toLocaleString()}${stagePct !== null ? ` (${stagePct.toFixed(0)}% of prior)` : ""}`}
                >
                  {widthPct > 22 ? value.toLocaleString() : ""}
                </div>
              </div>
              <div className="w-20 shrink-0 text-left">
                <p className="text-sm font-bold text-gray-900 tabular-nums leading-tight">
                  {value.toLocaleString()}
                </p>
                <p className="text-[10px] text-gray-500 tabular-nums leading-tight">
                  {stagePct !== null ? `${stagePct.toFixed(0)}% of prior` : "—"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t grid grid-cols-3 gap-2">
        {OUTCOME_STAGES.map((stage) => {
          const v = outcomes[stage] ?? 0;
          const tone =
            stage === "Booking Lost"
              ? "text-red-600"
              : stage === "No Show"
                ? "text-orange-600"
                : "text-gray-700";
          return (
            <div key={stage}>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">{stage}</p>
              <p className={`text-sm font-bold tabular-nums ${tone}`}>{v.toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

  const sumByStages = (stages: string[]) =>
    stages.reduce(
      (s, st) => s + brands.reduce((sb, b) => sb + (data?.brands[b]?.[st] ?? 0), 0),
      0,
    );

  const totalActive = sumByStages(["New Leads", "Call Back", "Contacted"]);
  const totalWon    = sumByStages(["Booking Won"]);
  const totalLost   = sumByStages(["Booking Lost"]);
  const totalNoShow = sumByStages(["No Show"]);
  const closeDen    = totalWon + totalLost + totalNoShow;
  const winRate     = closeDen > 0 ? ((totalWon / closeDen) * 100).toFixed(1) : "—";

  if (isLoading) {
    return <div className="h-[500px] rounded-xl bg-gray-100 animate-pulse" />;
  }

  const cols =
    brands.length === 1 ? "grid-cols-1" : brands.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <Card className="p-5 md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Pipeline Funnel</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Current snapshot · Call Pipeline · from GHL CRM (date filter not yet supported)
          </p>
        </div>
        <div className="flex gap-6 text-right shrink-0">
          <div>
            <p className="text-xs text-muted-foreground">Group Active</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {totalActive.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Group Won</p>
            <p className="text-2xl font-bold text-emerald-600 tabular-nums">
              {totalWon.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Group Win Rate</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {winRate === "—" ? "—" : `${winRate}%`}
            </p>
          </div>
        </div>
      </div>

      <div className={`grid ${cols} gap-4`}>
        {brands.map((b) => {
          const brandStages: Record<string, number> = {};
          const brandOutcomes: Record<string, number> = {};
          for (const s of FUNNEL_STAGES) brandStages[s] = data?.brands[b]?.[s] ?? 0;
          for (const s of OUTCOME_STAGES) brandOutcomes[s] = data?.brands[b]?.[s] ?? 0;
          return (
            <BrandFunnel
              key={b}
              brand={b}
              stages={brandStages}
              outcomes={brandOutcomes}
            />
          );
        })}
      </div>
    </Card>
  );
}
