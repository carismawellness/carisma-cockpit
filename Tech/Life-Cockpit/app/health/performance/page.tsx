import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { performanceSeed } from "@/lib/seed/health/performance";

export default function PerformancePage() {
  const s = performanceSeed;
  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="performance"
      decision="VO2 max 48.2 · 92nd %ile — add one zone-2 session to push toward top 2.5% (target ≥51)"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="VO2 max" value={s.vo2.current} unit="ml/kg/min" status="green" delta={`${s.vo2.percentile}th %ile for age`} big />
        <StatCard label="Grip dominant" value={s.grip.dominant} unit="kg" status="green" delta={`target ≥${s.grip.target}`} />
        <StatCard label="Dead hang" value={92} unit="sec" status="green" delta="▲ +12s vs Q1" />
        <StatCard label="Trap-bar DL" value={180} unit="kg" status="green" delta="▲ +5 vs Q1" />
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">VO2 max trajectory (24 mo)</p>
        <TrendLine data={s.vo2.trend} color="#10b981" optimalBand={{ low: 47, high: 55 }} unit=" ml/kg/min" height={200} />
      </Card>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">The 5 lifts</p>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-2">Lift</th>
              <th className="text-right py-2">Current</th>
              <th className="text-left py-2 pl-4">Last update</th>
              <th className="text-right py-2">Trend</th>
            </tr>
          </thead>
          <tbody>
            {s.lifts.map((l) => (
              <tr key={l.name} className="border-b border-border/50">
                <td className="py-2 font-medium">{l.name}</td>
                <td className="text-right">{l.current} <span className="text-xs text-muted-foreground">{l.unit}</span></td>
                <td className="text-left pl-4 text-muted-foreground text-xs">{l.lastUpdate}</td>
                <td className="text-right text-xs text-emerald-600">{l.trend}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ModuleShell>
  );
}
