import { ModuleShell } from "@/components/dashboard/module-shell";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { biologicalAgeSeed, type AgeMetric } from "@/lib/seed/health/biological-age";
import { cn } from "@/lib/utils";

const STATUS_BG: Record<AgeMetric["status"], string> = {
  green: "bg-emerald-50 border-emerald-200",
  amber: "bg-amber-50 border-amber-200",
  red: "bg-red-50 border-red-200",
};

const STATUS_DOT: Record<AgeMetric["status"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export default function BiologicalAgePage() {
  const s = biologicalAgeSeed;
  const ageDelta = (s.chronologicalAge - s.estimatedBioAge).toFixed(1);

  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="biological-age"
      decision="ApoB up to 88 — book lipid recheck in 8 weeks; trial 90 days low-saturated-fat + soluble fiber bump"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6 col-span-1 md:col-span-3 border-2 border-emerald-200 bg-emerald-50">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Estimated biological age</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-5xl md:text-6xl font-bold text-emerald-700">{s.estimatedBioAge}</span>
                <span className="text-sm text-muted-foreground">vs chronological {s.chronologicalAge}</span>
                <span className="text-sm font-semibold text-emerald-700">{ageDelta} yr younger</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pace of aging</p>
              <div className="text-3xl font-bold text-emerald-700">{s.paceOfAging}</div>
              <p className="text-[11px] text-muted-foreground">years/year · target &lt;0.95</p>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          The 8 numbers (as of {s.asOf})
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {s.metrics.map((m) => (
            <Card key={m.key} className={cn("p-4 border", STATUS_BG[m.status])}>
              <div className="flex items-start justify-between mb-1">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{m.label}</p>
                <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[m.status])} />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">{m.value}</span>
                <span className="text-xs text-muted-foreground">{m.unit}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">Optimal {m.optimal}</div>
              <div className="text-[11px] text-muted-foreground">{m.delta}</div>
              <p className="text-[11px] mt-2 leading-snug">{m.rationale}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">VO2 max trajectory (24 mo)</p>
          <TrendLine data={s.vo2Trend} color="#10b981" optimalBand={{ low: 47, high: 55 }} unit=" ml/kg/min" height={180} />
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">HRV (90 d, ms)</p>
          <TrendLine data={s.hrvTrend} color="#10b981" height={180} />
        </Card>
      </div>
    </ModuleShell>
  );
}
