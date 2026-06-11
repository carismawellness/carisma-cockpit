/**
 * GET /api/hr/revpah?month=YYYY-MM
 *
 * Revenue per Available Hour by location, grouped by brand.
 *
 * Denominator priority (most → least accurate):
 *   1. hr_therapist_shifts_monthly — actual scheduled hours for therapist-role
 *      staff only, populated nightly by /api/etl/therapist-shifts-monthly.
 *   2. spa_services_by_employee_daily distinct therapist names × 8h × workdays
 *      (spa hotels only — only people who performed services are counted).
 *   3. hr_talexio_daily_snapshot active_headcount × 8h × workdays (fallback
 *      when neither of the above has data for a location/period).
 *
 * Response shape:
 *   { month, byBrand: { Spa, Aesthetics, Slimming }, byLocation, avgRevPAH }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  LOCATION_ID_TO_DISPLAY,
  LOCATION_TO_BRAND,
} from "@/lib/constants/hr-mapping";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── Brand-specific RevPAH targets (Malta-adjusted) ───────────────────────────
const BRAND_TARGETS: Record<string, number> = {
  Spa:         35,
  Aesthetics:  70,
  Slimming:    55,
};

interface MonthBounds {
  start:      string;
  end:        string;
  monthStart: string;
  workdays:   number;
}

function monthBounds(monthYYYYMM: string): MonthBounds | null {
  const m = monthYYYYMM.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y  = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!y || mo < 1 || mo > 12) return null;
  const pad     = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, mo, 0).getDate();
  let workdays  = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(y, mo - 1, d).getDay();
    if (day !== 0 && day !== 6) workdays++;
  }
  return {
    start:      `${y}-${pad(mo)}-01`,
    end:        `${y}-${pad(mo)}-${pad(lastDay)}`,
    monthStart: `${y}-${pad(mo)}-01`,
    workdays,
  };
}

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month  = searchParams.get("month") || currentMonthYYYYMM();
  const bounds = monthBounds(month);
  if (!bounds) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // ══════════════════════════════════════════════════════════════════════════
  // REVENUE
  // ══════════════════════════════════════════════════════════════════════════

  const revenueByLocation = new Map<string, number>();

  // ── Spa hotel revenue ────────────────────────────────────────────────────
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
    const total =
      Number(r.services ?? 0) +
      Number(r.product_phytomer ?? 0) +
      Number(r.product_purest ?? 0) +
      Number(r.product_other ?? 0);
    revenueByLocation.set(loc, (revenueByLocation.get(loc) ?? 0) + total);
  }

  // ── Aesthetics revenue (include NULL date_of_service rows) ───────────────
  const { data: aesRev } = await supabase
    .from("aesthetics_sales_daily")
    .select("price_ex_vat, date_of_service, month")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );
  const aesTotal = (aesRev ?? []).reduce((a, r) => a + Number(r.price_ex_vat ?? 0), 0);
  if (aesTotal > 0) revenueByLocation.set("Aesthetics Centre", aesTotal);

  // ── Slimming — use treatments_daily (actual sessions, not package sales) ──
  const { data: slmTx } = await supabase
    .from("slimming_treatments_daily")
    .select("price_ex_vat, date_of_service, month, therapist")
    .or(
      `and(date_of_service.gte.${bounds.start},date_of_service.lte.${bounds.end}),` +
      `and(date_of_service.is.null,month.eq.${bounds.monthStart})`,
    );
  const slmTotal = (slmTx ?? []).reduce((a, r) => a + Number(r.price_ex_vat ?? 0), 0);
  if (slmTotal > 0) revenueByLocation.set("Slimming Centre", slmTotal);

  // ══════════════════════════════════════════════════════════════════════════
  // DENOMINATOR (available therapist hours)
  // Priority: therapist_shifts_monthly > service_records > talexio_snapshot
  // ══════════════════════════════════════════════════════════════════════════

  const availHoursByLocation = new Map<string, number>();
  const headcountByLocation  = new Map<string, number>();
  const denominatorSource    = new Map<string, "shifts" | "service_records" | "snapshot">();

  // ── Source 1: hr_therapist_shifts_monthly (most accurate) ────────────────
  const { data: therapistShifts } = await supabase
    .from("hr_therapist_shifts_monthly")
    .select("location_name, therapist_count, total_scheduled_hours")
    .eq("month", bounds.monthStart);

  for (const r of therapistShifts ?? []) {
    const loc   = r.location_name as string;
    const hours = Number(r.total_scheduled_hours ?? 0);
    if (hours > 0) {
      availHoursByLocation.set(loc, hours);
      headcountByLocation.set(loc, Number(r.therapist_count ?? 0));
      denominatorSource.set(loc, "shifts");
    }
  }

  // ── Source 2: spa_services_by_employee_daily (spa hotels without shifts) ─
  const { data: svcRows } = await supabase
    .from("spa_services_by_employee_daily")
    .select("location_id, employee_name")
    .gte("date_of_service", bounds.start)
    .lte("date_of_service", bounds.end)
    .not("employee_name", "is", null);

  const therapistSetByLocId = new Map<number, Set<string>>();
  for (const r of svcRows ?? []) {
    const locId = r.location_id as number;
    const name  = String(r.employee_name ?? "").trim();
    if (!name) continue;
    if (!therapistSetByLocId.has(locId)) therapistSetByLocId.set(locId, new Set());
    therapistSetByLocId.get(locId)!.add(name);
  }
  for (const [locId, names] of therapistSetByLocId) {
    const loc = LOCATION_ID_TO_DISPLAY[locId];
    if (!loc || availHoursByLocation.has(loc)) continue; // already have shifts data
    const count = names.size;
    const hours = count * 8 * bounds.workdays;
    headcountByLocation.set(loc, count);
    availHoursByLocation.set(loc, hours);
    denominatorSource.set(loc, "service_records");
  }

  // ── Source 3: slimming — distinct therapists from treatment records ───────
  if (!availHoursByLocation.has("Slimming Centre")) {
    const slmTherapists = new Set(
      (slmTx ?? [])
        .map((r) => String(r.therapist ?? "").trim())
        .filter(Boolean),
    );
    if (slmTherapists.size > 0) {
      const count = slmTherapists.size;
      headcountByLocation.set("Slimming Centre", count);
      availHoursByLocation.set("Slimming Centre", count * 8 * bounds.workdays);
      denominatorSource.set("Slimming Centre", "service_records");
    }
  }

  // ── Source 4: Talexio snapshot fallback for anything still missing ────────
  const { data: snap } = await supabase
    .from("hr_talexio_daily_snapshot")
    .select("location_name, active_headcount, snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(200);

  for (const r of snap ?? []) {
    const loc = r.location_name as string;
    if (availHoursByLocation.has(loc)) continue;
    const count = Number(r.active_headcount ?? 0);
    if (count > 0) {
      headcountByLocation.set(loc, count);
      availHoursByLocation.set(loc, count * 8 * bounds.workdays);
      denominatorSource.set(loc, "snapshot");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD ROWS
  // ══════════════════════════════════════════════════════════════════════════

  const allLocations = new Set<string>([
    ...revenueByLocation.keys(),
    ...availHoursByLocation.keys(),
  ]);

  const rows = Array.from(allLocations)
    .filter((loc) => loc !== "HQ")
    .map((loc) => {
      const revenue      = +(revenueByLocation.get(loc)  ?? 0).toFixed(2);
      const availHours   = availHoursByLocation.get(loc) ?? 0;
      const headcount    = headcountByLocation.get(loc)  ?? 0;
      const revpah       = availHours > 0 ? +(revenue / availHours).toFixed(2) : null;
      const brand        = LOCATION_TO_BRAND[loc] ?? "Spa";
      const denomSource  = denominatorSource.get(loc) ?? "snapshot";
      return { location: loc, revenue, availHours, headcount, revpah, brand, denomSource };
    })
    .filter((r) => r.revenue > 0 || r.headcount > 0)
    .sort((a, b) => (b.revpah ?? -1) - (a.revpah ?? -1));

  // ══════════════════════════════════════════════════════════════════════════
  // BRAND-LEVEL AGGREGATION
  // ══════════════════════════════════════════════════════════════════════════

  const brandNames = ["Spa", "Aesthetics", "Slimming"] as const;
  type BrandName = typeof brandNames[number];

  const byBrand: Record<BrandName, {
    locations: typeof rows;
    avgRevPAH: number;
    target:    number;
  }> = {
    Spa:        { locations: [], avgRevPAH: 0, target: BRAND_TARGETS.Spa },
    Aesthetics: { locations: [], avgRevPAH: 0, target: BRAND_TARGETS.Aesthetics },
    Slimming:   { locations: [], avgRevPAH: 0, target: BRAND_TARGETS.Slimming },
  };

  for (const row of rows) {
    const b = row.brand as BrandName;
    if (byBrand[b]) byBrand[b].locations.push(row);
  }

  for (const brand of brandNames) {
    const locs   = byBrand[brand].locations;
    const valid  = locs.map((r) => r.revpah).filter((v): v is number => v !== null);
    byBrand[brand].avgRevPAH =
      valid.length > 0
        ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2)
        : 0;
  }

  const allValid = rows.map((r) => r.revpah).filter((v): v is number => v !== null);
  const avgRevPAH =
    allValid.length > 0
      ? +(allValid.reduce((a, b) => a + b, 0) / allValid.length).toFixed(2)
      : 0;

  return NextResponse.json({
    month,
    byBrand: {
      Spa: {
        locations:  byBrand.Spa.locations.map(locRow),
        avgRevPAH:  byBrand.Spa.avgRevPAH,
        target:     byBrand.Spa.target,
      },
      Aesthetics: {
        locations:  byBrand.Aesthetics.locations.map(locRow),
        avgRevPAH:  byBrand.Aesthetics.avgRevPAH,
        target:     byBrand.Aesthetics.target,
      },
      Slimming: {
        locations:  byBrand.Slimming.locations.map(locRow),
        avgRevPAH:  byBrand.Slimming.avgRevPAH,
        target:     byBrand.Slimming.target,
      },
    },
    // backward-compatible flat list
    byLocation: rows.map(locRow),
    avgRevPAH,
  });
}

function locRow(r: {
  location:    string;
  revpah:      number | null;
  revenue:     number;
  availHours:  number;
  headcount:   number;
  brand:       string;
  denomSource: string;
}) {
  return {
    location:       r.location,
    revpah:         r.revpah ?? 0,
    revenue:        r.revenue,
    availableHours: r.availHours,
    headcount:      r.headcount,
    brand:          r.brand,
    denomSource:    r.denomSource,
    dataSource:     "estimated" as const,
  };
}
