"use client";

import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { LeadReconRow } from "@/lib/types/crm";
import { isExcludedCrmDate } from "@/lib/constants/excluded-dates";
import { BRAND } from "@/lib/constants/design-tokens";

// Canonical brand palette — `dark` for primary marks (borders, CRM bar),
// `soft` for the Meta companion bar to visually pair it with the brand without
// stealing prominence from the CRM bar.
const BRAND_DARK: Record<string, string> = {
  spa:        BRAND.spa.dark,
  aesthetics: BRAND.aesthetics.dark,
  slimming:   BRAND.slimming.dark,
};
const BRAND_SOFT: Record<string, string> = {
  spa:        BRAND.spa.soft,
  aesthetics: BRAND.aesthetics.soft,
  slimming:   BRAND.slimming.soft,
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BRANDS = [
  { slug: "spa", label: "Spa" },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "slimming", label: "Slimming" },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function syncPct(crm: number, meta: number): number {
  if (meta === 0 && crm === 0) return 100;
  const max = Math.max(crm, meta);
  if (max === 0) return 100;
  const min = Math.min(crm, meta);
  return (min / max) * 100;
}

function syncColor(pct: number): string {
  if (pct >= 95) return "#16A34A"; // green
  if (pct >= 80) return "#F59E0B"; // amber
  return "#DC2626"; // red
}

function syncTextColor(pct: number): string {
  if (pct >= 95) return "text-emerald-600";
  if (pct >= 80) return "text-amber-600";
  return "text-red-600";
}

function syncBgColor(pct: number): string {
  if (pct >= 95) return "bg-emerald-100 text-emerald-800";
  if (pct >= 80) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function syncLabel(pct: number): string {
  if (pct >= 95) return "Synced";
  if (pct >= 80) return "Minor Gap";
  return "Out of Sync";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LeadReconciliation({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { brandMap } = useLookups();

  const { data, loading } = useKPIData<LeadReconRow>({
    table: "crm_lead_reconciliation",
    dateFrom,
    dateTo,
    brandFilter,
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  // Build brand_id -> slug lookup
  const brandIdToSlug: Record<number, string> = {};
  for (const [slug, id] of Object.entries(brandMap)) {
    brandIdToSlug[id] = slug;
  }

  // Aggregate per brand
  const brandTotals: Record<string, { crmLeads: number; metaLeads: number }> = {};
  for (const brand of BRANDS) {
    brandTotals[brand.slug] = { crmLeads: 0, metaLeads: 0 };
  }
  for (const row of data) {
    if (isExcludedCrmDate(row.date)) continue;
    const slug = brandIdToSlug[row.brand_id];
    if (slug && brandTotals[slug]) {
      brandTotals[slug].crmLeads += row.leads_crm;
      brandTotals[slug].metaLeads += row.leads_meta;
    }
  }

  // Alert: any brand badly out of sync?
  const alertBrands = BRANDS.filter((b) => {
    const t = brandTotals[b.slug];
    return syncPct(t.crmLeads, t.metaLeads) < 80;
  });

  const visibleBrands = brandFilter
    ? BRANDS.filter((b) => b.slug === brandFilter)
    : BRANDS;

  return (
    <div className="space-y-4">
      {/* Alert banner */}
      {alertBrands.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Sync issue:</span>{" "}
          {alertBrands.map((b) => b.label).join(", ")} —
          CRM and Meta lead counts are significantly mismatched. Investigate missing leads.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {visibleBrands.map((brand) => {
          const t = brandTotals[brand.slug];
          const pct = syncPct(t.crmLeads, t.metaLeads);
          const delta = t.crmLeads - t.metaLeads;
          const max = Math.max(t.crmLeads, t.metaLeads, 1);

          return (
            <Card
              key={brand.slug}
              className="p-5 border-l-4"
              style={{
                borderLeftColor: BRAND_DARK[brand.slug] ?? "#888",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary">
                  {brand.label}
                </h3>
                <span className={`text-xs font-bold px-2 py-1 rounded ${syncBgColor(pct)}`}>
                  {syncLabel(pct)}
                </span>
              </div>

              {/* Sync ring / percentage */}
              <div className="flex items-center gap-4 mb-4">
                <div className="relative w-16 h-16 flex-shrink-0">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="#E5E7EB"
                      strokeWidth="3"
                    />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke={syncColor(pct)}
                      strokeWidth="3"
                      strokeDasharray={`${pct}, 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${syncTextColor(pct)}`}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="flex-1 text-sm text-text-secondary">
                  {delta === 0
                    ? "Perfectly synced"
                    : delta > 0
                    ? `${Math.abs(delta)} more in CRM`
                    : `${Math.abs(delta)} missing from CRM`}
                </div>
              </div>

              {/* Bar comparison */}
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-secondary">CRM Leads</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {t.crmLeads.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(t.crmLeads / max) * 100}%`,
                        backgroundColor: BRAND_DARK[brand.slug] ?? "#888",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-secondary">Meta Leads</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {t.metaLeads.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(t.metaLeads / max) * 100}%`,
                        backgroundColor: BRAND_SOFT[brand.slug] ?? "#D4D4D4",
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
