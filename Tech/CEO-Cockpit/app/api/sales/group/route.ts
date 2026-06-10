// app/api/sales/group/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Spa location display names (mirrors SPA_LOCATION_META in useSpaRevenue.ts)
const SPA_LOC_META: Record<number, { name: string; color: string }> = {
  1: { name: "Inter",     color: "#1B3A4B" },
  2: { name: "Hugos",     color: "#96B2B2" },
  3: { name: "Hyatt",     color: "#B79E61" },
  4: { name: "Ramla",     color: "#8EB093" },
  5: { name: "Riviera",   color: "#E07A5F" },
  6: { name: "Odycy",     color: "#4A90D9" },
  7: { name: "Excelsior", color: "#7C3AED" },
  8: { name: "Novotel",   color: "#DC2626" },
};

type SpaRevenueRow = {
  services:          number | null;
  product_phytomer:  number | null;
  product_purest:    number | null;
  product_other:     number | null;
  wholesale:         number | null;
  sales_discount:    number | null;
  sales_refund:      number | null;
};

const SPA_REVENUE_COLUMNS = "services, product_phytomer, product_purest, product_other, wholesale, sales_discount, sales_refund";

function computeSpaNetRevenue(r: SpaRevenueRow): number {
  return (r.services ?? 0)
    + (r.product_phytomer ?? 0)
    + (r.product_purest   ?? 0)
    + (r.product_other    ?? 0)
    + (r.wholesale        ?? 0)
    - (r.sales_discount   ?? 0)
    - (r.sales_refund     ?? 0);
}

