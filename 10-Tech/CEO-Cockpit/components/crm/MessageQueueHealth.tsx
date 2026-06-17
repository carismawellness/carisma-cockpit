"use client";

import { Card } from "@/components/ui/card";
import { useGhlSnapshot } from "@/lib/hooks/useGhlSnapshot";
import { BRAND } from "@/lib/constants/design-tokens";

const BRANDS = ["spa", "aesthetics", "slimming"] as const;

const BRAND_LABELS: Record<string, string> = {
  spa: "Spa",
  aesthetics: "Aesthetics",
  slimming: "Slimming",
};

// Canonical brand palette — `soft` for left-border accents.
const BRAND_BORDER: Record<string, string> = {
  spa:        BRAND.spa.soft,
  aesthetics: BRAND.aesthetics.soft,
  slimming:   BRAND.slimming.soft,
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
  const { snapshot, isLoading } = useGhlSnapshot();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  const visibleBrands = brandFilter
    ? BRANDS.filter((b) => b === brandFilter)
    : [...BRANDS];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {visibleBrands.map((slug) => {
        const brandSnap = snapshot[slug as keyof typeof snapshot];
        const unread = brandSnap.unreadWhatsapp;
        const totalMessages =
          brandSnap.unreadWhatsapp + brandSnap.unreadCrm + brandSnap.unreadEmail;
        return (
          <Card
            key={slug}
            className="p-5 border-l-4"
            style={{ borderLeftColor: BRAND_BORDER[slug] ?? "#888" }}
          >
            <h3 className="text-sm font-semibold uppercase tracking-wider text-text-secondary mb-4">
              {BRAND_LABELS[slug]}
            </h3>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-4xl font-bold text-text-primary">{unread}</p>
                <p className="text-xs text-text-secondary mt-1">GHL unread conversations</p>
              </div>
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColor(unread)} ${statusBg(unread)}`}
              >
                {statusLabel(unread)}
              </span>
            </div>

            {/* Secondary metrics */}
            <div className="mt-3 pt-3 border-t border-dashed grid grid-cols-3 gap-2">
              {[
                { label: "Messages",  value: totalMessages },
                { label: "New Leads", value: brandSnap.newLeads },
                { label: "To-Do",     value: brandSnap.todoCount },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-lg font-bold text-foreground">{value}</p>
                  <p className="text-[10px] text-text-secondary uppercase tracking-wide mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
