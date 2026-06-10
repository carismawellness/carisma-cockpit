/**
 * POST /api/etl/talexio-hr?date=YYYY-MM-DD
 *
 * Nightly Talexio → Supabase HR ETL.
 *
 * Pulls from the internal Talexio proxy at /api/talexio (single source of
 * truth for Talexio GraphQL) and upserts:
 *   1. hr_talexio_daily_snapshot  ← headcount + payroll aggregates by
 *                                     location + brand, keyed on date.
 *   2. hr_headcount_monthly       ← current-month headcount snapshot,
 *                                     keyed on month + location + brand.
 *   3. hr_shifts_daily            ← today's shifts for active employees.
 *
 * Writes go through `getAdminClient()` (SUPABASE_SERVICE_ROLE_KEY) since
 * RLS only allows service_role writes.
 *
 * Outcomes are logged to `etl_sync_log` (source_name = "talexio-hr").
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";
import {
  LOCATION_TO_BRAND,
  brandForLocation,
  normaliseLocation,
} from "@/lib/constants/hr-mapping";

export const maxDuration = 60;

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthStart(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

// ── Talexio response shapes ──────────────────────────────────────────────────
type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface HeadcountEmployee {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: {
    isEnded: boolean;
    position?: { name: string } | null;
    organisationUnit?: { name: string } | null;
  } | null;
}

interface PayslipEmployee {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: {
    position?: { name: string } | null;
    organisationUnit?: { name: string } | null;
  } | null;
  payslips: Array<{
    gross: number | null;
    net: number | null;
    tax: number | null;
    periodFrom: string | null;
    periodTo: string | null;
  }>;
}

interface ShiftRow {
  id: string;
  label: string | null;
  type: string | null;
  date: string;
  from: string | null;
  to: string | null;
  employee: { id: string; fullName: string };
}

interface ShiftEmployee {
  id: string;
  fullName: string;
  workShifts: ShiftRow[];
}

const GQL_HEADCOUNT = `query {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      id isEnded
      position { id name }
      organisationUnit { id name }
    }
  }
}`;

const GQL_PAYSLIPS = `query {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      position { name }
      organisationUnit { name }
    }
    payslips {
      ... on PayrollPayslip {
        id gross net tax periodFrom periodTo
      }
    }
  }
}`;

const GQL_SHIFTS = `query ($employeeIds: [ID!]!, $dateFrom: Date!, $dateTo: Date!) {
  selectedEmployees: employees(params: { employeeIds: $employeeIds }) {
    id fullName
    workShifts(dateFrom: $dateFrom, dateTo: $dateTo, onlyPublished: true) {
      id label type date from to
      employee { id fullName }
    }
  }
}`;

async function fetchTalexio<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const json = (await talexioQuery(query, variables)) as GqlResponse<T>;
  if (json.errors && json.errors.length) {
    throw new Error(`Talexio GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Talexio query returned no data");
  return json.data;
}

function isoTimeFromTalexio(dt: string | null | undefined): string | null {
  // Talexio returns ISO datetimes for shift from/to. Extract HH:MM:SS.
  if (!dt) return null;
  const match = dt.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (match) return match[1];
  // Already a HH:MM[:SS] time?
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(dt)) return dt;
  return null;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const startedAt = new Date();
  const warnings: string[] = [];
  let rowsUpserted = 0;

  // ── Start etl_sync_log entry ──────────────────────────────────────────────
  const { data: logRow } = await supabase
    .from("etl_sync_log")
    .insert({ source_name: "talexio-hr", status: "running" })
    .select("id")
    .single();
  const logId = (logRow?.id as number | undefined) ?? null;

  async function finish(
    status: "success" | "partial" | "failed",
    errorMessage?: string,
  ) {
    const duration = (Date.now() - startedAt.getTime()) / 1000;
    if (logId != null) {
      await supabase
        .from("etl_sync_log")
        .update({
          completed_at:  new Date().toISOString(),
          status,
          rows_upserted: rowsUpserted,
          error_message: errorMessage ?? null,
          duration_sec:  duration,
        })
        .eq("id", logId);
    }
  }

  try {
    // ── 1. Headcount → hr_talexio_daily_snapshot + hr_headcount_monthly ─────
    const headcountData = await fetchTalexio<{ employees: HeadcountEmployee[] }>(GQL_HEADCOUNT);
    const employees = headcountData.employees ?? [];

    // location_name → { active, brand }
    const headcountByLocation = new Map<string, { active: number; terminated: number; brand: string }>();
    const activeEmployeeIds: string[] = [];

    for (const e of employees) {
      const unit = e.currentPositionSimple?.organisationUnit?.name ?? null;
      let location = normaliseLocation(unit);
      if (!location) {
        if (unit) warnings.push(`Unmapped organisationUnit "${unit}" — defaulting to Spa`);
        location = "Spa"; // per spec
      }
      const brand = brandForLocation(location);

      const bucket = headcountByLocation.get(location) ?? { active: 0, terminated: 0, brand };
      if (e.isTerminated || e.currentPositionSimple?.isEnded) {
        bucket.terminated++;
      } else {
        bucket.active++;
        activeEmployeeIds.push(e.id);
      }
      headcountByLocation.set(location, bucket);
    }

    const snapshotRows = Array.from(headcountByLocation.entries()).map(
      ([location_name, v]) => ({
        snapshot_date:    date,
        location_name,
        brand_name:       v.brand,
        active_headcount: v.active,
        gross_payroll:    null as number | null,
        net_payroll:      null as number | null,
        tax_total:        null as number | null,
        payroll_period_from: null as string | null,
        payroll_period_to:   null as string | null,
      }),
    );

    // ── 2. Payslips → enrich snapshot rows with gross/net/tax ──────────────
    try {
      const payslipData = await fetchTalexio<{ employees: PayslipEmployee[] }>(GQL_PAYSLIPS);
      const payslipEmployees = payslipData.employees ?? [];

      // location_name → aggregated payroll
      const payrollByLocation = new Map<
        string,
        { gross: number; net: number; tax: number; periodFrom?: string; periodTo?: string }
      >();

      for (const e of payslipEmployees) {
        const unit = e.currentPositionSimple?.organisationUnit?.name ?? null;
        const location = normaliseLocation(unit) ?? "Spa";

        // Use the most recent payslip per employee for this snapshot
        const latest = (e.payslips ?? [])
          .filter((p) => p.periodFrom && p.periodTo)
          .sort((a, b) => (b.periodTo! > a.periodTo! ? 1 : -1))[0];
        if (!latest) continue;

        const bucket = payrollByLocation.get(location) ?? {
          gross: 0,
          net:   0,
          tax:   0,
        };
        bucket.gross += Number(latest.gross ?? 0);
        bucket.net   += Number(latest.net   ?? 0);
        bucket.tax   += Number(latest.tax   ?? 0);
        bucket.periodFrom = latest.periodFrom ?? bucket.periodFrom;
        bucket.periodTo   = latest.periodTo   ?? bucket.periodTo;
        payrollByLocation.set(location, bucket);
      }

      for (const row of snapshotRows) {
        const p = payrollByLocation.get(row.location_name);
        if (!p) continue;
        row.gross_payroll       = +p.gross.toFixed(2);
        row.net_payroll         = +p.net.toFixed(2);
        row.tax_total           = +p.tax.toFixed(2);
        row.payroll_period_from = p.periodFrom?.slice(0, 10) ?? null;
        row.payroll_period_to   = p.periodTo?.slice(0, 10) ?? null;
      }
    } catch (e) {
      warnings.push(`payslip fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ── 3. Upsert hr_talexio_daily_snapshot ────────────────────────────────
    if (snapshotRows.length > 0) {
      const { error: snapErr } = await supabase
        .from("hr_talexio_daily_snapshot")
        .upsert(snapshotRows, {
          onConflict: "snapshot_date,location_name,brand_name",
        });
      if (snapErr) throw new Error(`snapshot upsert: ${snapErr.message}`);
      rowsUpserted += snapshotRows.length;
    }

    // ── 4. Upsert hr_headcount_monthly (current month only) ────────────────
    const monthlyRows = Array.from(headcountByLocation.entries()).map(
      ([location_name, v]) => ({
        month:                monthStart(date),
        location_name,
        brand_name:           v.brand,
        active_employees:     v.active,
        terminated_employees: v.terminated,
        new_joiners:          0,
        leavers:              0,
        turnover_rate:        null as number | null,
      }),
    );
    if (monthlyRows.length > 0) {
      const { error: monErr } = await supabase
        .from("hr_headcount_monthly")
        .upsert(monthlyRows, {
          onConflict: "month,location_name,brand_name",
        });
      if (monErr) throw new Error(`headcount_monthly upsert: ${monErr.message}`);
      rowsUpserted += monthlyRows.length;
    }

    // ── 5. Shifts for today → hr_shifts_daily ──────────────────────────────
    if (activeEmployeeIds.length > 0) {
      try {
        // The Talexio shifts query expects employeeIds + dateFrom/dateTo.
        // Batch in chunks of 100 IDs to avoid URL-length limits.
        const CHUNK = 100;
        const shiftRows: Array<{
          shift_date:           string;
          employee_name:        string;
          employee_talexio_id:  string;
          scheduled_start:      string;
          scheduled_end:        string | null;
          shift_label:          string | null;
          shift_type:           string | null;
          location_name:        string | null;
        }> = [];

        // Build a lookup: employee_id → location_name (from headcount pass)
        const employeeIdToLocation = new Map<string, string>();
        for (const e of employees) {
          const unit = e.currentPositionSimple?.organisationUnit?.name ?? null;
          const loc = normaliseLocation(unit) ?? "Spa";
          employeeIdToLocation.set(e.id, loc);
        }

        for (let i = 0; i < activeEmployeeIds.length; i += CHUNK) {
          const chunk = activeEmployeeIds.slice(i, i + CHUNK);
          const shiftData = await callTalexio<{ selectedEmployees: ShiftEmployee[] }>("shifts", {
            employeeIds: chunk.join(","),
            dateFrom:    date,
            dateTo:      date,
          });
          for (const emp of shiftData.selectedEmployees ?? []) {
            for (const s of emp.workShifts ?? []) {
              const start = isoTimeFromTalexio(s.from);
              if (!start) continue;
              shiftRows.push({
                shift_date:          s.date?.slice(0, 10) ?? date,
                employee_name:       emp.fullName,
                employee_talexio_id: emp.id,
                scheduled_start:     start,
                scheduled_end:       isoTimeFromTalexio(s.to),
                shift_label:         s.label ?? null,
                shift_type:          s.type ?? null,
                location_name:       employeeIdToLocation.get(emp.id) ?? null,
              });
            }
          }
        }

        if (shiftRows.length > 0) {
          const { error: shErr } = await supabase
            .from("hr_shifts_daily")
            .upsert(shiftRows, {
              onConflict: "shift_date,employee_talexio_id,scheduled_start",
            });
          if (shErr) throw new Error(`shifts upsert: ${shErr.message}`);
          rowsUpserted += shiftRows.length;
        }
      } catch (e) {
        warnings.push(`shift fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const status: "success" | "partial" = warnings.length > 0 ? "partial" : "success";
    await finish(status, warnings.length ? warnings.join("; ") : undefined);

    return NextResponse.json({
      status:        "ok",
      date,
      rows_upserted: rowsUpserted,
      warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("failed", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Also support GET for ease of manual triggering (matches other ETL routes' health usage). */
export async function GET(req: NextRequest) {
  return POST(req);
}

// Help reduce dead-code-warning lint noise for the BrandName export. The map
// is intentionally referenced even if unused below — keeps imports stable.
void LOCATION_TO_BRAND;
