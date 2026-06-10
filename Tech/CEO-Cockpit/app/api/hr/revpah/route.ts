/**
 * GET /api/hr/revpah?month=YYYY-MM
 *
 * Revenue per available hour by location.
 *
 *  - Revenue source: same as `/api/hr/financials` (spa_revenue_daily,
 *    aesthetics_sales_daily, slimming_sales_daily).
 *  - Available-hours source priority:
 *      1. `hr_shifts_daily` (preferred — populated by the Talexio ETL).
 *      2. Estimated hours from `hr_talexio_daily_snapshot` headcount
 *         (headcount * 8h * workdays-in-month).
 *      3. `"sample"` — placeholder zero when nothing is available.
 *
 *  `dataSource` is reported per row.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { LOCATION_ID_TO_DISPLAY, LOCATION_TO_BRAND } from "@/lib/constants/hr-mapping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function monthBounds(monthYYYYMM: string): { start: string; end: string; workdays: number } | null {
  const m = monthYYYYMM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!y || mo < 1 || mo > 12) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, mo, 0).getDate();
  let workdays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(y, mo - 1, d).getDay();
    if (day !== 0 && day !== 6) workdays++;
  }
  return {
    start:    `${y}-${pad(mo)}-01`,
    end:      `${y}-${pad(mo)}-${pad(lastDay)}`,
    workdays,
  };
}

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "HH:MM[:SS]" → hours as decimal. Returns 0 for invalid input. */
function timeToHours(t: string | null | undefined): number {
  if (!t) return 0;
  const parts = t.split(":").map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return 0;
  const [h, m, s = 0] = parts;
  return h + m / 60 + s / 3600;
}

type DataSource = "talexio_shifts" | "estimated" | "sample";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") || currentMonthYYYYMM();
  const bounds = monthBounds(month);
  if (!bounds) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  // ── Revenue by location ───────────────────────────────────────────────────
  const revenueByLocation = new Map<string, number>();

  const { data: spaRev, error: spaErr } = await supabase
    .from("spa_revenue_daily")
    .select("location_id, services, product_phytomer, product_purest, product_other")
    .gte("date", bounds.start)
    .lte("date", bounds.end);
  if (spaErr) {
    return NextResponse.json({ error: `spa revenue: ${spaErr.message}` }, { status: 500 });
  }
  for (const r of spaRev ?? []) {
    const loc = LOCATION_ID_TO_DISPLAY[r.location_id as number];
    if (!loc) continue;
    // services + product_* hold inc-VAT after migration 073. Divide for ex-VAT
    // so RevPAH stays consistent with aesthetics/slimming (price_ex_vat).
    const totalInc =
      Number(r.services ?? 0) +
      Number(r.product_phytomer ?? 0) +
      Number(r.product_purest ?? 0) +
      Number(r.product_other ?? 0);
    const total = totalInc / 1.18;
    revenueByLocation.set(loc, (revenueByLocation.get(loc) ?? 0) + total);
  }

  const { data: aesRev } = await supabase
    .from("aesthetics_sales_daily")
    .select("price_ex_vat")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end);
  const aesTotal = (aesRev ?? []).reduce(
    (a, r) => a + Number(r.price_ex_vat ?? 0),
    0,
  );
  if (aesTotal > 0) {
    revenueByLocation.set("Aesthetics Centre", aesTotal);
  }

  const { data: slmRev } = await supabase
    .from("slimming_sales_daily")
    .select("price_ex_vat")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end);
  const slmTotal = (slmRev ?? []).reduce(
    (a, r) => a + Number(r.price_ex_vat ?? 0),
    0,
  );
  if (slmTotal > 0) {
    revenueByLocation.set("Slimming Centre", slmTotal);
  }

  // ── Available hours: prefer shift data ────────────────────────────────────
  const hoursByLocation = new Map<string, number>();
  const sourceByLocation = new Map<string, DataSource>();

  const { data: shifts } = await supabase
    .from("hr_shifts_daily")
    .select("scheduled_start, scheduled_end, location_name")
    .gte("shift_date", bounds.start)
    .lte("shift_date", bounds.end);

  if (shifts && shifts.length > 0) {
    for (const s of shifts) {
      const loc = s.location_name as string | null;
      if (!loc) continue;
      const start = timeToHours(s.scheduled_start as string | null);
      const end   = timeToHours(s.scheduled_end   as string | null);
      const hours = Math.max(0, end - start);
      if (hours === 0) continue;
      hoursByLocation.set(loc, (hoursByLocation.get(loc) ?? 0) + hours);
      sourceByLocation.set(loc, "talexio_shifts");
    }
  }

  // ── Fallback: estimated hours from latest headcount snapshot ──────────────
  const { data: snap } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .lte("snapshot_date", bounds.end)
    .gte("snapshot_date", bounds.start)
    .order("snapshot_date", { ascending: false });

  const headcountByLocation = new Map<string, number>();
  for (const r of snap ?? []) {
    const loc = r.location_name as string;
    if (!headcountByLocation.has(loc)) {
      headcountByLocation.set(loc, Number(r.active_headcount ?? 0));
    }
  }

  const allLocations = new Set<string>([
    ...revenueByLocation.keys(),
    ...hoursByLocation.keys(),
    ...headcountByLocation.keys(),
  ]);

  for (const loc of allLocations) {
    if (hoursByLocation.has(loc)) continue;
    const hc = headcountByLocation.get(loc) ?? 0;
    if (hc > 0) {
      hoursByLocation.set(loc, hc * 8 * bounds.workdays);
      sourceByLocation.set(loc, "estimated");
    } else {
      hoursByLocation.set(loc, 0);
      sourceByLocation.set(loc, "sample");
    }
  }

  // ── Build rows ────────────────────────────────────────────────────────────
  const rows = Array.from(allLocations)
    .map((loc) => {
      const revenue = +(revenueByLocation.get(loc) ?? 0).toFixed(2);
      const availableHours = +(hoursByLocation.get(loc) ?? 0).toFixed(2);
      const revpah = availableHours > 0 ? +(revenue / availableHours).toFixed(2) : null;
      const dataSource: DataSource = sourceByLocation.get(loc) ?? "sample";
      // Tag brand for downstream charts (not in the spec, harmless extra field).
      const brand = LOCATION_TO_BRAND[loc] ?? "Spa";
      return { location: loc, revenue, availableHours, revpah, dataSource, brand };
    })
    .sort((a, b) => (b.revpah ?? -1) - (a.revpah ?? -1));

  const validRevpahs = rows.map((r) => r.revpah).filter((v): v is number => v !== null);
  const avgRevpah =
    validRevpahs.length > 0
      ? +(validRevpahs.reduce((a, b) => a + b, 0) / validRevpahs.length).toFixed(2)
      : null;

  // Shape matches HRRevPAHResponse in lib/hooks/useHRData.ts
  return NextResponse.json({
    month,
    byLocation: rows.map((r) => ({
      location:   r.location,
      revpah:     r.revpah ?? 0,
      revenue:    r.revenue,
      dataSource: r.dataSource,
    })),
    avgRevPAH: avgRevpah ?? 0,
  });
}
