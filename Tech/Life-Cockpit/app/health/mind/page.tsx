import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { mindSeed } from "@/lib/seed/health/mind";

export default function MindPage() {
  const s = mindSeed;
  const moodTrend = s.last30Days.map((d) => ({ x: d.x, y: d.mood }));
  const focusTrend = s.last30Days.map((d) => ({ x: d.x, y: d.focus }));

  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="mind"
      decision="Focus trending below mood/energy → guard 9–11 deep-work block tomorrow, no meetings"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Mood today" value={`${s.todayMood}/5`} status={s.todayMood >= 4 ? "green" : "amber"} />
        <StatCard label="Energy today" value={`${s.todayEnergy}/5`} status={s.todayEnergy >= 4 ? "green" : "amber"} />
        <StatCard label="Focus today" value={`${s.todayFocus}/5`} status={s.todayFocus >= 4 ? "green" : "amber"} />
        <StatCard label="Meditation streak" value={s.meditationStreakDays} unit="days" status="green" delta={`${s.meditationMinutesWeek} min this week`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Mood (30d, 1–5 scale)</p>
          <TrendLine data={moodTrend} color="#10b981" height={180} />
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Focus (30d, 1–5 scale)</p>
          <TrendLine data={focusTrend} color="#10b981" height={180} />
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Cognitive battery — last test {s.cognitiveBattery.date}</p>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Processing speed</p><p className="text-2xl font-bold">{s.cognitiveBattery.processing}</p></div>
          <div><p className="text-xs text-muted-foreground">Working memory</p><p className="text-2xl font-bold">{s.cognitiveBattery.workingMemory}</p></div>
          <div><p className="text-xs text-muted-foreground">Executive</p><p className="text-2xl font-bold">{s.cognitiveBattery.executive}</p></div>
          <div><p className="text-xs text-muted-foreground">Overall %ile</p><p className="text-2xl font-bold text-emerald-700">{s.cognitiveBattery.overall}</p></div>
        </div>
      </Card>
    </ModuleShell>
  );
}
