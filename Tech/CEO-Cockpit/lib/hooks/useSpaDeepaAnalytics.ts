"use client";

import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StaffMember {
  name: string;
  service_revenue: number;
  retail_revenue: number;
}

export interface GuestGroupLocation {
  location_id: number;
  name: string;
  color: string;
  hotel_revenue: number;
  non_hotel_revenue: number;
  hotel_count: number;
  non_hotel_count: number;
}

export interface PaymentType {
  type: string;
  revenue: number;
  count: number;
  pct: number; // computed client-side as revenue / total_revenue * 100
}

export interface PaymentByLocation {
  location_id: number;
  name: string;
  color: string;
  payment_types: Record<string, number>;
}

export interface DiscountLocation {
  location_id: number;
  name: string;
  color: string;
  gross_list_revenue: number;
  net_unit_revenue: number;
  total_discount: number;
  discount_pct: number;
  discounted_txn_count: number;
  total_txn_count: number;
  avg_order_value: number;
}

export interface DowByLocationPoint {
  day_of_week: number;            // 1=Mon … 7=Sun
  day_label:   string;            // "Mon" / "Tue" / …
  by_location: Record<number, number>;  // location_id → revenue (inc-VAT)
}

export interface HourByLocationPoint {
  hour:        number;            // 0–23
  by_location: Record<number, number>;
}

export interface TherapistRow {
  therapist:     string;
  revenue:       number;          // inc-VAT
  service_count: number;
}

export interface ComplimentaryLocation {
  location_id:           number;
  name:                  string;
  color:                 string;
  complimentary_revenue: number;  // inc-VAT (Payment Type === "Payment Center")
  total_revenue:         number;  // inc-VAT — all payment types at this location
  complimentary_pct:     number;  // 0–100
  complimentary_count:   number;
  total_count:           number;
}

export interface SpaDeepaAnalyticsResult {
  staff: StaffMember[];
  guestGroups: GuestGroupLocation[];
  paymentTypes: PaymentType[];
  paymentByLocation: PaymentByLocation[];
  discounts: DiscountLocation[];
  byDayOfWeek:  DowByLocationPoint[];
  byHourOfDay:  HourByLocationPoint[];
  byTherapist:  TherapistRow[];
  complimentary: ComplimentaryLocation[];
  isFetching: boolean;
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── API response shape (raw) ──────────────────────────────────────────────────

interface ApiResponse {
  staff_combined: StaffMember[];
  guest_groups: GuestGroupLocation[];
  payment_types: Array<{ type: string; revenue: number; count: number }>;
  payment_by_location: PaymentByLocation[];
  discounts: DiscountLocation[];
  by_day_of_week: DowByLocationPoint[];
  by_hour_of_day: HourByLocationPoint[];
  by_therapist:   TherapistRow[];
  complimentary:  ComplimentaryLocation[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSpaDeepaAnalytics(dateFrom: Date, dateTo: Date): SpaDeepaAnalyticsResult {
  const dateFromStr = toDateStr(dateFrom);
  const dateToStr   = toDateStr(dateTo);

  const { data, isFetching, error } = useQuery<ApiResponse>({
    queryKey: ["spa-deepa-analytics", dateFromStr, dateToStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/cockpit/spa-analytics?date_from=${dateFromStr}&date_to=${dateToStr}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to fetch spa analytics");
      return json;
    },
    staleTime: 300_000, // 5 minutes
  });

  // Compute pct for each payment type
  const rawPaymentTypes = data?.payment_types ?? [];
  const totalRevenue = rawPaymentTypes.reduce((sum, pt) => sum + pt.revenue, 0);
  const paymentTypes: PaymentType[] = rawPaymentTypes.map((pt) => ({
    ...pt,
    pct: totalRevenue > 0 ? (pt.revenue / totalRevenue) * 100 : 0,
  }));

  return {
    staff:              data?.staff_combined      ?? [],
    guestGroups:        data?.guest_groups        ?? [],
    paymentTypes,
    paymentByLocation:  data?.payment_by_location ?? [],
    discounts:          data?.discounts           ?? [],
    byDayOfWeek:        data?.by_day_of_week      ?? [],
    byHourOfDay:        data?.by_hour_of_day      ?? [],
    byTherapist:        data?.by_therapist        ?? [],
    complimentary:      data?.complimentary       ?? [],
    isFetching,
    error:              error ? (error as Error).message : null,
  };
}
