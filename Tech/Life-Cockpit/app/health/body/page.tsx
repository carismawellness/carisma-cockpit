import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { bodySeed } from "@/lib/seed/health/body";

export default function BodyCompositionPage() {
  const s = bodySeed;
  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="body"
      decision="Fiber 38g vs target 40g — add 1 cup berries to AM routine for 2 weeks"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Weight" value={s.weight.current} unit="kg" delta={`target ${s.weight.target} kg`} status="green" />
        <StatCard label="BP" value={`${s.bp.systolic}/${s.bp.diastolic}`} status="green" delta="30d avg" />
        <StatCard label="Body fat" value={s.dexa.bodyFatPct} unit="%" status="green" delta={`DEXA ${s.dexa.date}`} />
        <StatCard label="ALMI" value={s.dexa.almi} unit="kg/m²" status="green" delta="optimal >8.5" />
        <StatCard label="Avg glucose" value={s.cgm.avgGlucose} unit="mg/dL" status="green" delta={`TIR ${s.cgm.timeInRange}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Weight (90d)</p>
          <TrendLine data={s.weight.trend} color="#10b981" height={200} unit=" kg" />
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Systolic BP (30d)</p>
          <TrendLine data={s.bp.trend} color="#10b981" optimalBand={{ low: 100, high: 120 }} height={200} />
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Nutrition signal (3 numbers)</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Protein</p>
            <p className="text-2xl font-bold">{s.nutrition.proteinG}<span className="text-sm text-muted-foreground"> g</span></p>
            <p className="text-[11px] text-emerald-600">target {s.nutrition.proteinTarget}g · ✓</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fiber</p>
            <p className="text-2xl font-bold">{s.nutrition.fiberG}<span className="text-sm text-muted-foreground"> g</span></p>
            <p className="text-[11px] text-amber-600">target {s.nutrition.fiberTarget}g · 2g short</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Eating window</p>
            <p className="text-2xl font-bold">{s.nutrition.eatingWindowHours}<span className="text-sm text-muted-foreground"> h</span></p>
            <p className="text-[11px] text-emerald-600">≤10h · ✓</p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Latest CGM ({s.cgm.window})</p>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><p className="text-muted-foreground text-xs">Time in range</p><p className="text-xl font-bold">{s.cgm.timeInRange}%</p></div>
          <div><p className="text-muted-foreground text-xs">Avg glucose</p><p className="text-xl font-bold">{s.cgm.avgGlucose}<span className="text-xs text-muted-foreground"> mg/dL</span></p></div>
          <div><p className="text-muted-foreground text-xs">Fasting avg</p><p className="text-xl font-bold">{s.cgm.fastingAvg}</p></div>
          <div><p className="text-muted-foreground text-xs">Peak post-meal</p><p className="text-xl font-bold">{s.cgm.peakAfterMeal}</p></div>
        </div>
      </Card>
    </ModuleShell>
  );
}
