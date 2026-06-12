import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getAdminClient();

  // Pull last 40 months of PAID orders (2 columns only — minimise payload)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 40);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("wix_spa_orders")
    .select("created_date, total")
    .eq("payment_status", "PAID")
    .gte("created_date", cutoffStr)
    .order("created_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aggregate by month key "YYYY-MM"
  const byMonth = new Map<string, { total: number; orders: number }>();
  for (const row of (data ?? []) as { created_date: string; total: number }[]) {
    const month = (row.created_date as string).slice(0, 7);
    const existing = byMonth.get(month) ?? { total: 0, orders: 0 };
    byMonth.set(month, {
      total: existing.total + (Number(row.total) || 0),
      orders: existing.orders + 1,
    });
  }

  // Aggregate by week key "YYYY-WW" for weekly view (last 52 weeks)
  const weekCutoff = new Date();
  weekCutoff.setDate(weekCutoff.getDate() - 365);
  const weekCutoffStr = weekCutoff.toISOString().slice(0, 10);

  const { data: weekData } = await supabase
    .from("wix_spa_orders")
    .select("created_date, total")
    .eq("payment_status", "PAID")
    .gte("created_date", weekCutoffStr)
    .order("created_date", { ascending: true });

  const byWeek = new Map<string, { total: number; orders: number; weekStart: string }>();
  for (const row of (weekData ?? []) as { created_date: string; total: number }[]) {
    const d = new Date(row.created_date as string);
    // ISO week start = Monday
    const day = d.getDay(); // 0=Sun, 1=Mon...
    const diff = (day === 0 ? -6 : 1 - day); // days to Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    const weekKey = monday.toISOString().slice(0, 10); // "YYYY-MM-DD" of Monday
    const existing = byWeek.get(weekKey) ?? { total: 0, orders: 0, weekStart: weekKey };
    byWeek.set(weekKey, {
      total: existing.total + (Number(row.total) || 0),
      orders: existing.orders + 1,
      weekStart: weekKey,
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

  // Build sorted weekly series
  const weekly = Array.from(byWeek.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map(({ weekStart, total, orders }) => {
      const d = new Date(weekStart);
      const label = d.toLocaleString("en-US", { month: "short", day: "numeric" });
      return {
        weekStart,
        label,
        current: Math.round(total * 100) / 100,
        orders,
      };
    });

  return NextResponse.json({ monthly, weekly });
}
