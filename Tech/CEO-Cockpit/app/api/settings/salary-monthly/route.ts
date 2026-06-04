/**
 * GET /api/settings/salary-monthly
 *
 * Monthly salary per employee per org from transactions_raw (wages COA)
 * PLUS frozen supplemental salary from salary_supplement_monthly.
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
  const headers = {
    apikey:        key,
    Authorization: `Bearer ${key}`,
    Prefer:        "count=none",
  };

  const zohoQs = new URLSearchParams([
    ["select",      "contact_name,org,date,amount"],
    ["ebitda_line", "eq.wages"],
    ["date",        `gte.${dateFrom}`],
    ["date",        `lte.${dateTo}`],
    ["limit",       "2000"],
    ["order",       "date.asc,contact_name.asc"],
  ]);

  // Supplements are stored as the 1st of each month (DATE). Filter to the same window.
  const suppQs = new URLSearchParams([
    ["select",    "month,employee_name,amount,spa_slug"],
    ["is_frozen", "eq.true"],
    ["month",     `gte.${dateFrom.slice(0, 7)}-01`],
    ["month",     `lte.${dateTo.slice(0, 7)}-01`],
    ["limit",     "500"],
    ["order",     "month.asc,employee_name.asc"],
  ]);

  const [zohoRes, suppRes] = await Promise.all([
    fetch(`${base}/rest/v1/transactions_raw?${zohoQs}`, { headers, cache: "no-store" }),
    fetch(`${base}/rest/v1/salary_supplement_monthly?${suppQs}`, { headers, cache: "no-store" }),
  ]);

  if (!zohoRes.ok) {
    const text = await zohoRes.text();
    return NextResponse.json({ error: `Supabase ${zohoRes.status}: ${text}` }, { status: 502 });
  }

  const rawRows: Array<{ contact_name: string; org: string; date: string; amount: number }> =
    await zohoRes.json();

  let suppRows: Array<{ month: string; employee_name: string; amount: number; spa_slug: string | null }> = [];
  if (suppRes.ok) suppRows = await suppRes.json();

  // ── Step 1: Group Zoho wages by contact_name + org + month (YYYY-MM) ────────
  const grouped = new Map<string, number>();
  const monthSet = new Set<string>();

  for (const row of rawRows) {
    const name  = (row.contact_name ?? "").trim();
    const org   = (row.org ?? "").toLowerCase();
    const month = (row.date ?? "").slice(0, 7);
    if (!month || !name) continue;
    const k = `${name}\x00${org}\x00${month}`;
    grouped.set(k, (grouped.get(k) ?? 0) + row.amount);
    monthSet.add(month);
  }

  // ── Step 2: Build employee records ──────────────────────────────────────────
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
    emp.total          = Math.round((emp.total + amount) * 100) / 100;
  }

  // ── Step 3: Merge frozen supplements ────────────────────────────────────────
  // Try to match supplement employee_name to a Zoho contact_name (case-insensitive).
  // If matched, the supplement is added to the existing employee's row.
  // If unmatched, a new row is created (org derived from spa_slug presence).
  const nameIndex = new Map<string, string>(); // normalised name → empMap key
  for (const [ek, emp] of empMap) {
    const norm = emp.contact_name.toLowerCase().trim().replace(/\s+/g, " ");
    if (!nameIndex.has(norm)) nameIndex.set(norm, ek);
  }

  for (const supp of suppRows) {
    const suppName = (supp.employee_name ?? "").trim();
    if (!suppName || !supp.amount) continue;
    const month = (supp.month ?? "").slice(0, 7);
    if (!month) continue;

    const normName = suppName.toLowerCase().replace(/\s+/g, " ");
    let ek = nameIndex.get(normName);

    if (!ek) {
      const org = supp.spa_slug ? "spa" : "supplement";
      ek = `${suppName}\x00${org}`;
      if (!empMap.has(ek)) {
        empMap.set(ek, { contact_name: suppName, org, monthly: {}, total: 0 });
        nameIndex.set(normName, ek);
      }
    }

    const emp = empMap.get(ek)!;
    emp.monthly[month] = Math.round(((emp.monthly[month] ?? 0) + supp.amount) * 100) / 100;
    emp.total          = Math.round((emp.total + supp.amount) * 100) / 100;
    monthSet.add(month);
  }

  const months = Array.from(monthSet).sort();
  const employees = Array.from(empMap.values()).sort(
    (a, b) => a.contact_name.localeCompare(b.contact_name) || a.org.localeCompare(b.org),
  );

  return NextResponse.json({ date_from: dateFrom, date_to: dateTo, months, employees });
}
