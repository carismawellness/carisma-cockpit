// app/api/sales/group/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildGroupForecast, type GroupForecast } from "@/lib/analytics/revenue-forecast";

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
};

const SPA_REVENUE_COLUMNS = "services, product_phytomer, product_purest, product_other";

// Cockpit ETL divides Spa unit prices by (1 + VAT) before storing, so the columns
// in spa_revenue_daily are EX-VAT. Sales surfaces report gross (inc-VAT) for
// consistency with Aesthetics (price_inc_vat) and Slimming (paid). Reconstruct
// at read time by multiplying by 1.18 (Malta standard rate, applies to all 4 fields).
const SPA_VAT_RATE = 0.18;

// Gross sales — services + products, multiplied to reconstruct inc-VAT.
// Wholesale/discount/refund are EBITDA-only (live in spa_revenue_monthly).
function computeSpaGrossRevenue(r: SpaRevenueRow): number {
  const exVat = (r.services ?? 0)
    + (r.product_phytomer ?? 0)
    + (r.product_purest   ?? 0)
    + (r.product_other    ?? 0);
  return exVat * (1 + SPA_VAT_RATE);
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
// Uses spa_revenue_daily for exact date-range filtering (no month snapping).
async function fetchSpaRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  fromDate: string,
  toDate: string
) {
  const { data, error } = await supabase
    .from("spa_revenue_daily")
    .select(`location_id, ${SPA_REVENUE_COLUMNS}`)
    .gte("date", fromDate)
    .lte("date", toDate);

  if (error) throw error;

  const rows = data ?? [];
  const locMap = new Map<number, number>();
  let total = 0;

  for (const r of rows) {
    const gross = computeSpaGrossRevenue(r);
    locMap.set(r.location_id, (locMap.get(r.location_id) ?? 0) + gross);
    total += gross;
  }

  const byLocation = Array.from(locMap.entries())
    .map(([id, revenue]) => ({
      location_id: id,
      name:  SPA_LOC_META[id]?.name  ?? `Location ${id}`,
      color: SPA_LOC_META[id]?.color ?? "#888",
      revenue: Math.round(revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.location_id - b.location_id);

  return { total: Math.round(total), byLocation };
}

// True when the [fromDateStr, toDateStr] window covers every day of `month`
// (a "YYYY-MM-01" key) — i.e. spans its 1st through its last day.
function windowCoversMonth(month: string, fromDateStr: string, toDateStr: string): boolean {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
  return fromDateStr <= month && toDateStr >= monthEnd;
}

// Gross-revenue column per brand:
//   aesthetics → price_inc_vat (sticker inc-VAT)
//   slimming   → paid           (actually collected inc-VAT)
// Sales surfaces show GROSS by definition; EBITDA paths use ex-VAT separately.
const GROSS_COLUMN: Record<"aesthetics_sales_daily" | "slimming_sales_daily", "price_inc_vat" | "paid"> = {
  aesthetics_sales_daily: "price_inc_vat",
  slimming_sales_daily:   "paid",
};

// Daily-sales revenue for a date window: returns { total, undatedExcluded }.
// Shared between aesthetics_sales_daily and slimming_sales_daily — identical shape.
// Undated rows are month-anchored, so they only belong to windows that fully
// cover their month; in partial windows they're excluded and counted instead.
async function fetchDailySalesRevenue(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  table: "aesthetics_sales_daily" | "slimming_sales_daily",
  fromDateStr: string,
  toDateStr: string
) {
  const fromMonth = fromDateStr.substring(0, 7) + "-01";
  const toMonth   = toDateStr.substring(0, 7)   + "-01";
  const grossCol  = GROSS_COLUMN[table];

  const { data, error } = await supabase
    .from(table)
    .select(`date_of_service, month, ${grossCol}`)
    .gte("month", fromMonth)
    .lte("month", toMonth);

  if (error) throw error;

  let total = 0;
  let undatedExcluded = 0;
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const amount = (r[grossCol] as number | null) ?? 0;
    const dos    = r.date_of_service as string | null;
    const month  = r.month as string;
    if (dos) {
      if (dos >= fromDateStr && dos <= toDateStr) {
        total += amount;
      }
    } else if (windowCoversMonth(month, fromDateStr, toDateStr)) {
      total += amount;
    } else {
      undatedExcluded++;
    }
  }

  return { total: Math.round(total), undatedExcluded };
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

  // Fetch spa daily (covers both current and LY in one query) and bucket by month.
  const allFrom = lyMonths[0];
  const allTo   = months[months.length - 1];
  const allToEnd = (() => {
    const d = new Date(allTo);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toDateStr(d);
  })();

  const { data: spaRows, error: spaError } = await supabase
    .from("spa_revenue_daily")
    .select(`date, location_id, ${SPA_REVENUE_COLUMNS}`)
    .gte("date", allFrom)
    .lte("date", allToEnd);

  if (spaError) throw spaError;

  const spaByMonth = new Map<string, number>();
  // month → { [hotelName]: revenue }
  const spaByMonthByLocation = new Map<string, Record<string, number>>();
  for (const r of spaRows ?? []) {
    const m = (r.date as string).slice(0, 7) + "-01";
    const gross = computeSpaGrossRevenue(r);
    spaByMonth.set(m, (spaByMonth.get(m) ?? 0) + gross);

    const hotelName = SPA_LOC_META[r.location_id as number]?.name;
    if (hotelName) {
      const bucket = spaByMonthByLocation.get(m) ?? {};
      bucket[hotelName] = (bucket[hotelName] ?? 0) + gross;
      spaByMonthByLocation.set(m, bucket);
    }
  }

  // Fetch aesthetics monthly (inc-VAT — sales surfaces show gross)
  const { data: aesRows, error: aesError } = await supabase
    .from("aesthetics_sales_daily")
    .select("month, price_inc_vat")
    .gte("month", allFrom)
    .lte("month", allTo);

  if (aesError) throw aesError;

  const aesByMonth = new Map<string, number>();
  for (const r of aesRows ?? []) {
    aesByMonth.set(r.month, (aesByMonth.get(r.month) ?? 0) + (r.price_inc_vat ?? 0));
  }

  // Fetch slimming monthly (paid = actually collected inc-VAT)
  const { data: slimRows, error: slimError } = await supabase
    .from("slimming_sales_daily")
    .select("month, paid")
    .gte("month", allFrom)
    .lte("month", allTo);

  if (slimError) throw slimError;

  const slimByMonth = new Map<string, number>();
  for (const r of slimRows ?? []) {
    slimByMonth.set(r.month, (slimByMonth.get(r.month) ?? 0) + (r.paid ?? 0));
  }

  const series = months.map((m, i) => {
    const lyM = lyMonths[i];
    const spa    = Math.round(spaByMonth.get(m)   ?? 0);
    const aes    = Math.round(aesByMonth.get(m)   ?? 0);
    const slim   = Math.round(slimByMonth.get(m)  ?? 0);
    const spa_ly = Math.round(spaByMonth.get(lyM) ?? 0);
    const aes_ly = Math.round(aesByMonth.get(lyM) ?? 0);
    const slim_ly= Math.round(slimByMonth.get(lyM)?? 0);
    // Round each location's revenue. Keys are hotel display names.
    const spaLocRaw = spaByMonthByLocation.get(m) ?? {};
    const spa_by_location: Record<string, number> = {};
    for (const [name, val] of Object.entries(spaLocRaw)) {
      spa_by_location[name] = Math.round(val);
    }
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
      spa_by_location,
    };
  });

  // ---- Forecast inputs (additive — derived from data already fetched) ----
  // Full per-brand month maps. The fetch window (lyMonths[0]..current month)
  // already covers the entire prior calendar year, so future-month LY
  // baselines (e.g. Jul–Dec last year) are present without extra queries.
  const roundMap = (m: Map<string, number>): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const [k, v] of m) o[k] = Math.round(v);
    return o;
  };
  const brandByMonth = {
    spa:        roundMap(spaByMonth),
    aesthetics: roundMap(aesByMonth),
    slimming:   roundMap(slimByMonth),
  };

  // Latest spa daily date inside the current month — used as "elapsed days"
  // for the MTD run-rate so nightly-ETL lag doesn't deflate the projection.
  const currentMonthPrefix = months[months.length - 1].slice(0, 7);
  let lastSpaDataDate: string | null = null;
  for (const r of spaRows ?? []) {
    const ds = r.date as string;
    if (ds.slice(0, 7) === currentMonthPrefix && (!lastSpaDataDate || ds > lastSpaDataDate)) {
      lastSpaDataDate = ds;
    }
  }

  return { series, brandByMonth, lastSpaDataDate };
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

    // Derive LY range (same calendar span, one year back).
    // Clamp the day to the target month's last valid day — otherwise
    // new Date(y-1, 1, 29) rolls Feb 29 → Mar 1 in non-leap years.
    const shiftYearClamped = (d: Date, years: number) => {
      const y = d.getFullYear() + years;
      const m = d.getMonth();
      const day = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
      return new Date(y, m, day);
    };
    const fromDate = new Date(fromStr);
    const toDate   = new Date(toStr);
    const lyFrom   = toDateStr(shiftYearClamped(fromDate, -1));
    const lyTo     = toDateStr(shiftYearClamped(toDate,   -1));

    const [spaCurr, spaLY, aesCurr, aesLY, slimCurr, slimLY, monthlyResult] = await Promise.all([
      fetchSpaRevenue(supabase, fromStr, toStr),
      fetchSpaRevenue(supabase, lyFrom,  lyTo),
      fetchDailySalesRevenue(supabase, "aesthetics_sales_daily", fromStr, toStr),
      fetchDailySalesRevenue(supabase, "aesthetics_sales_daily", lyFrom,  lyTo),
      fetchDailySalesRevenue(supabase, "slimming_sales_daily",   fromStr, toStr),
      fetchDailySalesRevenue(supabase, "slimming_sales_daily",   lyFrom,  lyTo),
      fetchMonthlySeries(supabase),
    ]);
    const monthly = monthlyResult.series;

    // Forward-looking forecast (additive — never affects actual figures).
    // Computed from the monthly maps already fetched; failures degrade to
    // forecast: null rather than breaking the actuals payload.
    let forecast: GroupForecast | null = null;
    try {
      const today = new Date();
      const currentMonth = toMonthStr(today);
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      // Elapsed days = day of the latest spa data point this month (data may
      // lag a day behind the calendar), capped at today's day-of-month.
      let elapsedDays = today.getDate();
      const { lastSpaDataDate } = monthlyResult;
      if (lastSpaDataDate && lastSpaDataDate.slice(0, 7) === currentMonth.slice(0, 7)) {
        elapsedDays = Math.min(elapsedDays, Number(lastSpaDataDate.slice(8, 10)));
      }
      forecast = buildGroupForecast(
        monthlyResult.brandByMonth,
        currentMonth,
        elapsedDays,
        daysInMonth
      );
    } catch (forecastError) {
      console.error("[api/sales/group] forecast computation failed:", forecastError);
    }

    return NextResponse.json({
      period: {
        spa:        spaCurr.total,
        aesthetics: aesCurr.total,
        slimming:   slimCurr.total,
        total:      spaCurr.total + aesCurr.total + slimCurr.total,
      },
      ly: {
        spa:        spaLY.total,
        aesthetics: aesLY.total,
        slimming:   slimLY.total,
        total:      spaLY.total + aesLY.total + slimLY.total,
      },
      // Undated rows excluded from partial-period windows (month not fully covered)
      undatedExcluded: {
        aesthetics: aesCurr.undatedExcluded,
        slimming:   slimCurr.undatedExcluded,
      },
      spa_locations: spaCurr.byLocation,
      monthly,
      // Additive forward-looking block: current (partial) month projection +
      // each remaining month of the calendar year. null = not computable
      // (no LY data at all) — clients hide the forecast UI in that case.
      forecast,
    });
  } catch (error: unknown) {
    console.error("[api/sales/group] error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
