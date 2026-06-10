/**
 * We360 → Supabase productivity ETL.
 *
 * Pulls "detailed" mode (one row per employee per day) for a date window and
 * UPSERTs into `we360_productivity_daily` keyed on (email, attendance_date).
 *
 * Durations arrive as "H:MM:SS" strings → stored as integer seconds.
 * Percentages arrive as numbers or "-" (no data) → stored as numeric|null.
 */

import { we360DynamicReportAll } from "@/lib/we360/report";
import { upsert } from "@/lib/etl/supabase-etl";

const DETAILED_COLUMNS = [
  "first_name",
  "last_name",
  "email",
  "group_name",
  "shift_name",
  "attendance_date",
  "punch_in",
  "punch_out",
  "online_duration",
  "active_duration",
  "idle_duration",
  "productive_duration",
  "unproductive_duration",
  "neutral_duration",
  "break_duration",
  "active_percent",
  "productive_percent",
  "idle_percent",
  "mouse_clicks",
  "key_presses",
  "top_application_used",
  "top_url_used",
] as const;

interface We360DetailedRow {
  first_name?: string;
  last_name?: string;
  email?: string;
  group_name?: string;
  shift_name?: string;
  attendance_date?: string;
  punch_in?: string;
  punch_out?: string;
  online_duration?: string;
  active_duration?: string;
  idle_duration?: string;
  productive_duration?: string;
  unproductive_duration?: string;
  neutral_duration?: string;
  break_duration?: string;
  active_percent?: number | string;
  productive_percent?: number | string;
  idle_percent?: number | string;
  mouse_clicks?: number | string;
  key_presses?: number | string;
  top_application_used?: string;
  top_url_used?: string;
}

/** "H:MM:SS" | "MM:SS" → integer seconds. "-"/empty → null. */
function durationToSec(v: string | undefined | null): number | null {
  if (!v || v === "-") return null;
  const parts = v.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}

function num(v: number | string | undefined | null): number | null {
  if (v === undefined || v === null || v === "-" || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function intOrNull(v: number | string | undefined | null): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** "2026-06-01 11:55:39" (tenant-local) → ISO timestamp string. null on "-". */
function tsOrNull(v: string | undefined | null): string | null {
  if (!v || v === "-") return null;
  // API returns "YYYY-MM-DD HH:MM:SS"; treat as-is (no tz conversion).
  return v.replace(" ", "T");
}

export interface We360EtlResult {
  rowsUpserted: number;
  daysCovered:  number;
  employees:    number;
}

/**
 * Run the We360 productivity ETL for [startDate, endDate] (inclusive, ISO dates).
 */
export async function runWe360ProductivityEtl(
  startDate: string,
  endDate: string,
): Promise<We360EtlResult> {
  const raw = await we360DynamicReportAll<We360DetailedRow>({
    start_date: startDate,
    end_date:   endDate,
    mode:       "detailed",
    columns:    [...DETAILED_COLUMNS],
    limit:      500,
  });

  const rows = raw
    .filter((r) => r.email && r.attendance_date)
    .map((r) => ({
      attendance_date:           r.attendance_date,
      email:                     r.email!.toLowerCase().trim(),
      first_name:                r.first_name ?? null,
      last_name:                 r.last_name ?? null,
      group_name:                r.group_name && r.group_name !== "-" ? r.group_name : null,
      shift_name:                r.shift_name && r.shift_name !== "-" ? r.shift_name : null,
      punch_in:                  tsOrNull(r.punch_in),
      punch_out:                 tsOrNull(r.punch_out),
      online_duration_sec:       durationToSec(r.online_duration),
      active_duration_sec:       durationToSec(r.active_duration),
      idle_duration_sec:         durationToSec(r.idle_duration),
      productive_duration_sec:   durationToSec(r.productive_duration),
      unproductive_duration_sec: durationToSec(r.unproductive_duration),
      neutral_duration_sec:      durationToSec(r.neutral_duration),
      break_duration_sec:        durationToSec(r.break_duration),
      active_percent:            num(r.active_percent),
      productive_percent:        num(r.productive_percent),
      idle_percent:              num(r.idle_percent),
      mouse_clicks:              intOrNull(r.mouse_clicks),
      key_presses:               intOrNull(r.key_presses),
      top_application_used:      r.top_application_used && r.top_application_used !== "-" ? r.top_application_used : null,
      top_url_used:              r.top_url_used && r.top_url_used !== "-" ? r.top_url_used : null,
      synced_at:                 new Date().toISOString(),
    }));

  const rowsUpserted = await upsert(
    "we360_productivity_daily",
    rows,
    "email,attendance_date",
  );

  return {
    rowsUpserted,
    daysCovered: new Set(rows.map((r) => r.attendance_date)).size,
    employees:   new Set(rows.map((r) => r.email)).size,
  };
}
