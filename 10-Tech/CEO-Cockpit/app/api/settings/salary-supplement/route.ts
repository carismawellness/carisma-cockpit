import { NextRequest, NextResponse, after } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

// The refresh kick can take 30-60s on Apps Script (Supabase fetch + sheet
// read/write + Aggregated Data cascade). after() guarantees Vercel keeps
// the function alive until the work completes, up to maxDuration — without
// it the serverless runtime would suspend mid-fetch as soon as the response
// is sent.
export const maxDuration = 120;

// Apps Script web app that owns the EBIDA Layer + Aggregated Data tabs.
// Token is the same one used by /api/finance/ebitda-aggregated.
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwU345ph3xkGH7cHQWze7wm1Bepyr-2ATFYpFnusRbGgjIGtVLIDBC_jL6NT1McJksN/exec";
const APPS_SCRIPT_TOKEN = "cbk-ebida-a7f3e91c2d";

// Schedules a post-response Apps Script refresh for the month containing
// `monthFirstDayIso` (YYYY-MM-DD, first of a month). The response returns
// immediately; Vercel's after() keeps the function alive long enough for
// the Apps Script call to complete.
//
// force=true is always passed: it's a no-op on months that were never
// verified-locked (the action records the original lock state per column
// and only re-applies #fff9c4 to columns that had it), and it correctly
// handles verified months that need a slug correction.
function kickRefreshSuppSal(monthFirstDayIso: string): void {
  // last day of the month — server runs in a Vercel UTC env, so manual math
  // is safer than Date.toISOString() acrobatics for month-end.
  const [y, m] = monthFirstDayIso.split("-").map(Number);
  const lastD = new Date(y, m, 0).getDate();   // day 0 of next month = last of this
  const to    = `${monthFirstDayIso.slice(0, 7)}-${String(lastD).padStart(2, "0")}`;
  const url =
    `${APPS_SCRIPT_URL}?token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}` +
    `&action=refresh_supp_sal` +
    `&from=${encodeURIComponent(monthFirstDayIso)}` +
    `&to=${encodeURIComponent(to)}` +
    `&force=true`;
  after(async () => {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store" });
      if (!res.ok) {
        console.warn(`[supp-sal] refresh kick HTTP ${res.status} for ${monthFirstDayIso}`);
      }
    } catch (err) {
      console.warn(`[supp-sal] refresh kick failed for ${monthFirstDayIso}: ${err}`);
    }
  });
}

async function lookupTalexioName(empNo: number): Promise<string | null> {
  const token = process.env.TALEXIO_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.talexiohr.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "https://carismaspawellness.talexiohr.com",
      },
      body: JSON.stringify({ query: `query { employees { employeeCode fullName } }` }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const emps: { employeeCode: string; fullName: string }[] = json?.data?.employees ?? [];
    return emps.find(e => parseInt(e.employeeCode, 10) === empNo)?.fullName ?? null;
  } catch {
    return null;
  }
}

// GET ?month=2026-03-01  — list all rows for a month.
// Auto-copies role from the nearest month that has role data:
//   • Prefers the closest prior month (normal forward-propagation).
//   • Falls back to the closest future month (handles historical months
//     like Jan 2025 that pre-date the first role assignments in Apr 2026).
export async function GET(req: NextRequest) {
  const supabase = getAdminClient();
  const month = req.nextUrl.searchParams.get("month");
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const { data, error } = await supabase
    .from("salary_supplement_monthly")
    .select("*")
    .eq("month", month)
    .order("employee_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-copy roles for any employee that has no role yet.
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const noRole = rows.filter((r) => !r.role);
  if (noRole.length > 0) {
    // 1. Look for the most recent prior month that has role assignments.
    const { data: priorRows } = await supabase
      .from("salary_supplement_monthly")
      .select("employee_name, role")
      .not("role", "is", null)
      .lt("month", month)
      .order("month", { ascending: false })
      .limit(500);

    // 2. If nothing prior has roles, look forward to the earliest future month
    //    that does (e.g. Apr 2026 is the first month with assignments;
    //    Jan 2025–Mar 2026 fall back here).
    const sourceRows: Array<{ employee_name: string; role: string }> =
      priorRows?.length
        ? (priorRows as Array<{ employee_name: string; role: string }>)
        : await supabase
            .from("salary_supplement_monthly")
            .select("employee_name, role")
            .not("role", "is", null)
            .gt("month", month)
            .order("month", { ascending: true })
            .limit(500)
            .then(({ data: d }) => (d ?? []) as Array<{ employee_name: string; role: string }>);

    if (sourceRows.length) {
      // Build map: employee_name → role (first entry = closest month, wins)
      const roleMap = new Map<string, string>();
      for (const r of sourceRows) {
        if (!roleMap.has(r.employee_name)) roleMap.set(r.employee_name, r.role);
      }
      for (const row of noRole) {
        const role = roleMap.get(row.employee_name as string);
        if (role) {
          await supabase
            .from("salary_supplement_monthly")
            .update({ role })
            .eq("id", row.id);
          row.role = role;
        }
      }
    }
  }

  return NextResponse.json(rows);
}

// PATCH  — freeze a month or update a single row's spa_slug
export async function PATCH(req: NextRequest) {
  const supabase = getAdminClient();
  const body = await req.json();

  // Freeze or unfreeze entire month: { month, freeze: true | false }
  if ("freeze" in body && body.month) {
    const { error } = await supabase
      .from("salary_supplement_monthly")
      .update({ is_frozen: body.freeze === true })
      .eq("month", body.month);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Kick the sheet refresh on both freeze and unfreeze. The Apps Script
    // reads is_frozen=true, so unfreeze clears the month's SUPP_SAL cells
    // (which is correct — unfrozen = not yet committed for the dashboard),
    // and freeze writes the new totals.
    kickRefreshSuppSal(body.month);
    return NextResponse.json({ ok: true });
  }

  // Update single row: { id, spa_slug } or { id, talexio_id }
  if (body.id !== undefined) {
    const updates: Record<string, unknown> = {};
    if (body.spa_slug !== undefined) updates.spa_slug = body.spa_slug || null;
    if (body.role !== undefined) updates.role = body.role || null;
    if ("talexio_id" in body) {
      const empNo = body.talexio_id ? parseInt(String(body.talexio_id), 10) : null;
      updates.talexio_id = empNo;
      updates.talexio_name = empNo ? await lookupTalexioName(empNo) : null;
    }
    // Fetch the row's month + is_frozen so we know whether to kick a
    // sheet refresh. UI gates slug edits behind is_frozen=false, but
    // direct PATCH callers can still hit this with a frozen row — in
    // which case the dashboard would diverge from Supabase until the
    // next freeze toggle. Kick the refresh whenever a frozen row's
    // slug changes so the sheet stays consistent.
    const { data: existing } = await supabase
      .from("salary_supplement_monthly")
      .select("month, is_frozen")
      .eq("id", body.id)
      .single();
    const { error } = await supabase
      .from("salary_supplement_monthly")
      .update(updates)
      .eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (existing && existing.is_frozen && body.spa_slug !== undefined) {
      kickRefreshSuppSal(existing.month);
    }
    return NextResponse.json({ ok: true, talexio_name: updates.talexio_name ?? null });
  }

  return NextResponse.json({ error: "invalid body" }, { status: 400 });
}
