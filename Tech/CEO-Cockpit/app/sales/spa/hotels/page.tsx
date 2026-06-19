"use client";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { HOTEL_SLUG_MAP } from "@/lib/constants/spa-hotel-slugs";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Hotel } from "lucide-react";

function buildHref(slug: string, searchParams: URLSearchParams): string {
  const qs = searchParams.toString();
  return `/sales/spa/hotels/${slug}${qs ? `?${qs}` : ""}`;
}

function HotelsIndexContent() {
  const searchParams = useSearchParams();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Spa Hotel Dashboards</h1>
        <p className="text-sm text-gray-500 mt-1">Select a hotel to view its venue-specific performance dashboard</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Object.entries(HOTEL_SLUG_MAP).map(([slug, hotel]) => (
          <Link
            key={slug}
            href={buildHref(slug, searchParams)}
            className="group block rounded-xl border border-gray-200 bg-white p-5 hover:shadow-md hover:border-gray-300 transition-all duration-150"
          >
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${hotel.color}22` }}
              >
                <Hotel className="h-4 w-4" style={{ color: hotel.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-gray-900">
                  {hotel.name}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Target: €{(hotel.monthlyTarget / 1000).toFixed(0)}K / month
                </p>
              </div>
            </div>
            <div
              className="mt-3 h-1 rounded-full"
              style={{ backgroundColor: `${hotel.color}33` }}
            >
              <div
                className="h-1 rounded-full"
                style={{ backgroundColor: hotel.color, width: "60%" }}
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function HotelsIndexPage() {
  return (
    <DashboardShell hideDatePicker>
      {() => <HotelsIndexContent />}
    </DashboardShell>
  );
}
