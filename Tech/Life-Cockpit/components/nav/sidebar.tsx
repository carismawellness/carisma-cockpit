"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronRight, LayoutDashboard } from "lucide-react";
import { PILLARS, type PillarId } from "@/lib/pillars";
import { cn } from "@/lib/utils";

const PILLAR_ACCENT: Record<PillarId, string> = {
  health: "text-emerald-600",
  wealth: "text-slate-600",
  love: "text-pink-600",
};

export function Sidebar() {
  const pathname = usePathname();
  const initialExpanded = (): Set<PillarId> => {
    const s = new Set<PillarId>();
    for (const p of PILLARS) {
      if (pathname.startsWith(`/${p.id}`)) s.add(p.id);
    }
    if (s.size === 0) s.add("health");
    return s;
  };
  const [expanded, setExpanded] = useState<Set<PillarId>>(initialExpanded);

  const toggle = (id: PillarId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-sidebar h-screen sticky top-0 overflow-y-auto">
      <div className="p-4 border-b border-border">
        <Link href="/" className="block">
          <div className="font-semibold text-base tracking-tight">Life Cockpit</div>
          <div className="text-[11px] text-muted-foreground">Health · Wealth · Love</div>
        </Link>
      </div>

      <nav className="p-2 text-sm">
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-md hover:bg-sidebar-accent transition-colors",
            pathname === "/" && "bg-sidebar-accent font-medium"
          )}
        >
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
          <span>Today</span>
        </Link>

        <div className="mt-3 space-y-1">
          {PILLARS.map((pillar) => {
            const isExpanded = expanded.has(pillar.id);
            const Icon = isExpanded ? ChevronDown : ChevronRight;
            const isActive = pathname.startsWith(`/${pillar.id}`);
            return (
              <div key={pillar.id}>
                <button
                  type="button"
                  onClick={() => toggle(pillar.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-sidebar-accent transition-colors text-left",
                    isActive && "font-medium"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className={cn("flex-1", PILLAR_ACCENT[pillar.id])}>{pillar.name}</span>
                  <span className="text-[10px] text-muted-foreground">{pillar.modules.length}</span>
                </button>

                {isExpanded && (
                  <div className="ml-6 mt-0.5 space-y-0.5 border-l border-border pl-2">
                    <Link
                      href={`/${pillar.id}`}
                      className={cn(
                        "block px-2 py-1.5 rounded-md text-xs hover:bg-sidebar-accent transition-colors text-muted-foreground",
                        pathname === `/${pillar.id}` && "bg-sidebar-accent text-foreground font-medium"
                      )}
                    >
                      Overview
                    </Link>
                    {pillar.modules.map((m) => {
                      const href = `/${pillar.id}/${m.slug}`;
                      const isOn = pathname === href || pathname.startsWith(`${href}/`);
                      const M = m.icon;
                      return (
                        <Link
                          key={m.id}
                          href={href}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-sidebar-accent transition-colors",
                            isOn ? "bg-sidebar-accent text-foreground font-medium" : "text-muted-foreground"
                          )}
                        >
                          <M className="h-3 w-3 shrink-0" />
                          <span className="truncate">{m.name}</span>
                          {m.hero && (
                            <span className="ml-auto text-[9px] uppercase tracking-wider text-amber-600">★</span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
