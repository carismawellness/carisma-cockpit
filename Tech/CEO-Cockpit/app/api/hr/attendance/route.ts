/**
 * GET /api/hr/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD[&is_late=true][&left_early=true]
 *
 * Returns attendance records from the `attendance_daily` Supabase table for the
 * given date range, ordered by date desc then employee name. Optionally filtered
 * to only late arrivals or early departures.
 *
 * Also returns an aggregated summary for the period.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from      = searchParams.get("from");
  const to        = searchParams.get("to");
  const isLate    = searchParams.get("is_late");
  const leftEarly = searchParams.get("left_early");
  const hasIssue  = searchParams.get("has_issue");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params are required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("attendance_daily")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .order("employee_name", { ascending: true });

  if (isLate === "true")    query = query.eq("is_late", true);
  if (leftEarly === "true") query = query.eq("left_early", true);
  if (hasIssue === "true")  query = query.or("is_late.eq.true,left_early.eq.true");

  const { data: records, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Summary always covers the full date range (not filtered)
  const { data: all } = await supabase
    .from("attendance_daily")
    .select("is_absent, is_late, left_early")
    .gte("date", from)
    .lte("date", to);

  type RowFlag = { is_absent: boolean; is_late: boolean; left_early: boolean };
  const summary = {
    total_rostered:   all?.length ?? 0,
    total_absent:     all?.filter((r: RowFlag) => r.is_absent).length   ?? 0,
    total_late:       all?.filter((r: RowFlag) => r.is_late).length     ?? 0,
    total_left_early: all?.filter((r: RowFlag) => r.left_early).length  ?? 0,
  };

  return NextResponse.json({ records: records ?? [], summary });
}
