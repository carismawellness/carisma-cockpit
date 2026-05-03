import Image from "next/image";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { reflectionSeed } from "@/lib/seed/love/reflection";

export default function ReflectionPage() {
  const s = reflectionSeed;
  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="reflection"
      decision={`Weekly review due in ${s.nextDueDays} days — block 30 min Sunday evening`}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Weekly review streak" value={s.weeklyStreak} unit="weeks" status="green" />
        <StatCard label="Next review due" value={s.nextDueDays} unit="days" status="amber" />
        <StatCard label="Annual review" value="2025 ✓" delta="2026 mid-year due Jul 1" />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <div className="relative aspect-square sm:aspect-auto sm:h-full bg-muted">
            <Image src={`https://picsum.photos/seed/${s.onThisDay.imageSeed}/400/400`} alt="" fill className="object-cover" sizes="400px" unoptimized />
          </div>
          <div className="sm:col-span-2 p-6">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">On this day</p>
            <p className="text-2xl font-bold mt-1">{s.onThisDay.yearsAgo} years ago</p>
            <p className="text-muted-foreground mt-2">{s.onThisDay.caption}</p>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent weekly reviews</h2>
        <div className="space-y-3">
          {s.recentReviews.map((r) => (
            <Card key={r.weekOf} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-sm">Week of {r.weekOf}</p>
                <p className="text-xs text-muted-foreground">Mood {r.mood}/10</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Best moment</p>
                  <p>{r.bestMoment}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Biggest lesson</p>
                  <p>{r.biggestLesson}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card className="p-6 bg-pink-50 border-pink-200">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Annual review · 2025</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Best moment</p>
            <p>{s.annual2025.bestMoment}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Biggest lesson</p>
            <p>{s.annual2025.biggestLesson}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Proudest of</p>
            <p>{s.annual2025.proudest}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">What to fix</p>
            <p>{s.annual2025.onWhich}</p>
          </div>
        </div>
      </Card>
    </ModuleShell>
  );
}
