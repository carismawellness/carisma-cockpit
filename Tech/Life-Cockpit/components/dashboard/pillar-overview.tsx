import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ArrowUpRight } from "lucide-react";
import type { PillarDef } from "@/lib/pillars";

export function PillarOverview({
  pillar,
  northStar,
}: {
  pillar: PillarDef;
  northStar: { metric: string; value: string; trend: string };
}) {
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className={`text-xs font-medium uppercase tracking-wider ${pillar.colorClass}`}>
            Pillar
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{pillar.name}</h1>
          <p className="text-sm text-muted-foreground">{pillar.tagline}</p>
        </div>
        <Card className={`px-4 py-3 border-2 ${pillar.borderClass} ${pillar.bgClass}`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">North star</div>
          <div className="text-xs text-muted-foreground">{northStar.metric}</div>
          <div className="text-xl font-bold">{northStar.value}</div>
          <div className="text-[11px] text-muted-foreground">{northStar.trend}</div>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          Modules ({pillar.modules.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {pillar.modules.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.id} href={`/${pillar.id}/${m.slug}`} className="group">
                <Card className="p-4 h-full transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between mb-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {m.name}
                    {m.hero && (
                      <span className="text-[9px] uppercase tracking-wider text-amber-600">★ hero</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.blurb}</div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
