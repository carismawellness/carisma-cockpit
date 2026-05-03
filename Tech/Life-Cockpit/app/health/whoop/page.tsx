import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { whoopSeed } from "@/lib/seed/health/whoop";
import { loadSeed } from "@/lib/dummy-data";
import { fetchWhoopLive } from "@/lib/whoop/live";

export default async function WhoopPage() {
  const data = await loadSeed(whoopSeed, fetchWhoopLive);
  const today = data.today;
  const recoveryStatus = today.recovery >= 67 ? "green" : today.recovery >= 34 ? "amber" : "red";
  const hrvTrend = data.last30Days.map((d) => ({ x: d.date.slice(5), y: d.hrv }));
  const recoveryTrend = data.last30Days.map((d) => ({ x: d.date.slice(5), y: d.recovery }));

  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="whoop"
      decision={
        today.recovery >= 67
          ? `Recovery ${today.recovery}% — green light for planned session`
          : `Recovery ${today.recovery}% — swap planned session for zone 2 or rest`
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Recovery" value={today.recovery} unit="%" status={recoveryStatus} delta="vs 30d avg 71%" />
        <StatCard label="HRV (today)" value={today.hrv} unit="ms" status="green" delta="▲ 6 vs 30d" />
        <StatCard label="Resting HR" value={today.rhr} unit="bpm" status="green" delta="▼ 2 vs 30d" />
        <StatCard label="Deep sleep" value={today.deepSleepMin} unit="min" status="green" delta="target ≥75" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Recovery (30 d)</p>
          <TrendLine data={recoveryTrend} color="#10b981" optimalBand={{ low: 67, high: 100 }} unit="%" height={200} />
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">HRV (30 d)</p>
          <TrendLine data={hrvTrend} color="#10b981" height={200} unit=" ms" />
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Last 7 nights</p>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-2">Date</th>
              <th className="text-right py-2">Recovery</th>
              <th className="text-right py-2">HRV</th>
              <th className="text-right py-2">RHR</th>
              <th className="text-right py-2">Sleep</th>
              <th className="text-right py-2">Deep</th>
              <th className="text-right py-2">Strain</th>
            </tr>
          </thead>
          <tbody>
            {data.last30Days.slice(-7).reverse().map((d) => (
              <tr key={d.date} className="border-b border-border/50">
                <td className="py-2 text-muted-foreground">{d.date.slice(5)}</td>
                <td className="text-right">{d.recovery}%</td>
                <td className="text-right">{d.hrv}</td>
                <td className="text-right">{d.rhr}</td>
                <td className="text-right">{d.sleepHours}h</td>
                <td className="text-right">{d.deepSleepMin}m</td>
                <td className="text-right">{d.strain}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ModuleShell>
  );
}
