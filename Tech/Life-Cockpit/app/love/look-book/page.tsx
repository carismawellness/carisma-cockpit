"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { ModuleShell } from "@/components/dashboard/module-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import { lookBookSeed, garmentImage, type GarmentCategory } from "@/lib/seed/love/look-book";
import { cn } from "@/lib/utils";

const TABS = ["Closet", "Outfits", "Plan"] as const;
type Tab = (typeof TABS)[number];
const CATEGORIES: (GarmentCategory | "All")[] = ["All", "Tops", "Bottoms", "Outerwear", "Footwear", "Accessories", "Tailoring"];

export default function LookBookPage() {
  const s = lookBookSeed;
  const [tab, setTab] = useState<Tab>("Closet");
  const [filter, setFilter] = useState<GarmentCategory | "All">("All");

  const totalGarments = s.garments.length;
  const outfitsCount = s.outfits.length;
  const avgCpw = +(s.garments.reduce((sum, g) => sum + g.costPerWear, 0) / totalGarments).toFixed(2);
  const underused = s.garments.filter((g) => g.wornInLast90 < 2).length;

  const filteredGarments = useMemo(
    () => (filter === "All" ? s.garments : s.garments.filter((g) => g.category === filter)),
    [filter, s.garments]
  );

  return (
    <ModuleShell
      pillarId="love"
      moduleSlug="look-book"
      decision="Underused: linen blazer not worn in 87 days — try with white shirt + chinos this week"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Garments" value={totalGarments} />
        <StatCard label="Outfits saved" value={outfitsCount} />
        <StatCard label="Avg cost-per-wear" value={`€${avgCpw}`} />
        <StatCard label="Underused (<2 in 90d)" value={underused} status="amber" />
      </div>

      <div className="border-b border-border flex gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              t === tab ? "border-pink-600 text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Closet" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={cn(
                  "text-xs px-3 py-1 rounded-full border transition-colors",
                  filter === c ? "bg-pink-50 border-pink-300 text-pink-700" : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {filteredGarments.map((g) => (
              <Card key={g.id} className="overflow-hidden p-0">
                <div className="relative w-full aspect-[3/4] bg-muted">
                  <Image src={garmentImage(g.id)} alt={g.name} fill className="object-cover" sizes="200px" unoptimized />
                </div>
                <div className="p-2 space-y-0.5">
                  <p className="text-xs font-medium truncate">{g.name}</p>
                  <p className="text-[10px] text-muted-foreground">{g.brand} · {g.color}</p>
                  <p className="text-[10px] text-muted-foreground">F{g.formality} · {g.season} · €{g.costPerWear}/wear</p>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {tab === "Outfits" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {s.outfits.map((o) => (
            <Card key={o.id} className="p-3">
              <div className="grid grid-cols-2 gap-1 mb-3">
                {o.garmentIds.slice(0, 4).map((gid) => (
                  <div key={gid} className="relative aspect-square bg-muted rounded overflow-hidden">
                    <Image src={garmentImage(gid, 150, 150)} alt={gid} fill className="object-cover" sizes="100px" unoptimized />
                  </div>
                ))}
              </div>
              <p className="font-medium text-sm">{o.name}</p>
              <p className="text-[11px] text-muted-foreground">{o.occasion} · {"★".repeat(o.rating)} · last worn {o.lastWorn}</p>
            </Card>
          ))}
        </div>
      )}

      {tab === "Plan" && (
        <div className="space-y-4">
          <Card className="p-4 bg-pink-50 border-pink-200">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Today · {s.weather.source}</p>
            <p className="text-2xl font-bold">{s.weather.tempC}°C · {s.weather.condition}</p>
          </Card>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suggested for the weather</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {s.outfits.slice(0, 3).map((o) => (
              <Card key={o.id} className="p-3">
                <div className="grid grid-cols-2 gap-1 mb-3">
                  {o.garmentIds.slice(0, 4).map((gid) => (
                    <div key={gid} className="relative aspect-square bg-muted rounded overflow-hidden">
                      <Image src={garmentImage(gid, 150, 150)} alt={gid} fill className="object-cover" sizes="100px" unoptimized />
                    </div>
                  ))}
                </div>
                <p className="text-sm font-medium">{o.name}</p>
                <p className="text-[11px] text-muted-foreground">{o.occasion}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </ModuleShell>
  );
}
