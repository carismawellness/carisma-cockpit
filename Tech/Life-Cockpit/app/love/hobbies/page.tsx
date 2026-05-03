import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { hobbiesSeed } from "@/lib/seed/love/hobbies";

export default function HobbiesPage() {
  const s = hobbiesSeed;
  const guitar = s.hobbies.find((h) => h.name === "Guitar")!;

  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="hobbies"
      decision={`Guitar streak: ${guitar.streakDays} days. Don't break tonight — 15 min after dinner.`}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Deep work this week" value={s.deepWorkHoursWeek} unit="hrs" status={s.deepWorkHoursWeek >= s.deepWorkTarget ? "green" : "amber"} delta={`target ${s.deepWorkTarget}`} />
        <StatCard label="Books finished YTD" value={s.booksFinishedYTD} status="amber" delta={`target ${s.booksTarget} (${Math.round((s.booksFinishedYTD/s.booksTarget)*100)}%)`} />
        <StatCard label="Guitar streak" value={s.hobbies[0].streakDays} unit="days" status="green" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hobbies</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {s.hobbies.map((h) => (
            <Card key={h.id} className="p-4">
              <p className="font-semibold">{h.name}</p>
              <div className="flex gap-1 mt-3">
                {h.practiceLast7.map((min, i) => (
                  <div
                    key={i}
                    title={`${min} min`}
                    className="flex-1 h-12 rounded bg-pink-100 relative overflow-hidden"
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-pink-500"
                      style={{ height: `${Math.min(100, (min / 60) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Last 7 days · max 60 min</p>
              <p className="text-xs mt-3 text-muted-foreground line-clamp-2">{h.lastSession}</p>
              <p className="text-[11px] text-pink-700 mt-2">{h.milestone}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Currently reading</p>
          <div className="space-y-2">
            {s.reading.current.map((b) => (
              <div key={b.title} className="text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{b.title}</span>
                  <span className="text-xs text-muted-foreground">{b.progress}%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{b.author}</p>
                <div className="h-1.5 bg-muted rounded mt-1">
                  <div className="h-full bg-pink-600 rounded" style={{ width: `${b.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Finished this year ({s.reading.finishedYTD.length})</p>
          <ul className="text-sm space-y-1">
            {s.reading.finishedYTD.map((b) => (
              <li key={b.title} className="flex items-center justify-between border-b border-border/50 py-1">
                <span><span className="font-medium">{b.title}</span> <span className="text-xs text-muted-foreground">— {b.author}</span></span>
                <span className="text-xs text-amber-500">{"★".repeat(b.rating)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </ModuleShell>
  );
}
