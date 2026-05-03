import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { stackSeed } from "@/lib/seed/health/stack";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<"green" | "amber" | "red", string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export default function HealthStackPage() {
  const s = stackSeed;
  const avgAdherence = Math.round(s.supplements.reduce((sum, x) => sum + x.adherence, 0) / s.supplements.length);
  const protocolsOnTrack = s.protocols.filter((p) => p.status === "green").length;
  const breathworkBehind = s.protocols.find((p) => p.name === "Breathwork");

  return (
    <ModuleShell
      pillarId="health"
      moduleSlug="stack"
      decision={
        breathworkBehind && breathworkBehind.status === "red"
          ? "Breathwork at 16% of weekly target — schedule one 10-min session into tomorrow AM block"
          : "All protocols on track"
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Adherence (30 d)" value={avgAdherence} unit="%" status={avgAdherence >= 85 ? "green" : "amber"} />
        <StatCard label="Active supplements" value={s.supplements.length} />
        <StatCard label="Protocols on track" value={`${protocolsOnTrack}/${s.protocols.length}`} status={protocolsOnTrack >= 4 ? "green" : "amber"} />
        <StatCard label="Next aesthetic Tx" value="14 May" caption={s.grooming.nextTreatment} />
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Supplements</p>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Dose</th>
              <th className="text-left py-2">Cadence</th>
              <th className="text-left py-2">Category</th>
              <th className="text-right py-2">Adherence 30d</th>
            </tr>
          </thead>
          <tbody>
            {s.supplements.map((x) => (
              <tr key={x.name} className="border-b border-border/50">
                <td className="py-2 font-medium">{x.name}</td>
                <td className="text-muted-foreground">{x.dose}</td>
                <td className="text-muted-foreground">{x.cadence}</td>
                <td className="text-muted-foreground capitalize">{x.category}</td>
                <td className="text-right">
                  <span className={cn(x.adherence >= 85 ? "text-emerald-600" : x.adherence >= 70 ? "text-amber-600" : "text-red-600")}>
                    {x.adherence}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Protocols (weekly dose)</p>
          <div className="space-y-2">
            {s.protocols.map((p) => (
              <div key={p.name} className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[p.status])} />
                  <span className="font-medium">{p.name}</span>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{p.weeklyActual}</div>
                  <div className="text-[10px]">target {p.weeklyTarget}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">Grooming regimen</p>
          <div className="text-xs space-y-3">
            <div>
              <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground mb-1">AM</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                {s.grooming.am.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground mb-1">PM</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                {s.grooming.pm.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div>
              <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground mb-1">Weekly</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                {s.grooming.weekly.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </ModuleShell>
  );
}