// Trailing months window for the monthly time series (current month + 12 prior).
const TRAILING_MONTHS = 13;

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toMonthStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Spa revenue for a date window: returns { total, byLocation }
async function fetchSpaRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  from: string,
  to: string
) {
  const { data, error } = await supabase
    .from("spa_revenue_monthly")
    .select(`location_id, ${SPA_REVENUE_COLUMNS}`)
    .gte("month", from)
    .lte("month", to);

  if (error) throw error;

  const rows = data ?? [];
  const locMap = new Map<number, number>();
  let total = 0;

  for (const r of rows) {
    const net = computeSpaNetRevenue(r);
    locMap.set(r.location_id, (locMap.get(r.location_id) ?? 0) + net);
    total += net;
  }

  const byLocation = Array.from(locMap.entries())
    .map(([id, revenue]) => ({
      location_id: id,
      name:  SPA_LOC_META[id]?.name  ?? `Location ${id}`,
      color: SPA_LOC_META[id]?.color ?? "#888",
      revenue: Math.round(revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return { total: Math.round(total), byLocation };
}

// Daily-sales revenue for a date window: returns total (price_ex_vat).
// Shared between aesthetics_sales_daily and slimming_sales_daily — identical shape.
async function fetchDailySalesRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  table: "aesthetics_sales_daily" | "slimming_sales_daily",
  fromDateStr: string,
  toDateStr: string
) {
  const fromMonth = fromDateStr.substring(0, 7) + "-01";
  const toMonth   = toDateStr.substring(0, 7)   + "-01";

  const { data, error } = await supabase
    .from(table)
    .select("date_of_service, month, price_ex_vat")
    .gte("month", fromMonth)
    .lte("month", toMonth);

  if (error) throw error;

  const rows = (data ?? []).filter(
    (r) => !r.date_of_service || (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr)
  );

  return Math.round(rows.reduce((s: number, r) => s + (r.price_ex_vat ?? 0), 0));
}

// Monthly time series: for each of the last TRAILING_MONTHS months, return spa+aesthetics+slimming for THIS year and LAST year
async function fetchMonthlySeries(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
) {
  const today = new Date();
  // TRAILING_MONTHS months ending at current month
  const months: string[] = [];
  for (let i = TRAILING_MONTHS - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(toMonthStr(d));
  }
  // LY equivalent: same TRAILING_MONTHS months but one year earlier
  const lyMonths = months.map((m) => {
    const d = new Date(m);
    d.setFullYear(d.getFullYear() - 1);
    return toMonthStr(d);
  });

  // Fetch spa monthly (covers both current and LY in one query)
  const allFrom = lyMonths[0];
  const allTo   = months[months.length - 1];

  const { data: spaRows, error: spaError } = await supabase
    .from("spa_revenue_monthly")
    .select(`month, location_id, ${SPA_REVENUE_COLUMNS}`)
    .gte("month", allFrom)
    .lte("month", allTo);

  if (spaError) throw spaError;

  const spaByMonth = new Map<string, number>();
  for (const r of spaRows ?? []) {
    const net = computeSpaNetRevenue(r);
    spaByMonth.set(r.month, (spaByMonth.get(r.month) ?? 0) + net);
  }

  // Fetch aesthetics monthly
  const { data: aesRows, error: aesError } = await supabase
    .from("aesthetics_sales_daily")
    .select("month, price_ex_vat")
    .gte("month", allFrom)
    .lte("month", allTo);

  if (aesError) throw aesError;

  const aesByMonth = new Map<string, number>();
  for (const r of aesRows ?? []) {
    aesByMonth.set(r.month, (aesByMonth.get(r.month) ?? 0) + (r.price_ex_vat ?? 0));
  }

  // Fetch slimming monthly
  const { data: slimRows, error: slimError } = await supabase
    .from("slimming_sales_daily")
    .select("month, price_ex_vat")
    .gte("month", allFrom)
    .lte("month", allTo);

  if (slimError) throw slimError;

  const slimByMonth = new Map<string, number>();
  for (const r of slimRows ?? []) {
    slimByMonth.set(r.month, (slimByMonth.get(r.month) ?? 0) + (r.price_ex_vat ?? 0));
  }

  return months.map((m, i) => {
    const lyM = lyMonths[i];
    const spa    = Math.round(spaByMonth.get(m)   ?? 0);
    const aes    = Math.round(aesByMonth.get(m)   ?? 0);
    const slim   = Math.round(slimByMonth.get(m)  ?? 0);
    const spa_ly = Math.round(spaByMonth.get(lyM) ?? 0);
    const aes_ly = Math.round(aesByMonth.get(lyM) ?? 0);
    const slim_ly= Math.round(slimByMonth.get(lyM)?? 0);
    return {
      month:    m,
      ly_month: lyM,
      spa,
      aesthetics: aes,
      slimming:   slim,
      total:      spa + aes + slim,
      spa_ly,
      aesthetics_ly: aes_ly,
      slimming_ly:   slim_ly,
      total_ly:      spa_ly + aes_ly + slim_ly,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");

    if (!fromStr || !toStr) {
      return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    // Derive LY range (same calendar span, one year back)
    const fromDate = new Date(fromStr);
    const toDate   = new Date(toStr);
    const lyFrom   = toDateStr(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), fromDate.getDate()));
    const lyTo     = toDateStr(new Date(toDate.getFullYear() - 1,   toDate.getMonth(),   toDate.getDate()));

    // Spa months for period filter
    const spaFrom = toMonthStr(fromDate);
    const spaTo   = toMonthStr(toDate);
    const spaLyFrom = toMonthStr(new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), 1));
    const spaLyTo   = toMonthStr(new Date(toDate.getFullYear() - 1,   toDate.getMonth(),   1));

    const [spaCurr, spaLY, aesCurr, aesLY, slimCurr, slimLY, monthly] = await Promise.all([
      fetchSpaRevenue(supabase, spaFrom,   spaTo),
      fetchSpaRevenue(supabase, spaLyFrom, spaLyTo),
      fetchDailySalesRevenue(supabase, "aesthetics_sales_daily", fromStr, toStr),
      fetchDailySalesRevenue(supabase, "aesthetics_sales_daily", lyFrom,  lyTo),
      fetchDailySalesRevenue(supabase, "slimming_sales_daily",   fromStr, toStr),
      fetchDailySalesRevenue(supabase, "slimming_sales_daily",   lyFrom,  lyTo),
      fetchMonthlySeries(supabase),
    ]);

    return NextResponse.json({
      period: {
        spa:        spaCurr.total,
        aesthetics: aesCurr,
        slimming:   slimCurr,
        total:      spaCurr.total + aesCurr + slimCurr,
      },
      ly: {
        spa:        spaLY.total,
        aesthetics: aesLY,
        slimming:   slimLY,
        total:      spaLY.total + aesLY + slimLY,
      },
      spa_locations: spaCurr.byLocation,
      monthly,
    });
  } catch (error: unknown) {
    console.error("[api/sales/group] error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
