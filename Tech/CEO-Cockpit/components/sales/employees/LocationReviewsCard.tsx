"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND } from "@/lib/constants/design-tokens";
import { useLocationReviews } from "@/lib/hooks/useLocationReviews";

// ── Props ────────────────────────────────────────────────────────────────────

interface LocationReviewsCardProps {
  locationId: number | null;
  locationName: string | null;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipPayloadEntry {
  payload?: {
    date?: string;
    total_reviews?: number;
    avg_rating?: number;
  };
}

function ReviewTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-amber-900">{d.date}</p>
      <p className="text-gray-700">Reviews: <span className="font-medium">{d.total_reviews}</span></p>
      <p className="text-gray-700">Rating: <span className="font-medium">{d.avg_rating?.toFixed(1)} ⭐</span></p>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function LocationReviewsCard({
  locationId,
  locationName,
}: LocationReviewsCardProps) {
  const {
    data,
    currentRating,
    currentReviews,
    reviewsGainedThisMonth,
    isLoading,
    isError,
  } = useLocationReviews(locationId);

  const displayName = locationName ?? "this location";
  const lineColor = BRAND.spa.dark;

  // ── Not assigned ─────────────────────────────────────────────────────────
  if (locationId == null) {
    return (
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900">
            ⭐ Google Reviews
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-amber-700">
            Location not assigned yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900">
            ⭐ Google Reviews — {displayName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 flex-1 animate-pulse rounded-lg bg-amber-100"
              />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-lg bg-amber-100" />
        </CardContent>
      </Card>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900">
            ⭐ Google Reviews — {displayName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-red-500">
            Could not load review data.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── No data ───────────────────────────────────────────────────────────────
  if (data.length === 0) {
    return (
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-amber-900">
            ⭐ Google Reviews — {displayName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-amber-700">
            Review data coming soon.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Thin out x-axis labels to avoid crowding: show every ~7th label
  const labelInterval = Math.max(0, Math.floor(data.length / 7) - 1);

  // ── Full card ─────────────────────────────────────────────────────────────
  return (
    <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-amber-900">
          ⭐ Google Reviews — {displayName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-white/70 px-3 py-2 text-center shadow-sm">
            <p className="text-xs text-amber-700">Current Rating</p>
            <p className="text-2xl font-bold text-amber-500">
              {currentRating != null ? currentRating.toFixed(1) : "—"}
            </p>
            <p className="text-[10px] text-amber-600">⭐ out of 5</p>
          </div>
          <div className="rounded-lg bg-white/70 px-3 py-2 text-center shadow-sm">
            <p className="text-xs text-amber-700">Total Reviews</p>
            <p className="text-2xl font-bold text-amber-900">
              {currentReviews != null ? currentReviews.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] text-amber-600">💬 all time</p>
          </div>
          <div className="rounded-lg bg-white/70 px-3 py-2 text-center shadow-sm">
            <p className="text-xs text-amber-700">This Month</p>
            <p className="text-2xl font-bold text-green-600">
              +{reviewsGainedThisMonth}
            </p>
            <p className="text-[10px] text-green-600">📈 new reviews</p>
          </div>
        </div>

        {/* Line chart */}
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#FDE68A" />
              <XAxis
                dataKey="weekLabel"
                tick={{ fontSize: 10, fill: "#92400E" }}
                interval={labelInterval}
              />
              <YAxis
                dataKey="total_reviews"
                tick={{ fontSize: 10, fill: "#92400E" }}
                width={40}
                className="hidden sm:block"
              />
              <Tooltip content={<ReviewTooltip />} />
              <Line
                type="monotone"
                dataKey="total_reviews"
                stroke={lineColor}
                strokeWidth={2}
                dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Rating trend footer */}
        {currentRating != null && (
          <p className="text-center text-xs text-amber-700">
            Rating: <span className="font-semibold">{currentRating.toFixed(1)}</span> ⭐
            &mdash; {displayName} guests love their experience!
          </p>
        )}
      </CardContent>
    </Card>
  );
}
