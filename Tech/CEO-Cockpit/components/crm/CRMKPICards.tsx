"use client";

import { KPICardRow, KPIData } from "@/components/dashboard/KPICardRow";
import { useKPIData } from "@/lib/hooks/useKPIData";
import { formatCurrency } from "@/lib/charts/config";
import type { CrmDailyRow } from "@/lib/types/crm";

export function CRMKPICards({
  dateFrom,
  dateTo,
  brandFilter,
}: {
  dateFrom: Date;
  dateTo: Date;
  brandFilter: string | null;
}) {
  const { data, loading } = useKPIData<CrmDailyRow>({
    table: "crm_daily",
    dateFrom,
    dateTo,
    brandFilter,
  });

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  // --- Compute latest day for point-in-time metrics ---
  const sortedDates = [...new Set(data.map((r) => r.date))].sort();
  const latestDate = sortedDates[sortedDates.length - 1] ?? null;
  const latestRows = latestDate ? data.filter((r) => r.date === latestDate) : [];

  // --- Total Leads (sum across entire period) ---
  const totalLeads = data.reduce((sum, r) => sum + (r.total_leads ?? 0), 0);

  // --- Unworked Leads (latest day only) ---
  const unworkedLeads = latestRows.reduce(
    (sum, r) => sum + (r.unworked_leads ?? 0),
    0,
  );

  // --- Total Sales (sum across period) ---
  const totalSales = data.reduce((sum, r) => sum + (r.total_sales ?? 0), 0);

  // --- Total Bookings (sum across period) ---
  const totalBookings = data.reduce(
    (sum, r) => sum + (r.appointments_booked ?? 0),
    0,
  );

  // --- Booking Target (dynamic: 20% conversion of total leads) ---
  const BOOKING_CONVERSION_TARGET = 0.20;
  const DAILY_BOOKING_MIN = 8;
  const DAILY_BOOKING_MAX = 10;
  const numDays = sortedDates.length || 1;
  const leadBasedTarget = Math.round(totalLeads * BOOKING_CONVERSION_TARGET);
  const dailyFloorTarget = numDays * DAILY_BOOKING_MIN;
  // Use the higher of lead-based or daily-floor target
  const bookingTarget = Math.max(leadBasedTarget, dailyFloorTarget);
  const dailyBookingRate = numDays > 0 ? totalBookings / numDays : 0;

  // --- Deposit % (weighted average: sum(deposit_pct * total_sales) / sum(total_sales)) ---
  let depositWeightedSum = 0;
  let depositWeightTotal = 0;
  for (const r of data) {
    if (r.deposit_pct !== null && r.total_sales !== null && r.total_sales > 0) {
      depositWeightedSum += r.deposit_pct * r.total_sales;
      depositWeightTotal += r.total_sales;
    }
  }
  const depositPct =
    depositWeightTotal > 0 ? depositWeightedSum / depositWeightTotal : 0;

  const kpis: KPIData[] = [
    {
      label: "Total Leads",
      value: totalLeads.toLocaleString(),
    },
    {
      label: "Unworked Leads",
      value: unworkedLeads.toLocaleString(),
    },
    {
      label: "Total Sales",
      value: formatCurrency(totalSales),
    },
    {
      label: "Total Bookings",
      value: `${totalBookings.toLocaleString()} (${dailyBookingRate.toFixed(1)}/day)`,
      target: `${bookingTarget} (${DAILY_BOOKING_MIN}–${DAILY_BOOKING_MAX}/day · 20% conv)`,
      targetValue: bookingTarget,
      currentValue: totalBookings,
    },
    {
      label: "Deposit %",
      value: `${depositPct.toFixed(1)}%`,
      target: "70%+",
      targetValue: 70,
      currentValue: depositPct,
    },
  ];

  return <KPICardRow kpis={kpis} />;
}
