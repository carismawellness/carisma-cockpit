/**
 * POST /api/etl/attendance-daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 *
 * Pulls published roster (workShifts) + time logs from Talexio for the given
 * date range, computes lateness / early-departure flags, and upserts to the
 * `attendance_daily` Supabase table.
 *
 * Grace periods (both applied before flagging):
 *   is_late       → clock-in is more than 15 min after scheduled_start
 *   left_early    → clock-out is more than 15 min before scheduled_end
 *
 * Only employees with a published shift on a given date are written. Employees
 * without any time log for a rostered day are recorded as is_absent = true.
 *
 * Nightly cron passes yesterday's date. Manual backfills can pass a wider range.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { talexioQuery } from "@/lib/talexio/auth";
import { normaliseLocation } from "@/lib/constants/hr-mapping";

export const maxDuration = 120;

const LATE_GRACE_MINUTES  = 15;
const EARLY_GRACE_MINUTES = 15;

// ── Types ────────────────────────────────────────────────────────────────────

type GqlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

interface RawEmployee {
  id: string;
  fullName: string;
  isTerminated: boolean;
  currentPositionSimple: { organisationUnit: { name: string } | null } | null;
  workShifts: Array<{ id: string; date: string; from: string | null; to: string | null }>;
  timeLogs: Array<{ id: string; from: string | null; to: string | null }>;
}

// ── Query ────────────────────────────────────────────────────────────────────

const GQL_ATTENDANCE = `
query ($dateFrom: Date!, $dateTo: Date!) {
  employees {
    id fullName isTerminated
    currentPositionSimple {
      organisationUnit { name }
    }
    workShifts(dateFrom: $dateFrom, dateTo: $dateTo, onlyPublished: true) {
      id date from to
    }
    timeLogs {
      ... on TimeLogEntry {
        id from to
      }
    }
  }
}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function toMalta(isoStr: string | null | undefined): { date: string; hhmm: string } | null {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    const local = d.toLocaleString("sv-SE", { timeZone: "Europe/Malta" });
    const [date, time] = local.split(" ");
    return { date, hhmm: time.slice(0, 5) };
  } catch {
    return null;
  }
}

function shiftTimeToHHMM(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Shift from/to may be ISO datetimes or plain HH:MM[:SS]
  if (raw.includes("T")) return toMalta(raw)?.hhmm ?? null;
  const m = raw.match(/^(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function parseHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(":");
  const h = parseInt(parts[0] ?? "");
  const m = parseInt(parts[1] ?? "");
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function todayISO(): string {
  const d = new Date();
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Malta" }).slice(0, 10);
}

function yesterdayISO(): string {
  const d = new Date(Date.now() - 86_400_000);
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Malta" }).slice(0, 10);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") || yesterdayISO();
  const dateTo   = searchParams.get("dateTo")   || todayISO();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom and dateTo must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase    = getAdminClient();
  const startedAt   = Date.now();
  let rowsUpserted  = 0;
  const warnings: string[] = [];

  // Log start
  const { data: logRow } = await supabase
    .from("etl_sync_log")
    .insert({ source_name: "attendance-daily", status: "running" })
    .select("id")
    .single();
  const logId = (logRow?.id as number | undefined) ?? null;

  async function finish(status: "success" | "partial" | "failed", errorMsg?: string) {
    if (logId == null) return;
    await supabase.from("etl_sync_log").update({
      completed_at:  new Date().toISOString(),
      status,
      rows_upserted: rowsUpserted,
      error_message: errorMsg ?? null,
      duration_sec:  (Date.now() - startedAt) / 1000,
    }).eq("id", logId);
  }

  try {
    const json = (await talexioQuery(GQL_ATTENDANCE, { dateFrom, dateTo })) as GqlResponse<{ employees: RawEmployee[] }>;
    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));
    if (!json.data) throw new Error("Talexio returned no data");

    const employees = json.data.employees ?? [];
    // Keyed by "employee_id:date" — merges multiple shifts on the same day
    const upsertMap = new Map<string, Record<string, unknown>>();

    for (const emp of employees) {
      if (emp.isTerminated) continue;

      const unit = emp.currentPositionSimple?.organisationUnit?.name ?? null;
      const location = normaliseLocation(unit) ?? null;

      // Build a date → earliest clock-in, latest clock-out lookup from all time logs
      const clockInByDate  = new Map<string, number>(); // date → minutes since midnight
      const clockOutByDate = new Map<string, number>();

      for (const log of emp.timeLogs ?? []) {
        const inParsed = toMalta(log.from);
        if (!inParsed) continue;
        if (inParsed.date < dateFrom || inParsed.date > dateTo) continue;

        const inMins = parseHHMM(inParsed.hhmm);
        if (inMins !== null) {
          const prev = clockInByDate.get(inParsed.date);
          if (prev === undefined || inMins < prev) clockInByDate.set(inParsed.date, inMins);
        }

        const outParsed = toMalta(log.to);
        if (outParsed) {
          const outMins = parseHHMM(outParsed.hhmm);
          if (outMins !== null) {
            const prev = clockOutByDate.get(inParsed.date); // key on clock-in date
            if (prev === undefined || outMins > prev) clockOutByDate.set(inParsed.date, outMins);
          }
        }
      }

      // One logical row per (employee, date) — merge multiple shifts for split-day schedules
      for (const shift of emp.workShifts ?? []) {
        const date = shift.date?.slice(0, 10);
        if (!date) continue;

        const key = `${emp.id}:${date}`;
        const newStartHHMM = shiftTimeToHHMM(shift.from);
        const newEndHHMM   = shiftTimeToHHMM(shift.to);
        const newStartMins = parseHHMM(newStartHHMM);
        const newEndMins   = parseHHMM(newEndHHMM);

        // Merge with existing row for this day (earliest start, latest end)
        const existing = upsertMap.get(key);
        const schedStartMins = existing
          ? (newStartMins !== null && (existing._schedStartMins as number | null) !== null
              ? Math.min(newStartMins, existing._schedStartMins as number)
              : (existing._schedStartMins as number | null) ?? newStartMins)
          : newStartMins;
        const schedEndMins = existing
          ? (newEndMins !== null && (existing._schedEndMins as number | null) !== null
              ? Math.max(newEndMins, existing._schedEndMins as number)
              : (existing._schedEndMins as number | null) ?? newEndMins)
          : newEndMins;
        const schedStartHHMM = schedStartMins !== null ? minutesToHHMM(schedStartMins) : null;
        const schedEndHHMM   = schedEndMins   !== null ? minutesToHHMM(schedEndMins)   : null;

        const clockInMins  = clockInByDate.get(date)  ?? null;
        const clockOutMins = clockOutByDate.get(date)  ?? null;
        const isAbsent = clockInMins === null;

        // Late: clock-in > scheduled_start + 15 min grace
        let isLate = false;
        let minutesLate = 0;
        if (!isAbsent && schedStartMins !== null && clockInMins !== null) {
          const excess = clockInMins - (schedStartMins + LATE_GRACE_MINUTES);
          if (excess > 0) { isLate = true; minutesLate = excess; }
        }

        // Left early: clock-out < scheduled_end - 15 min grace
        let leftEarly = false;
        let minutesEarlyOut = 0;
        if (!isAbsent && schedEndMins !== null && clockOutMins !== null) {
          const deficit = (schedEndMins - EARLY_GRACE_MINUTES) - clockOutMins;
          if (deficit > 0) { leftEarly = true; minutesEarlyOut = deficit; }
        }

        // Hours worked (clock-in to clock-out, same calendar day)
        let hoursWorked: number | null = null;
        if (clockInMins !== null && clockOutMins !== null && clockOutMins > clockInMins) {
          hoursWorked = Math.round(((clockOutMins - clockInMins) / 60) * 100) / 100;
        }

        upsertMap.set(key, {
          _schedStartMins: schedStartMins,
          _schedEndMins:   schedEndMins,
          employee_id:      emp.id,
          employee_name:    emp.fullName,
          date,
          clock_in:         clockInMins  !== null ? minutesToHHMM(clockInMins)  : null,
          clock_out:        clockOutMins !== null ? minutesToHHMM(clockOutMins) : null,
          scheduled_start:  schedStartHHMM,
          scheduled_end:    schedEndHHMM,
          is_absent:        isAbsent,
          is_late:          isLate,
          left_early:       leftEarly,
          minutes_late:     minutesLate,
          minutes_early_out: minutesEarlyOut,
          hours_worked:     hoursWorked,
          location_name:    location,
          synced_at:        new Date().toISOString(),
        });
      }
    }

    // Strip internal merge helpers before upserting
    const upsertRows = Array.from(upsertMap.values()).map(({ _schedStartMins, _schedEndMins, ...row }) => row);

    if (upsertRows.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < upsertRows.length; i += CHUNK) {
        const chunk = upsertRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("attendance_daily")
          .upsert(chunk, { onConflict: "employee_id,date" });
        if (error) throw new Error(`upsert error: ${error.message}`);
        rowsUpserted += chunk.length;
      }
    }

    const status: "success" | "partial" = warnings.length > 0 ? "partial" : "success";
    await finish(status, warnings.length ? warnings.join("; ") : undefined);

    return NextResponse.json({
      status: "ok",
      dateFrom,
      dateTo,
      rows_upserted: rowsUpserted,
      warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("failed", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
