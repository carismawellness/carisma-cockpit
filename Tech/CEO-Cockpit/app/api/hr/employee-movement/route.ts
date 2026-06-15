/**
 * GET /api/hr/employee-movement?weeks=N
 *
 * Returns the last N weeks of employee movement from hr_employee_movement_weekly.
 * Defaults to 26 weeks (6 months). Max 104 weeks.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weeks = Math.min(parseInt(searchParams.get("weeks") ?? "26", 10), 104);
  if (isNaN(weeks) || weeks < 1) {
    return NextResponse.json({ error: "weeks must be 1-104" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Get the most recent N weeks ordered oldest-first for chart display
  const { data: recent, error: e2 } = await supabase
    .from("hr_employee_movement_weekly")
    .select("week_start, week_end, joiners, leavers, net, total_headcount, joiner_names, leaver_names, date_source")
    .order("week_start", { ascending: false })
    .limit(weeks);

  if (e2) {
    return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  const rows = (recent ?? []).reverse(); // oldest-first for chart display

  const totalJoiners  = rows.reduce((s, r) => s + r.joiners, 0);
  const totalLeavers  = rows.reduce((s, r) => s + r.leavers, 0);
  const currentTotal  = rows.at(-1)?.total_headcount ?? 0;
  const firstTotal    = rows[0]?.total_headcount ?? currentTotal;
  const netMovement   = currentTotal - firstTotal;

  return NextResponse.json({
    weeks: rows.map((r) => ({
      weekStart:      r.week_start,
      weekEnd:        r.week_end,
      label:          shortWeekLabel(r.week_start as string),
      joiners:        r.joiners,
      leavers:        r.leavers,
      net:            r.net,
      total:          r.total_headcount,
      joinerNames:    (r.joiner_names as string[]) ?? [],
      leaverNames:    (r.leaver_names as string[]) ?? [],
      dateSource:     r.date_source,
    })),
    summary: {
      currentTotal,
      totalJoiners,
      totalLeavers,
      netMovement,
    },
    rowCount: rows.length,
  });
}

function shortWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
