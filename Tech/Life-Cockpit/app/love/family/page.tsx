import Image from "next/image";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { Card } from "@/components/ui/card";
import { familySeed, remainingEncounters } from "@/lib/seed/love/family";

export default function FamilyPage() {
  const s = familySeed;
  const mum = s.find((m) => m.id === "f1")!;
  const dad = s.find((m) => m.id === "f2")!;
  const mumRemaining = remainingEncounters(mum);
  const dadRemaining = remainingEncounters(dad);

  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="family"
      decision="Mum overdue 11d; Dad birthday in 14 days — book gift now"
    >
      <Card className="p-6 border-2 border-pink-200 bg-pink-50">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">The brutal arithmetic</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          At your current visit cadence, this is roughly how many more times you&apos;ll see your parents.
          (Tail-end framing — Tim Urban, 2015.)
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Mum (age {mum.age}, {mum.visitsPerYear} visits/yr)</p>
            <p className="text-4xl font-bold text-pink-700">~{mumRemaining}</p>
            <p className="text-[11px] text-muted-foreground">remaining encounters</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dad (age {dad.age}, {dad.visitsPerYear} visits/yr)</p>
            <p className="text-4xl font-bold text-pink-700">~{dadRemaining}</p>
            <p className="text-[11px] text-muted-foreground">remaining encounters</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {s.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <Image src={`https://picsum.photos/seed/${m.avatarSeed}/60/60`} alt="" width={44} height={44} className="rounded-full" unoptimized />
              <div>
                <p className="font-semibold text-sm">{m.name}</p>
                <p className="text-[11px] text-muted-foreground">{m.relationship} · {m.age}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Last contact <span className="text-foreground font-medium">{m.lastContactDays}d ago</span></p>
            <p className="text-xs text-muted-foreground">Cadence target: {m.visitsPerYear}/yr</p>
            {m.upcomingEvent && (
              <p className="text-[11px] mt-2 text-pink-700 font-medium">{m.upcomingEvent}</p>
            )}
          </Card>
        ))}
      </div>
    </ModuleShell>
  );
}
