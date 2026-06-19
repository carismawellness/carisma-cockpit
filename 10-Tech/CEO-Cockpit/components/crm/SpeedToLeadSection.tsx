"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useSpeedToLead, type StlSummary } from "@/lib/hooks/useSpeedToLead";
import { formatMinutes } from "@/lib/charts/config";
import { BRAND } from "@/lib/constants/design-tokens";
import { STL_BUCKETS, STL_BUCKET_LABELS, type StlBucket } from "@/lib/utils/business-hours";
import { Clock, Info, AlertTriangle } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BRANDS = ["spa", "aesthetics", "slimming"] as const;
const BRAND_LABELS: Record<string, string> = { spa: "Spa", aesthetics: "Aesthetics", slimming: "Slimming" };
const BRAND_BORDER: Record<string, string> = {
  spa: BRAND.spa.soft,
  aesthetics: BRAND.aesthetics.soft,
  slimming: BRAND.slimming.soft,
};

// SLA: <5 green · 5–30 amber · >30 red. Segments coloured along that gradient.
const BUCKET_COLORS: Record<StlBucket, string> = {
  "<5": "#16A34A",
  "5-30": "#FACC15",
  "30-60": "#FB923C",
  "60-240": "#F87171",
  ">240": "#DC2626",
  pending: "#CBD5E1",
};

const STL_TARGET_MIN = 5;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function stlColor(minutes: number): string {
  if (minutes <= 0) return "text-muted-foreground";
  if (minutes < 5) return "text-emerald-600";
  if (minutes < 15) return "text-amber-500";
  if (minutes < 30) return "text-orange-500";
  return "text-red-600";
}

function stlGrade(minutes: number, responded: number): string {
  if (responded === 0) return "—";
  if (minutes < 5) return "A";
  if (minutes < 15) return "B";
  if (minutes < 30) return "C";
  if (minutes < 60) return "D";
  return "F";
}

function gradeColor(g: string): string {
  const colors: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-700",
    B: "bg-green-100 text-green-700",
    C: "bg-amber-100 text-amber-700",
    D: "bg-orange-100 text-orange-700",
    F: "bg-red-100 text-red-700",
    "—": "bg-gray-100 text-gray-400",
  };
  return colors[g] ?? "bg-gray-100 text-gray-500";
}

