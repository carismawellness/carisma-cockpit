/**
 * We360 Dynamic Report API client.
 *
 *   POST https://api.in.we360.ai/query/external/reports/dynamic_report
 *   Headers: Authorization: Bearer <token>, X-Tenant-Id: <customer_id>
 *   Body: { start_date, end_date, mode, columns[], page, limit, ...filters }
 *
 * `mode`:
 *   - "detailed" → one row per employee per day (attendance_date, punch_*).
 *   - "summary"  → one aggregated row per employee for the window
 *                  (no per-day / punch columns allowed).
 *
 * Valid column names (enforced server-side, full enum as of 2026-06):
 *   active_duration, active_percent, attendance_date, avg_active_duration,
 *   avg_break_duration, avg_idle_duration, avg_neutral_duration,
 *   avg_online_duration, avg_prod_duration, avg_unprod_duration,
 *   break_duration, created_date, designation, email, employee_id,
 *   first_name, gender, group_name, identity_id, idle_duration, idle_percent,
 *   key_presses, last_name, manager, mouse_clicks, neutral_duration,
 *   online_duration, online_in_sec, phone_number, productive_duration,
 *   productive_percent, punch_date, punch_duration, punch_in,
 *   punch_in_location, punch_out, punch_out_location, secondary_email,
 *   shift_end_dt, shift_name, shift_start_dt, top_application_duration,
 *   top_application_used, top_url_duration, top_url_used, unproductive_duration
 *   (plus custom c_* fields and HRIS sync fields: keka_*, darwinbox_*).
 */

import { we360Token, we360TenantId } from "./auth";

const REPORT_URL =
  "https://api.in.we360.ai/query/external/reports/dynamic_report";

export type We360Mode = "detailed" | "summary";

export interface We360ReportParams {
  start_date: string; // YYYY-MM-DD
  end_date:   string; // YYYY-MM-DD
  mode:       We360Mode;
  columns:    string[];
  page?:      number;
  limit?:     number;
  group_id?:  string;
  user_id?:   string;
  shift?:     string;
}

export interface We360Pagination {
  page:           number;
  limit:          number;
  total_records:  number;
  total_pages:    number;
  has_next:       boolean;
  has_previous:   boolean;
}

export interface We360ReportResponse<T = Record<string, unknown>> {
  data:       T[];
  pagination: We360Pagination;
  meta?:      Record<string, unknown>;
}

/** Single page of a dynamic report. */
export async function we360DynamicReport<T = Record<string, unknown>>(
  params: We360ReportParams,
): Promise<We360ReportResponse<T>> {
  const token = await we360Token();
  const resp = await fetch(REPORT_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "X-Tenant-Id":  we360TenantId(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page: 1, limit: 100, ...params }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`We360 dynamic_report failed ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as
    | We360ReportResponse<T>
    | { status: false; message?: string; error_code?: string };

  if ("status" in json && json.status === false) {
    throw new Error(
      `We360 dynamic_report error: ${json.message ?? json.error_code ?? "unknown"}`,
    );
  }
  return json as We360ReportResponse<T>;
}

/** Fetches every page of a dynamic report and returns the concatenated rows. */
export async function we360DynamicReportAll<T = Record<string, unknown>>(
  params: We360ReportParams,
): Promise<T[]> {
  const limit = params.limit ?? 200;
  const rows: T[] = [];
  let page = params.page ?? 1;
  // Hard cap to avoid runaway loops; 500 pages × 200 = 100k rows.
  for (let i = 0; i < 500; i++) {
    const res = await we360DynamicReport<T>({ ...params, page, limit });
    rows.push(...res.data);
    if (!res.pagination?.has_next) break;
    page += 1;
  }
  return rows;
}
