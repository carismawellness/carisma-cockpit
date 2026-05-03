import Image from "next/image";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { travelSeed } from "@/lib/seed/love/travel";

export default function TravelPage() {
  const s = travelSeed;
  const countries = new Set(s.trips.map((t) => t.country)).size;
  const avgRating = +(s.trips.reduce((sum, t) => sum + t.rating, 0) / s.trips.length).toFixed(1);

  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="travel"
      decision="Wanderlist: Kyoto in autumn pencilled with Sarah — book flights by August for cherry colors"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Countries visited" value={countries} />
        <StatCard label="Total trips" value={s.trips.length} />
        <StatCard label="Avg rating" value={`${avgRating}/5`} status="green" />
        <StatCard label="Wanderlist" value={s.wanderlist.length} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recent trips</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {s.trips.map((t) => (
            <Card key={t.id} className="overflow-hidden p-0">
              <div className="relative w-full aspect-[16/9] bg-muted">
                <Image src={`https://picsum.photos/seed/${t.imageSeed}/400/225`} alt={t.place} fill className="object-cover" sizes="400px" unoptimized />
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">{t.place}, {t.country}</p>
                  <span className="text-xs text-amber-500">{"★".repeat(t.rating)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{t.dates} · with {t.withWhom}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{t.memory}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Wanderlist</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {s.wanderlist.map((w) => (
            <Card key={w.id} className="p-3">
              <p className="font-semibold text-sm">{w.place}</p>
              <p className="text-[11px] text-muted-foreground">{w.season} · with {w.withWhom}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{w.why}</p>
            </Card>
          ))}
        </div>
      </div>
    </ModuleShell>
  );
}
