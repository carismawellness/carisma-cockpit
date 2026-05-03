import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PILLARS } from "@/lib/pillars";
import { ArrowUpRight } from "lucide-react";

const PILLAR_HEADLINE: Record<string, { metric: string; value: string; trend: string }> = {
  health: { metric: "Recovery (today)", value: "82%", trend: "▲ 8 vs 30d" },
  wealth: { metric: "Years of Freedom", value: "3.2 yrs", trend: "▲ 0.4 vs YE" },
  love:   { metric: "1:1 conversations / 30d", value: "11", trend: "▼ 3 vs target 14" },
};

export default function HomePage() {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          One number per pillar
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PILLARS.map((p) => {
          const head = PILLAR_HEADLINE[p.id];
          return (
            <Link key={p.id} href={`/${p.id}`} className="group">
              <Card className={`p-6 border-2 ${p.borderClass} ${p.bgClass} transition-shadow hover:shadow-md`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className={`text-sm font-medium uppercase tracking-wider ${p.colorClass}`}>
                      {p.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{head.metric}</div>
                  <div className="text-3xl font-bold text-foreground">{head.value}</div>
                  <div className="text-xs text-muted-foreground">{head.trend}</div>
                </div>

                <div className="mt-4 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
                  {p.modules.length} modules
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          One decision today
        </h2>
        <Card className="p-6">
          <p className="text-base">
            Recovery 82% and HRV trending up — green light for the planned strength session at 18:00.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Based on Health · WHOOP Live · last 7 days
          </p>
        </Card>
      </div>
    </>
  );
}
