import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

interface OrderRow {
  created_date: string;
  total: number;
}

export async function GET() {
  const supabase = getAdminClient();

  // Fetch ALL paid orders — fetchAll paginates to bypass the 10k row cap
  const rows = await fetchAll<OrderRow>(
    (offset, limit) =>
      supabase
        .from("wix_spa_orders")
        .select("created_date, total")
        .eq("payment_status", "PAID")
        .order("created_date", { ascending: true })
        .range(offset, offset + limit - 1),
    "wix_spa_orders",
  );

  // Aggregate by month key "YYYY-MM"
  const byMonth = new Map<string, { total: number; orders: number }>();
  for (const row of rows) {
    const month = row.created_date.slice(0, 7);
    const existing = byMonth.get(month) ?? { total: 0, orders: 0 };
    byMonth.set(month, {
      total: existing.total + (Number(row.total) || 0),
      orders: existing.orders + 1,
    });
  }

  // Build sorted monthly series with LY lookup
  const months = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b));

  const monthly = months.map(([month, { total, orders }]) => {
    const [year, mon] = month.split("-");
    const lyMonth = `${parseInt(year) - 1}-${mon}`;
    const ly = byMonth.get(lyMonth);
    const yoyPct = ly && ly.total > 0 ? ((total - ly.total) / ly.total) * 100 : null;

    const date = new Date(`${month}-15`);
    const label =
      date.toLocaleString("en-US", { month: "short" }) + " '" + year.slice(2);

    return {
      month,
      label,
      current: Math.round(total * 100) / 100,
      ly: ly ? Math.round(ly.total * 100) / 100 : 0,
      orders,
      lyOrders: ly?.orders ?? 0,
      yoyPct: yoyPct !== null ? Math.round(yoyPct * 10) / 10 : null,
    };
  });

  // Aggregate by week — key = Monday date string "YYYY-MM-DD"
  const byWeek = new Map<string, { total: number; orders: number }>();
  for (const row of rows) {
    const d = new Date(row.created_date);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // days to Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const weekKey = monday.toISOString().slice(0, 10);
    const existing = byWeek.get(weekKey) ?? { total: 0, orders: 0 };
    byWeek.set(weekKey, {
      total: existing.total + (Number(row.total) || 0),
      orders: existing.orders + 1,
    });
  }

  // Build sorted weekly series with LY comparison (same ISO week, -52 weeks = -364 days)
  const sortedWeeks = Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b));

  const weekly = sortedWeeks.map(([weekStart, { total, orders }]) => {
    // LY week = exactly 52 weeks earlier (364 days)
    const lyDate = new Date(weekStart);
    lyDate.setDate(lyDate.getDate() - 364);
    const lyKey = lyDate.toISOString().slice(0, 10);
    const ly = byWeek.get(lyKey);

    const lyTotal = ly?.total ?? 0;
    const yoyDelta = total - lyTotal;
    const yoyPct = lyTotal > 0 ? ((total - lyTotal) / lyTotal) * 100 : null;

    const d = new Date(weekStart);
    const label = d.toLocaleString("en-US", { month: "short", day: "numeric" });

    return {
      weekStart,
      label,
      current: Math.round(total * 100) / 100,
      ly: Math.round(lyTotal * 100) / 100,
      orders,
      lyOrders: ly?.orders ?? 0,
      yoyDelta: Math.round(yoyDelta * 100) / 100,
      yoyPct: yoyPct !== null ? Math.round(yoyPct * 10) / 10 : null,
    };
  });

  // Build daily series — last 90 days, with same day LY
  const today = new Date();
  const day90 = new Date(today);
  day90.setDate(today.getDate() - 90);
  const day90Str = day90.toISOString().slice(0, 10);

  // byDate already from rows — just filter to last 90 days
  const byDate = new Map<string, { total: number; orders: number }>();
  for (const row of rows) {
    if (row.created_date < day90Str) continue;
    const existing = byDate.get(row.created_date) ?? { total: 0, orders: 0 };
    byDate.set(row.created_date, {
      total: existing.total + (Number(row.total) || 0),
      orders: existing.orders + 1,
    });
  }

  const sortedDays = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));

  const daily = sortedDays.map(([date, { total, orders }]) => {
    const lyDate = new Date(date);
    lyDate.setFullYear(lyDate.getFullYear() - 1);
    const lyKey = lyDate.toISOString().slice(0, 10);
    const lyEntry = rows
      .filter((r) => r.created_date === lyKey)
      .reduce(
        (acc, r) => ({ total: acc.total + Number(r.total), orders: acc.orders + 1 }),
        { total: 0, orders: 0 },
      );
    const lyTotal = lyEntry.total;
    const yoyPct = lyTotal > 0 ? ((total - lyTotal) / lyTotal) * 100 : null;

    const d = new Date(date);
    const label = d.toLocaleString("en-US", { month: "short", day: "numeric" });

    return {
      date,
      label,
      current: Math.round(total * 100) / 100,
      ly: Math.round(lyTotal * 100) / 100,
      orders,
      lyOrders: lyEntry.orders,
      yoyPct: yoyPct !== null ? Math.round(yoyPct * 10) / 10 : null,
    };
  });

  return NextResponse.json({ monthly, weekly, daily });
}
