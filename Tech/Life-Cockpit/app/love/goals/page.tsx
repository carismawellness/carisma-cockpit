import { ModuleShell } from "@/components/dashboard/module-shell";
import { Card } from "@/components/ui/card";
import { goalsSeed } from "@/lib/seed/love/goals";
import { cn } from "@/lib/utils";

export default function GoalsPage() {
  const s = goalsSeed;
  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="goals"
      decision="VO2 max OKR at 92% on track. Books at 42% behind — pick up pace, 2 books in May."
    >
      <Card className="p-8 text-center bg-pink-50 border-pink-200">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.year} — annual theme</p>
        <p className="text-3xl md:text-5xl font-bold text-pink-700 mt-1">{s.theme}</p>
        <p className="text-sm text-muted-foreground mt-3 max-w-xl mx-auto">{s.themeRationale}</p>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">This year&apos;s three (from bucket list)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {s.threeForTheYear.map((t, i) => (
            <Card key={i} className="p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">#{i + 1}</p>
              <p className="font-semibold mt-1">{t.title}</p>
              <div className="h-2 bg-muted rounded mt-3">
                <div className={cn("h-full rounded", t.progress >= 0.8 ? "bg-emerald-600" : t.progress >= 0.4 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${t.progress * 100}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{Math.round(t.progress * 100)}% to target</p>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Personal OKRs (not business)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {s.okrs.map((o) => (
            <Card key={o.id} className="p-4">
              <p className="font-semibold">{o.title}</p>
              <p className="text-xs text-muted-foreground">{o.target}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1 h-2 bg-muted rounded">
                  <div className={cn("h-full rounded", o.progress >= 0.75 ? "bg-emerald-600" : o.progress >= 0.5 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${o.progress * 100}%` }} />
                </div>
                <span className="text-xs font-medium">{Math.round(o.progress * 100)}%</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-end justify-between mb-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bucket list</p>
          <p className="text-sm">
            <span className="text-2xl font-bold">{s.bucketList.completed}</span>
            <span className="text-muted-foreground"> / {s.bucketList.total} ({s.bucketList.completionPct}%)</span>
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {s.bucketList.byCategory.map((c) => (
            <div key={c.name} className="text-center p-2 border border-border rounded">
              <p className="text-[10px] uppercase text-muted-foreground">{c.name}</p>
              <p className="text-sm font-bold">{c.done}/{c.total}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Top next</p>
        <ul className="text-sm space-y-1">
          {s.bucketList.topNext.map((x) => <li key={x} className="text-muted-foreground">· {x}</li>)}
        </ul>
      </Card>
    </ModuleShell>
  );
}
