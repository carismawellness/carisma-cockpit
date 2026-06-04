/**
 * GET /api/settings/salary-monthly
 *
 * Monthly salary per employee per org from transactions_raw (wages COA).
 * Used by the Employee Mapping page to render the salary pivot table.
 *
 * Query params:
 *   date_from  — YYYY-MM-DD, default 2025-01-01
 *   date_to    — YYYY-MM-DD, default today
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from") ?? "2025-01-01";
  const dateTo   = searchParams.get("date_to")   ?? new Date().toISOString().slice(0, 10);

  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) {
    return NextResponse.json(
      { error: "date_from and date_to must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const qs = new URLSearchParams([
    ["select",      "contact_name,org,date,amount"],
    ["ebitda_line", "eq.wages"],
    ["date",        `gte.${dateFrom}`],
    ["date",        `lte.${dateTo}`],
    ["limit",       "2000"],
    ["order",       "date.asc,contact_name.asc"],
  ]);

  let rawRows: Array<{ contact_name: string; org: string; date: string; amount: number }>;
  try {
    const res = await fetch(`${base}/rest/v1/transactions_raw?${qs}`, {
      headers: {
        apikey:        key,
        Authorization: `Bearer ${key}`,
        Prefer:        "count=none",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Supabase ${res.status}: ${text}` }, { status: 502 });
    }
    rawRows = await res.json();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  // Group by contact_name + org + month (YYYY-MM)
  const grouped = new Map<string, number>();
  const monthSet = new Set<string>();

  for (const row of rawRows) {
    const name  = (row.contact_name ?? "").trim();
    const org   = (row.org ?? "").toLowerCase();
    const month = (row.date ?? "").slice(0, 7); // "2026-01"
    if (!month || !name) continue;
    // \x00 is safe — won't appear in contact names or org slugs
    const k = `${name}\x00${org}\x00${month}`;
    grouped.set(k, (grouped.get(k) ?? 0) + row.amount);
    monthSet.add(month);
  }

  const months = Array.from(monthSet).sort();

  type EmpRecord = {
    contact_name: string;
    org: string;
    monthly: Record<string, number>;
    total: number;
  };
  const empMap = new Map<string, EmpRecord>();

  for (const [k, amount] of grouped) {
    const [name, org, month] = k.split("\x00");
    const ek = `${name}\x00${org}`;
    if (!empMap.has(ek)) {
      empMap.set(ek, { contact_name: name, org, monthly: {}, total: 0 });
    }
    const emp = empMap.get(ek)!;
    emp.monthly[month] = Math.round(((emp.monthly[month] ?? 0) + amount) * 100) / 100;
    emp.total = Math.round((emp.total + amount) * 100) / 100;
  }

  const employees = Array.from(empMap.values()).sort(
    (a, b) => a.contact_name.localeCompare(b.contact_name) || a.org.localeCompare(b.org),
  );

  return NextResponse.json({ date_from: dateFrom, date_to: dateTo, months, employees });
}