/** Segmented distribution bar — always prints the count on each visible segment. */
function BucketBar({ buckets, total }: { buckets: Record<StlBucket, number>; total: number }) {
  if (total === 0) return <div className="h-3 rounded-full bg-gray-100" />;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-full">
      {STL_BUCKETS.map((b) => {
        const n = buckets[b] ?? 0;
        if (n === 0) return null;
        const pct = (n / total) * 100;
        return (
          <div
            key={b}
            className="flex items-center justify-center text-[9px] font-bold text-white/90"
            style={{ width: `${pct}%`, backgroundColor: BUCKET_COLORS[b] }}
            title={`${STL_BUCKET_LABELS[b]}: ${n}`}
          >
            {pct > 8 ? n : ""}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SpeedToLeadSection({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { data, isLoading } = useSpeedToLead(dateFrom, dateTo, brandFilter);

  const visibleBrands = brandFilter ? BRANDS.filter((b) => b === brandFilter) : [...BRANDS];

  const { totalResponded, totalApprox, totalLeads } = useMemo(() => {
    let responded = 0, approx = 0, leads = 0;
    for (const slug of visibleBrands) {
      const s = data?.brands[slug];
      if (!s) continue;
      responded += s.responded;
      approx += s.approx;
      leads += s.total;
    }
    return { totalResponded: responded, totalApprox: approx, totalLeads: leads };
  }, [data, visibleBrands]);

  if (isLoading) return <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />;

  const hasData = totalLeads > 0;
  const approxShare = totalLeads > 0 ? Math.round((totalApprox / totalLeads) * 100) : 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Speed to Lead
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Directional proxy: <strong>business-hours</strong> time (Mon–Sat 9am–7pm) from a lead being
            created to the first time it leaves the <strong>New Leads</strong> stage in GHL. Target: under{" "}
            {STL_TARGET_MIN} min. Leads created in the selected range.
          </span>
        </p>
      </div>

      {!hasData ? (
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-2">
            <p className="text-sm font-medium">No speed-to-lead data for this range yet</p>
            <p className="text-xs max-w-md">
              Run the <code className="px-1 bg-muted rounded">speed-to-lead</code> ETL (or wait for the
              nightly sync) to populate this. It reads GHL stage-change events captured by the webhook,
              plus an approximate backfill for historical leads.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {approxShare > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>{approxShare}%</strong> of these leads use an approximate first-response time
                (backfilled from historical stage data — overestimates leads that moved stage more than
                once). Exact timing applies to leads captured live by the webhook.
              </span>
            </div>
          )}

          {/* Brand cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {visibleBrands.map((slug) => {
              const s: StlSummary | undefined = data?.brands[slug];
              const median = s?.median_min ?? 0;
              const responded = s?.responded ?? 0;
              const grade = stlGrade(median, responded);
              return (
                <Card
                  key={slug}
                  className="p-4 border-l-4"
                  style={{ borderLeftColor: BRAND_BORDER[slug] ?? "#888" }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
                      {BRAND_LABELS[slug]}
                    </h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${gradeColor(grade)}`}>{grade}</span>
                  </div>

                  <div className="text-center mb-3">
                    <p className={`text-3xl font-black ${stlColor(median)}`}>
                      {responded > 0 ? formatMinutes(median) : "—"}
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      Median response
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Mean</p>
                      <p className={`text-sm font-bold ${stlColor(s?.mean_min ?? 0)}`}>
                        {responded > 0 ? formatMinutes(s?.mean_min ?? 0) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">&lt;5min</p>
                      <p className="text-sm font-bold text-emerald-600">{s ? `${s.within_sla_pct}%` : "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Leads</p>
                      <p className="text-sm font-bold text-foreground">
                        {responded}
                        <span className="text-[10px] font-normal text-muted-foreground">/{s?.total ?? 0}</span>
                      </p>
                    </div>
                  </div>

                  {s && <BucketBar buckets={s.buckets} total={s.total} />}
                </Card>
              );
            })}
          </div>

          {/* Bucket legend */}
          <div className="flex gap-3 justify-center text-[10px] text-text-secondary flex-wrap">
            {STL_BUCKETS.map((b) => (
              <div key={b} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BUCKET_COLORS[b] }} />
                <span>{STL_BUCKET_LABELS[b]}</span>
              </div>
            ))}
          </div>

          {/* Speed to Lead by Rep */}
          <Card className="p-4 md:p-5">
            <h3 className="text-base font-semibold text-foreground mb-1">Speed to Lead by Rep</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Per-rep median response time — slowest first. &ldquo;Unassigned&rdquo; = no owner set on the
              lead in GHL.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Rep</th>
                    <th className="py-2 px-2 font-medium text-right">Median</th>
                    <th className="py-2 px-2 font-medium text-right">Mean</th>
                    <th className="py-2 px-2 font-medium text-right">&lt;5min</th>
                    <th className="py-2 px-2 font-medium text-right">Leads</th>
                    <th className="py-2 pl-3 font-medium w-40">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.agents ?? []).filter((a) => a.responded > 0 || a.total > 0).map((a) => (
                    <tr key={a.agent_name} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 pr-3 font-medium text-foreground">{a.agent_name}</td>
                      <td className={`py-2 px-2 text-right font-bold ${stlColor(a.median_min)}`}>
                        {a.responded > 0 ? formatMinutes(a.median_min) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {a.responded > 0 ? formatMinutes(a.mean_min) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right">{a.responded > 0 ? `${a.within_sla_pct}%` : "—"}</td>
                      <td className="py-2 px-2 text-right">
                        {a.responded}
                        <span className="text-[10px] text-muted-foreground">/{a.total}</span>
                      </td>
                      <td className="py-2 pl-3">
                        <BucketBar buckets={a.buckets} total={a.total} />
                      </td>
                    </tr>
                  ))}
                  {(data?.agents ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">
                        No rep-level data for this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
