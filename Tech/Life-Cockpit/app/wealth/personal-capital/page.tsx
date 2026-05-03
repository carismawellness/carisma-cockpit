import { ModuleShell } from "@/components/dashboard/module-shell";
import { Card } from "@/components/ui/card";
import { TrendLine } from "@/components/dashboard/charts";
import { personalCapitalSeed } from "@/lib/seed/wealth/personal-capital";
import { cn } from "@/lib/utils";

const fmt = (n: number) => "€" + n.toLocaleString("en-GB");

export default function PersonalCapitalPage() {
  const s = personalCapitalSeed;
  const yofData = s.yofTrend.map((p) => ({ x: p.x, y: p.y }));

  return (
    <ModuleShell
      pillarId="wealth"
      moduleSlug="personal-capital"
      decision="YoF up 0.4 vs YE — keep current burn; redirect Q3 distribution to liquid index funds"
    >
      <Card className="p-6 border-2 border-slate-200 bg-slate-50">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Years of Freedom</p>
            <p className="text-xs text-muted-foreground">Liquid NW ÷ annual personal burn · as of {s.asOf}</p>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-5xl md:text-6xl font-bold text-slate-700">{s.yearsOfFreedom}</span>
              <span className="text-sm text-emerald-700">▲ 0.4 vs YE 2025</span>
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Liquid</p>
              <p className="text-2xl font-bold">{fmt(s.liquidNetWorth)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Illiquid (Carisma equity)</p>
              <p className="text-2xl font-bold">{fmt(s.illiquidNetWorth)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Monthly burn</p>
              <p className="text-2xl font-bold">{fmt(s.monthlyBurn)}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Years of Freedom (24 mo)</p>
        <TrendLine data={yofData} color="#1B3A4B" optimalBand={{ low: 3, high: 10 }} unit=" yrs" height={200} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Asset breakdown</p>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2">Category</th>
                <th className="text-right py-2">Value</th>
                <th className="text-right py-2">Liquid %</th>
                <th className="text-right py-2">1m</th>
              </tr>
            </thead>
            <tbody>
              {s.assets.map((a) => (
                <tr key={a.category} className="border-b border-border/50">
                  <td className="py-2">{a.category}</td>
                  <td className="text-right">{fmt(a.value)}</td>
                  <td className="text-right text-muted-foreground">{a.allocationPct ? `${a.allocationPct}%` : "—"}</td>
                  <td className={cn("text-right text-xs", a.change1m > 0 ? "text-emerald-600" : a.change1m < 0 ? "text-red-600" : "text-muted-foreground")}>
                    {a.change1m > 0 ? "+" : ""}{a.change1m}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Monthly burn breakdown</p>
          <div className="space-y-2">
            {s.burnBreakdown.map((b) => {
              const pct = (b.value / s.monthlyBurn) * 100;
              return (
                <div key={b.category} className="text-sm">
                  <div className="flex justify-between">
                    <span>{b.category}</span>
                    <span className="text-muted-foreground">{fmt(b.value)} <span className="text-[10px]">({pct.toFixed(0)}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-muted rounded mt-1">
                    <div className="h-full bg-slate-700 rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </ModuleShell>
  );
}
