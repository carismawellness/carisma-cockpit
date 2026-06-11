"use client";

import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { BookingMixRow } from "@/lib/types/crm";
import { BRAND, type BrandKey } from "@/lib/constants/design-tokens";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BRANDS = [
  { slug: "spa", label: "Spa" },
  { slug: "aesthetics", label: "Aesthetics" },
  { slug: "slimming", label: "Slimming" },
] as const;

// Each brand card tints its treatment bars in that brand's dark color,
// stepping opacity down per rank so treatments stay distinguishable.
function barOpacity(i: number): number {
  return Math.max(0.32, 1 - i * 0.1);
}


/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BookingMix({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { brandMap } = useLookups();

  const { data, loading } = useKPIData<BookingMixRow>({
    table: "crm_booking_mix",
    dateFrom,
    dateTo,
    brandFilter,
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-64 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  // Build brand_id -> slug lookup
  const brandIdToSlug: Record<number, string> = {};
  for (const [slug, id] of Object.entries(brandMap)) {
    brandIdToSlug[id] = slug;
  }

  // Group by brand + treatment, sum counts
  const byBrand: Record<string, Record<string, number>> = {};
  for (const row of data) {
    const slug = brandIdToSlug[row.brand_id] ?? `brand_${row.brand_id}`;
    if (!byBrand[slug]) byBrand[slug] = {};
    byBrand[slug][row.treatment_name] =
      (byBrand[slug][row.treatment_name] ?? 0) + row.count;
  }

  const visibleBrands = brandFilter
    ? BRANDS.filter((b) => b.slug === brandFilter)
    : BRANDS;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {visibleBrands.map((brand) => {
        const treatments = byBrand[brand.slug] ?? {};
        const items = Object.entries(treatments)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value);

        const total = items.reduce((s, t) => s + t.value, 0);

        const brandColor     = BRAND[brand.slug as BrandKey].soft; // bar fill
        const brandTextColor = BRAND[brand.slug as BrandKey].dark; // heading text

        return (
          <Card key={brand.slug} className="p-3 md:p-6 relative">
            <h3 className="text-base font-semibold mb-4" style={{ color: brandTextColor }}>
              {brand.label}
            </h3>
            {items.length === 0 ? (
              <p className="text-sm text-text-secondary text-center py-8">
                No data
              </p>
            ) : (
              <div className="space-y-3">
                {items.slice(0, 8).map((item, i) => {
                  const pct = total > 0 ? (item.value / total) * 100 : 0;
                  return (
                    <div key={item.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary truncate mr-2">{item.name}</span>
                        <span className="font-semibold text-foreground flex-shrink-0">
                          {item.value} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: brandColor,
                            opacity: barOpacity(i),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                {items.length > 8 && (
                  <p className="text-xs text-text-secondary text-center mt-2">
                    +{items.length - 8} more treatments
                  </p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
