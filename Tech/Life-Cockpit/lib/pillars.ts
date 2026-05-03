/**
 * Life Cockpit pillar registry. Single source of truth for nav, routing, and
 * theming. MECE: every module belongs to exactly one pillar.
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Beaker,
  HeartPulse,
  Scale,
  Dumbbell,
  Brain,
  Sparkles,
  Briefcase,
  Wallet,
  Shirt,
  Users,
  Home,
  Map as MapIcon,
  BookOpen,
  Target,
  PenLine,
} from "lucide-react";

export type ModuleId = string;
export type PillarId = "health" | "wealth" | "love";

export interface ModuleDef {
  id: ModuleId;
  slug: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  hero?: boolean;
}

export interface PillarDef {
  id: PillarId;
  name: string;
  tagline: string;
  colorClass: string;
  borderClass: string;
  bgClass: string;
  modules: ModuleDef[];
}

export const PILLARS: PillarDef[] = [
  {
    id: "health",
    name: "Health",
    tagline: "Biology, state, performance",
    colorClass: "text-emerald-700",
    borderClass: "border-emerald-200",
    bgClass: "bg-emerald-50",
    modules: [
      { id: "stack", slug: "stack", name: "Health Stack", blurb: "Supplements, protocols, regimens", icon: Beaker },
      { id: "records", slug: "records", name: "Health Records", blurb: "Labs, imaging, screening calendar, meds", icon: HeartPulse },
      { id: "whoop", slug: "whoop", name: "WHOOP Live", blurb: "Recovery, sleep, strain, HRV", icon: Activity },
      { id: "body", slug: "body", name: "Body Composition", blurb: "DEXA, weight, BP, CGM, nutrition", icon: Scale },
      { id: "performance", slug: "performance", name: "Performance", blurb: "VO2 max, lifts, grip, dead hang", icon: Dumbbell },
      { id: "mind", slug: "mind", name: "Mental & Cognitive", blurb: "Mood, meditation, cognitive baseline", icon: Brain },
      { id: "biological-age", slug: "biological-age", name: "Biological Age", blurb: "8-number longevity scorecard", icon: Sparkles, hero: true },
    ],
  },
  {
    id: "wealth",
    name: "Wealth",
    tagline: "Business + personal capital",
    colorClass: "text-slate-700",
    borderClass: "border-slate-200",
    bgClass: "bg-slate-50",
    modules: [
      { id: "business", slug: "business", name: "Business", blurb: "Live CEO Cockpit (mirrored)", icon: Briefcase },
      { id: "personal-capital", slug: "personal-capital", name: "Personal Capital", blurb: "Liquid NW + Years of Freedom", icon: Wallet },
    ],
  },
  {
    id: "love",
    name: "Love",
    tagline: "Relationships + identity + experiences",
    colorClass: "text-pink-700",
    borderClass: "border-pink-200",
    bgClass: "bg-pink-50",
    modules: [
      { id: "look-book", slug: "look-book", name: "Look Book", blurb: "Wardrobe + outfits + style", icon: Shirt },
      { id: "inner-circle", slug: "inner-circle", name: "Inner Circle", blurb: "Top 25 friends, network, mentors", icon: Users },
      { id: "family", slug: "family", name: "Family Ledger", blurb: "Family + remaining encounters", icon: Home },
      { id: "travel", slug: "travel", name: "Travel", blurb: "Map of been / want / planned", icon: MapIcon },
      { id: "hobbies", slug: "hobbies", name: "Hobbies & Learning", blurb: "Practice + reading + deep work", icon: BookOpen },
      { id: "goals", slug: "goals", name: "Goals & Vision", blurb: "Annual theme, OKRs, bucket list", icon: Target },
      { id: "reflection", slug: "reflection", name: "Reflection", blurb: "Weekly + monthly + annual review", icon: PenLine },
    ],
  },
];

export function getPillar(id: PillarId): PillarDef {
  const p = PILLARS.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown pillar: ${id}`);
  return p;
}

export function getModule(pillarId: PillarId, moduleSlug: string): ModuleDef | undefined {
  return getPillar(pillarId).modules.find((m) => m.slug === moduleSlug);
}
