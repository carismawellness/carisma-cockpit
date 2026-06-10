/**
 * /api/finance/salary-roster
 *
 * Returns all wage earners for the given date range across all venues,
 * with salary prorated to the period. No role filter — returns everyone
 * who appears in transactions_raw (wages) or salary_supplement_monthly.
 *
 * Response: { data: Array<{ venue, employee_name, salary }> }
 */

import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SPA_VENUES = ["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"];
const ALL_VENUES = [...SPA_VENUES, "aesthetics", "slimming"];

function norm(s: string): string {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86_400_000) + 1;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const salaryMap = new Map<string, { salary: number; venue: string; rawName: string }>();

  // 1. transactions_raw — actual wage entries
  const { data: wageTxns } = await supabase
    .from("transactions_raw")
    .select("venue, contact_name, amount")
    .eq("ebitda_line", "wages")
    .in("venue", ALL_VENUES)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  for (const t of wageTxns ?? []) {
    const name = (t.contact_name as string) || "";
    if (!name) continue;
    const venue = (t.venue as string) || "";
    const key = `${venue}|${norm(name)}`;
    const ex = salaryMap.get(key) ?? { salary: 0, venue, rawName: name };
    ex.salary += Number(t.amount ?? 0);
    salaryMap.set(key, ex);
  }

  // 2. salary_supplement_monthly — frozen prorated supplements
  const months: string[] = [];
  let y = parseInt(dateFrom.slice(0, 4), 10);
  let m = parseInt(dateFrom.slice(5, 7), 10);
  const ey = parseInt(dateTo.slice(0, 4), 10);
  const em = parseInt(dateTo.slice(5, 7), 10);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m++; if (m > 12) { m = 1; y++; }
  }

  const { data: suppData } = await supabase
    .from("salary_supplement_monthly")
    .select("spa_slug, employee_name, amount, month")
    .in("spa_slug", ALL_VENUES)
    .in("month", months.length ? months : ["1900-01-01"]);

  for (const s of suppData ?? []) {
    const name = (s.employee_name as string) || "";
    if (!name) continue;
    const venue = (s.spa_slug as string) || "";
    const mStr  = (s.month as string).slice(0, 10);
    const mY    = parseInt(mStr.slice(0, 4), 10);
    const mMo   = parseInt(mStr.slice(5, 7), 10);
    const lastD = new Date(mY, mMo, 0).getDate();
    const mEnd  = `${mY}-${String(mMo).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;
    const rs    = dateFrom > mStr ? dateFrom : mStr;
    const re    = dateTo   < mEnd ? dateTo   : mEnd;
    const dr    = rs > re ? 0 : daysBetween(rs, re);
    const prorated = Number(s.amount ?? 0) * (dr / lastD);
    if (prorated <= 0) continue;
    const key = `${venue}|${norm(name)}`;
    const ex  = salaryMap.get(key) ?? { salary: 0, venue, rawName: name };
    ex.salary += prorated;
    salaryMap.set(key, ex);
  }

  const data = [...salaryMap.values()]
    .filter(r => r.salary > 0)
    .map(r => ({ venue: r.venue, employee_name: r.rawName, salary: +r.salary.toFixed(2) }));

  return NextResponse.json({ data });
}
