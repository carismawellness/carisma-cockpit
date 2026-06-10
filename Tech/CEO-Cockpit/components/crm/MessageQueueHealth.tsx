"use client";

import { Card } from "@/components/ui/card";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { useLookups } from "@/lib/hooks/useLookups";
import { chartColors } from "@/lib/charts/config";
import type { CrmDailyRow } from "@/lib/types/crm";

const BRANDS = ["spa", "aesthetics", "slimming"] as const;

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

function statusLabel(count: number): string {
  if (count < 10) return "Healthy";
  if (count <= 50) return "Needs attention";
  return "Critical";
}

function statusColor(count: number): string {
  if (count < 10) return "text-emerald-600";
  if (count <= 50) return "text-amber-500";
  return "text-red-600";
}

function statusBg(count: number): string {
  if (count < 10) return "bg-emerald-50 border-emerald-200";
  if (count <= 50) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

export function MessageQueueHealth({
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { brandMap } = useLookups();

  // GHL unread count is a real-time daily snapshot — always query today, not the filtered range
  const today = new Date();
  const { data, loading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom: today,
    dateTo: today,
    brandFilter,
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-36 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  // Latest day's snapshot per brand (unreplied_whatsapp = GHL unread total)
  const sortedDates = [...new Set(data.map((r) => r.date))].sort();
  const latestDate = sortedDates[sortedDates.length - 1] ?? null;
  const latestRows = latestDate ? data.filter((r) => r.date === latestDate) : [];

  const visibleBrands = brandFilter
    ? BRANDS.filter((b) => b === brandFilter)
    : [...BRANDS];

  const brandData = visibleBrands.map((slug) => {
    const bid = brandMap[slug];
    const rows = latestRows.filter((r) => r.brand_id === bid);
    const unread = rows.reduce((sum, r) => sum + (r.unreplied_whatsapp ?? 0), 0);
    return { slug, label: BRAND_LABELS[slug], unread };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {brandData.map((b) => (
        <Card
          key={b.slug}
          className="p-5 border-l-4"
          style={{
            borderLeftColor:
              chartColors[b.slug as keyof typeof chartColors] ?? "#888",
          }}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-4">
            {b.label}
          </h3>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-4xl font-bold text-text-primary">{b.unread}</p>
              <p className="text-xs text-text-secondary mt-1">GHL unread conversations</p>
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor(b.unread)} ${statusBg(b.unread)}`}
            >
              {statusLabel(b.unread)}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
