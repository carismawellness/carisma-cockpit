import Image from "next/image";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { innerCircleSeed } from "@/lib/seed/love/inner-circle";
import { cn } from "@/lib/utils";

export default function InnerCirclePage() {
  const s = [...innerCircleSeed].sort((a, b) => b.lastContactDays - a.lastContactDays);
  const owedTouch = s.filter((c) => c.lastContactDays > c.cadenceDays);
  const avgDays = Math.round(s.reduce((sum, c) => sum + c.lastContactDays, 0) / s.length);
  const longestGap = Math.max(...s.map((c) => c.lastContactDays));
  const top3Owed = owedTouch.slice(0, 3).map((c) => `${c.name} (${c.lastContactDays}d)`).join(", ");

  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="inner-circle"
      decision={`Owed a touch: ${top3Owed} — book one this week`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Contacts" value={s.length} />
        <StatCard label="Owed a touch" value={owedTouch.length} status={owedTouch.length === 0 ? "green" : "amber"} />
        <StatCard label="Avg days since contact" value={avgDays} />
        <StatCard label="Longest gap" value={longestGap} unit="days" status="amber" />
      </div>

      <Card className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-3">
          Sorted by days since last contact (descending)
        </p>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="text-left py-2">Name</th>
              <th className="text-center py-2">Tier</th>
              <th className="text-right py-2">Cadence</th>
              <th className="text-right py-2">Last contact</th>
              <th className="text-left py-2 pl-4">Context</th>
            </tr>
          </thead>
          <tbody>
            {s.map((c) => {
              const overdue = c.lastContactDays > c.cadenceDays;
              return (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <Image src={`https://picsum.photos/seed/${c.avatarSeed}/40/40`} alt="" width={28} height={28} className="rounded-full" unoptimized />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className="text-center text-xs">T{c.tier}</td>
                  <td className="text-right text-xs text-muted-foreground">every {c.cadenceDays}d</td>
                  <td className={cn("text-right", overdue ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                    {c.lastContactDays}d ago
                  </td>
                  <td className="pl-4 text-xs text-muted-foreground">{c.context}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </ModuleShell>
  );
}
