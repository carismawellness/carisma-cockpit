/**
 * POST /api/etl/talexio-location-splits?month=YYYY-MM
 *
 * Computes per-employee location wage attribution from Talexio data:
 * - Primary: employee organisationUnit → home location (100% by default)
 * - Secondary: GPS clock-in coordinates → detect cross-location work
 *   (only flagged when GPS matches a DIFFERENT geographic cluster than home)
 *
 * St Julians cluster (inter/hugos/hyatt/novotel are all within ~500m):
 *   GPS cannot distinguish these locations from each other — org unit is used
 *   as the definitive signal for employees whose home is in the St Julians cluster.
 *
 * Cross-location = GPS cluster !== home cluster AND GPS cluster is a real spa cluster.
 *
 * Stores results in employee_location_splits_monthly for HR HC% drill-down.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";

export const maxDuration = 120;

// ── Org unit → canonical location slug ─────────────────────────────────────
// Source: Agent 0 data discovery (exact Talexio org unit names)
// "Riveira" is the EXACT Talexio spelling (not "Riviera") for Riviera Hotel.
const ORG_UNIT_TO_SLUG: Record<string, string> = {
  "inter spa":          "inter",
  "hugos":              "hugos",
  "ramla":              "ramla",
  "hyatt":              "hyatt",
  "excelsior":          "excelsior",
  "sunny coast":        "odycy",
  "riveira":            "labranda",
  "novotel":            "novotel",
  "management":         "hq",
  "spa operations":     "hq",
  "crm":                "hq",
  "carisma aesthetics": "aesthetics",
  "aesthetics":         "aesthetics",
  "slimming":           "slimming",
};

function orgUnitToSlug(orgName: string): string {
  return ORG_UNIT_TO_SLUG[orgName.toLowerCase().trim()] ?? "hq";
}

// ── Geographic clusters for cross-location detection ────────────────────────
// Employees in the same cluster won't be flagged as cross-location even if GPS
// matches a different location in that cluster (they're too close to distinguish).
const GEO_CLUSTERS: Record<string, string> = {
  inter:      "st_julians",
  hugos:      "st_julians",
  hyatt:      "st_julians",
  novotel:    "st_julians",
  excelsior:  "valletta",
  ramla:      "mellieha",
  odycy:      "mellieha",
  labranda:   "mellieha",
  hq:         "hq",
  aesthetics: "aesthetics",
  slimming:   "slimming",
};

// ── GPS geofences (Agent 0 verified coordinates) ────────────────────────────
const GEOFENCES = [
  { slug: "inter",     lat: 35.9238, lng: 14.4883, radiusM: 300 },
  { slug: "ramla",     lat: 35.9870, lng: 14.3481, radiusM: 300 },
  { slug: "excelsior", lat: 35.8970, lng: 14.5051, radiusM: 400 },
  { slug: "odycy",     lat: 35.9530, lng: 14.4241, radiusM: 400 },
  { slug: "hugos",     lat: 35.9218, lng: 14.4936, radiusM: 400 },
  { slug: "hyatt",     lat: 35.9218, lng: 14.4903, radiusM: 400 },
  { slug: "labranda",  lat: 35.9450, lng: 14.3501, radiusM: 400 },
  { slug: "novotel",   lat: 35.9240, lng: 14.4880, radiusM: 300 },
] as const;

function haversineM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function gpsToSlug(lat: number, lng: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const fence of GEOFENCES) {
    const d = haversineM(lat, lng, fence.lat, fence.lng);
    if (d <= fence.radiusM && d < bestDist) {
      best = fence.slug;
      bestDist = d;
    }
  }
  return best;
}

function monthBounds(month: string): {
  dateFrom:   string;
  dateTo:     string;
  monthStart: string;
} | null {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y  = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(y, mo, 0).getDate();
  const pad     = (n: number) => String(n).padStart(2, "0");
  return {
    dateFrom:   `${y}-${pad(mo)}-01`,
    dateTo:     `${y}-${pad(mo)}-${pad(lastDay)}`,
    monthStart: `${y}-${pad(mo)}-01`,
  };
}

// ── Talexio GraphQL response shapes ─────────────────────────────────────────
interface GqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface RawEmployee {
  id:           number;
  fullName:     string;
  isTerminated: boolean;
  currentPositionSimple?: {
    isEnded:            boolean;
    position?:          { id: number; name: string } | null;
    organisationUnit?:  { id: number; name: string } | null;
  } | null;
  payslips?: Array<{
    gross:      number;
    net:        number;
    tax:        number;
    periodFrom: string;
    periodTo:   string;
  }>;
}

interface TimeLogEmployee {
  id:       number;
  timeLogs: Array<{
    from?:             string;
    locationLatIn?:    number | null;
    locationLongIn?:   number | null;
  }>;
}

const GQL_EMPLOYEES = `query {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      id isEnded
      position { id name }
      organisationUnit { id name }
    }
    payslips {
      ... on PayrollPayslip {
        id gross net tax periodFrom periodTo
      }
    }
  }
}`;

const GQL_TIME_LOGS = `query ($dateFrom: Date!, $dateTo: Date!) {
  employees {
    id
    timeLogs(dateFrom: $dateFrom, dateTo: $dateTo) {
      ... on TimeLogEntry {
        id from
        locationLatIn
        locationLongIn
      }
    }
  }
}`;

async function fetchTalexio<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const json = (await talexioQuery(query, variables)) as GqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(
      `Talexio GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!json.data) throw new Error("Talexio query returned no data");
  return json.data;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");

  if (!month) {
    return NextResponse.json({ error: "month=YYYY-MM required" }, { status: 400 });
  }

  const bounds = monthBounds(month);
  if (!bounds) {
    return NextResponse.json({ error: "Invalid month format — use YYYY-MM" }, { status: 400 });
  }

  const supabase  = getAdminClient();
  const warnings: string[] = [];

  // ── 1. Fetch employees with org unit + payslips ────────────────────────────
  const empData = await fetchTalexio<{ employees: RawEmployee[] }>(GQL_EMPLOYEES);
  const allEmployees = empData.employees ?? [];

  const activeEmployees = allEmployees.filter(
    (e) => !e.isTerminated && !e.currentPositionSimple?.isEnded,
  );

  // ── 2. Fetch GPS time logs for the month ──────────────────────────────────
  // Agent 0: without dateFrom/dateTo, only today's logs are returned — date filter REQUIRED.
  const timeLogsByEmployee = new Map<number, Array<{ lat: number; lng: number }>>();

  try {
    const tlData = await fetchTalexio<{ employees: TimeLogEmployee[] }>(GQL_TIME_LOGS, {
      dateFrom: bounds.dateFrom,
      dateTo:   bounds.dateTo,
    });

    for (const emp of tlData.employees ?? []) {
      const gpsLogs = (emp.timeLogs ?? [])
        .filter(
          (log) => log.locationLatIn != null && log.locationLongIn != null,
        )
        .map((log) => ({
          lat: log.locationLatIn!,
          lng: log.locationLongIn!,
        }));
      if (gpsLogs.length > 0) {
        timeLogsByEmployee.set(emp.id, gpsLogs);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`time log fetch failed — falling back to org unit only: ${msg}`);
  }

  // ── 3. Compute per-employee splits ─────────────────────────────────────────
  const rows: Record<string, unknown>[] = [];

  for (const emp of activeEmployees) {
    const orgName   = emp.currentPositionSimple?.organisationUnit?.name ?? "";
    const homeSlug  = orgUnitToSlug(orgName || "management");
    const homeCluster = GEO_CLUSTERS[homeSlug] ?? "unknown";
    const hasPosition = !!emp.currentPositionSimple?.organisationUnit;

    const gpsLogs = timeLogsByEmployee.get(emp.id) ?? [];

    // Count GPS events per location slug.
    // ONLY count as cross-location if GPS is from a DIFFERENT geographic cluster
    // than the employee's home. Same-cluster GPS (e.g. inter vs hugos) cannot
    // reliably distinguish nearby hotels and is treated as home attendance.
    const crossLocationCounts: Record<string, number> = {};
    let homeCounts = 0;

    for (const log of gpsLogs) {
      const gpsSlug = gpsToSlug(log.lat, log.lng);
      if (!gpsSlug) {
        homeCounts++; // unmatched GPS → credit home
        continue;
      }
      const gpsCluster = GEO_CLUSTERS[gpsSlug] ?? "unknown";
      if (gpsCluster === homeCluster) {
        // Same geographic cluster → treat as home (GPS can't distinguish these)
        homeCounts++;
      } else {
        // Different cluster → genuine cross-location event
        crossLocationCounts[gpsSlug] = (crossLocationCounts[gpsSlug] ?? 0) + 1;
      }
    }

    const hasCrossLocation = Object.keys(crossLocationCounts).length > 0;

    let locationSplits:    Record<string, number>;
    let shiftBreakdown:    Record<string, number>;
    let attributionSource: string;
    let totalEvents:       number;

    if (!hasCrossLocation || gpsLogs.length === 0) {
      // Pure home-base attribution
      locationSplits    = { [homeSlug]: 1.0 };
      shiftBreakdown    = { [homeSlug]: gpsLogs.length || 1 };
      attributionSource = hasPosition ? "org_unit_static" : "no_position";
      totalEvents       = gpsLogs.length || 1;
    } else {
      // Cross-location: split proportionally by GPS cluster counts
      const totalCrossEvents = Object.values(crossLocationCounts).reduce(
        (a, b) => a + b,
        0,
      );
      const totalAll = homeCounts + totalCrossEvents;

      shiftBreakdown = { [homeSlug]: homeCounts, ...crossLocationCounts };
      locationSplits = { [homeSlug]: +(homeCounts / totalAll).toFixed(4) };
      for (const [slug, count] of Object.entries(crossLocationCounts)) {
        locationSplits[slug] = +(count / totalAll).toFixed(4);
      }
      attributionSource = "gps_timelogs";
      totalEvents       = totalAll;
    }

    // ── Payslip gross for the requested month ─────────────────────────────────
    const monthPayslip = (emp.payslips ?? []).find(
      (ps) => String(ps.periodFrom ?? "").slice(0, 7) === month,
    );
    const grossWage = +(Number(monthPayslip?.gross ?? 0)).toFixed(2);

    // ── Wage attribution: gross × split% ──────────────────────────────────────
    const wageAttribution: Record<string, number> = {};
    for (const [slug, pct] of Object.entries(locationSplits)) {
      wageAttribution[slug] = +(grossWage * pct).toFixed(2);
    }

    rows.push({
      month:              bounds.monthStart,
      talexio_id:         emp.id,
      employee_name:      emp.fullName,
      home_location:      orgName || "Unknown",
      home_location_slug: homeSlug,
      gross_wage:         grossWage,
      total_events:       totalEvents,
      location_splits:    locationSplits,
      wage_attribution:   wageAttribution,
      shift_breakdown:    shiftBreakdown,
      attribution_source: attributionSource,
      computed_at:        new Date().toISOString(),
    });
  }

  // ── 4. Upsert into Supabase ────────────────────────────────────────────────
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No active employees found in Talexio" },
      { status: 500 },
    );
  }

  const { error: upsertError } = await supabase
    .from("employee_location_splits_monthly")
    .upsert(rows, { onConflict: "month,talexio_id" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // ── 5. Build response summary ──────────────────────────────────────────────
  const locationTotals: Record<string, number> = {};
  for (const row of rows as Array<{ wage_attribution: Record<string, number> }>) {
    for (const [slug, amt] of Object.entries(row.wage_attribution)) {
      locationTotals[slug] = +((locationTotals[slug] ?? 0) + amt).toFixed(2);
    }
  }

  const sourceCounts = (
    rows as Array<{ attribution_source: string }>
  ).reduce<Record<string, number>>((acc, r) => {
    acc[r.attribution_source] = (acc[r.attribution_source] ?? 0) + 1;
    return acc;
  }, {});

  const crossLocationCount = (rows as Array<{ attribution_source: string }>).filter(
    (r) => r.attribution_source === "gps_timelogs",
  ).length;

  return NextResponse.json({
    month,
    employees_processed:     rows.length,
    cross_location_detected: crossLocationCount,
    attribution_sources:     sourceCounts,
    location_totals:         locationTotals,
    warnings:                warnings.length > 0 ? warnings : undefined,
  });
}

/** Support GET for ease of manual triggering (matches other ETL routes). */
export async function GET(req: NextRequest) {
  return POST(req);
}
