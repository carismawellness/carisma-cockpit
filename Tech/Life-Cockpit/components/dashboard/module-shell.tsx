import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getPillar, type PillarId } from "@/lib/pillars";

/**
 * Standard chrome wrapped around every module page. Enforces "minimum
 * effective dose" by giving every module a single page header with: pillar
 * breadcrumb, module name, one-line "what it shows", and the optional
 * "decision" callout.
 */
export function ModuleShell({
  pillarId,
  moduleSlug,
  decision,
  children,
}: {
  pillarId: PillarId;
  moduleSlug: string;
  decision?: string;
  children: React.ReactNode;
}) {
  const pillar = getPillar(pillarId);
  const mod = pillar.modules.find((m) => m.slug === moduleSlug);
  if (!mod) {
    return <div className="text-sm text-muted-foreground">Module not found.</div>;
  }
  const Icon = mod.icon;
  return (
    <>
      <div className="space-y-1">
        <Link
          href={`/${pillar.id}`}
          className={`inline-flex items-center gap-1 text-xs ${pillar.colorClass} hover:underline`}
        >
          <ChevronLeft className="h-3 w-3" />
          {pillar.name}
        </Link>
        <div className="flex items-center gap-2">
          <Icon className={`h-6 w-6 ${pillar.colorClass}`} />
          <h1 className="text-2xl font-bold tracking-tight">{mod.name}</h1>
          {mod.hero && (
            <span className="text-[10px] uppercase tracking-wider text-amber-600 border border-amber-300 rounded px-1.5 py-0.5">
              Hero
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{mod.blurb}</p>
      </div>

      {decision && (
        <div className={`rounded-md border-l-4 ${pillar.borderClass} ${pillar.bgClass} px-4 py-3`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Decision</div>
          <div className="text-sm font-medium">{decision}</div>
        </div>
      )}

      <div className="space-y-6">{children}</div>
    </>
  );
}
