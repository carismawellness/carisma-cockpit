/**
 * GET /api/hr/we360-productivity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Aggregates We360 per-employee productivity over the date range into the shape
 * the HR Productivity Leaderboard chart expects: average daily hours split by
 * category (productive / neutral / unproductive / idle), overall productive %,
 * sorted by productive % descending.
 *
 * Source: we360_productivity_daily (populated by /api/etl/we360).
 * Only days with recorded activity (online_duration_sec > 0) count toward the
 * per-employee daily averages, so part-time / partial roster members aren't
 * penalised by zero-days.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic     = "force-dynamic";
export const maxDuration = 60;

interface Row {
  email: string;
  first_name: string | null;
  last_name: string | null;
  online_duration_sec: number | null;
  productive_duration_sec: number | null;
  unproductive_duration_sec: number | null;
  neutral_duration_sec: number | null;
  idle_duration_sec: number | null;
  active_duration_sec: number | null;
}

interface Agg {
  email: string;
  first_name: string | null;
  last_name: string | null;
  days: number;
  productive: number;
  unproductive: number;
  neutral: number;
  idle: number;
  online: number;
}

const SEC_PER_HOUR = 3600;

function displayName(first: string | null, last: string | null, email: string): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f && l) return `${f} ${l.charAt(0).toUpperCase()}.`;
  if (f) return f;
  // hashed pseudo-email (…@tenant.we360.local) → fall back to the local part
  const local = email.split("@")[0];
  return local.length > 14 ? `${local.slice(0, 10)}…` : local;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("we360_productivity_daily")
    .select(
      "email, first_name, last_name, online_duration_sec, productive_duration_sec, unproductive_duration_sec, neutral_duration_sec, idle_duration_sec, active_duration_sec",
    )
    .gte("attendance_date", from)
    .lte("attendance_date", to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];

  // Aggregate per employee over active days only.
  const byEmail = new Map<string, Agg>();
  for (const r of rows) {
    const online = r.online_duration_sec ?? 0;
    if (online <= 0) continue; // skip no-activity days
    let a = byEmail.get(r.email);
    if (!a) {
      a = {
        email: r.email,
        first_name: r.first_name,
        last_name: r.last_name,
        days: 0,
        productive: 0,
        unproductive: 0,
        neutral: 0,
        idle: 0,
        online: 0,
      };
      byEmail.set(r.email, a);
    }
    a.days += 1;
    a.productive   += r.productive_duration_sec ?? 0;
    a.unproductive += r.unproductive_duration_sec ?? 0;
    a.neutral      += r.neutral_duration_sec ?? 0;
    a.idle         += r.idle_duration_sec ?? 0;
    a.online       += online;
  }

  const employees = [...byEmail.values()]
    .map((a) => {
      const hrs = (sec: number) => Math.round((sec / a.days / SEC_PER_HOUR) * 10) / 10;
      const productive   = hrs(a.productive);
      const unproductive = hrs(a.unproductive);
      const neutral      = hrs(a.neutral);
      const idle         = hrs(a.idle);
      // Use segment sum for totalHrs so the label % is mathematically consistent
      // with the visual bar. We360's online_duration_sec can include unclassified
      // time that isn't reflected in the four named segments, which would make
      // (productive/online) give a lower % than the bar visually implies.
      const segTotal      = Math.round((productive + neutral + unproductive + idle) * 10) / 10;
      const productivePct = segTotal > 0 ? Math.round((productive / segTotal) * 100) : 0;
      const totalHrs      = segTotal.toFixed(1);
      return {
        name: displayName(a.first_name, a.last_name, a.email),
        Productive:   productive,
        Neutral:      neutral,
        Unproductive: unproductive,
        Idle:         idle,
        productivePct,
        totalHrs,
        // Pre-formatted label used by the Recharts LabelList to avoid index
        // misalignment in stacked vertical bar charts.
        barLabel: `${productivePct}% — ${totalHrs}h`,
        days: a.days,
      };
    })
    .sort((x, y) => y.productivePct - x.productivePct);

  return NextResponse.json({
    from,
    to,
    employees,
    count: employees.length,
  });
}
