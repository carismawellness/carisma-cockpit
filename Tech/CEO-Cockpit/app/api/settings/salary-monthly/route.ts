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

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Name normalisation helpers ────────────────────────────────────────────────
// Remove punctuation, collapse spaces, lowercase → used for exact fuzzy match.
function normName(n: string): string {
  return n.toLowerCase().replace(/[.\-',]/g, " ").replace(/\s+/g, " ").trim();
}
// Sort tokens alphabetically → matches "Smith John" ↔ "John Smith"
function sortedTokenKey(n: string): string {
  return normName(n).split(" ").sort().join(" ");
}

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
    ["select",      "contact_name,org,date,amount,account_code"],
    ["ebitda_line", "eq.wages"],
    ["date",        `gte.${dateFrom}`],
    ["date",        `lte.${dateTo}`],
    ["limit",       "2000"],
    ["order",       "date.asc,contact_name.asc"],
  ]);

  // Supplements are stored as the 1st of each month (DATE). Filter to same window.
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

  const rawRows: Array<{
    contact_name: string; org: string; date: string; amount: number; account_code: string;
  }> = await zohoRes.json();

  let suppRows: Array<{
    month: string; employee_name: string; amount: number; spa_slug: string | null;
  }> = [];
  if (suppRes.ok) suppRows = await suppRes.json();

  // ── Step 1: Build employee records from Zoho wages ───────────────────────────
  type EmpRecord = {
    contact_name: string;
    org: string;
    monthly: Record<string, number>;
    total: number;
    coaCodes: Set<string>;
    hasSupplement: boolean;
  };
  const empMap = new Map<string, EmpRecord>();
  const monthSet = new Set<string>();

  for (const row of rawRows) {
    const name  = (row.contact_name ?? "").trim();
    const org   = (row.org ?? "").toLowerCase();
    const month = (row.date ?? "").slice(0, 7);
    if (!month || !name) continue;

    const ek = `${name}\x00${org}`;
    if (!empMap.has(ek)) {
      empMap.set(ek, { contact_name: name, org, monthly: {}, total: 0, coaCodes: new Set(), hasSupplement: false });
    }
    const emp = empMap.get(ek)!;
    emp.monthly[month] = Math.round(((emp.monthly[month] ?? 0) + row.amount) * 100) / 100;
    emp.total          = Math.round((emp.total + row.amount) * 100) / 100;
    if (row.account_code) emp.coaCodes.add(row.account_code);
    monthSet.add(month);
  }

  // ── Step 2: Build fuzzy name index → empMap key ──────────────────────────────
  // Two keys per employee: normalised exact + token-sorted, to handle:
  //   • case / punctuation differences: "Dr. Walter" ↔ "DR WALTER"
  //   • word-order differences:          "Smith John" ↔ "John Smith"
  const nameIndex = new Map<string, string>();
  for (const [ek, emp] of empMap) {
    const norm   = normName(emp.contact_name);
    const sorted = sortedTokenKey(emp.contact_name);
    if (!nameIndex.has(norm))   nameIndex.set(norm, ek);
    if (!nameIndex.has(sorted)) nameIndex.set(sorted, ek);
  }

  // ── Step 3: Merge frozen supplements ────────────────────────────────────────
  for (const supp of suppRows) {
    const suppName = (supp.employee_name ?? "").trim();
    if (!suppName || !supp.amount) continue;
    const month = (supp.month ?? "").slice(0, 7);
    if (!month) continue;

    let ek = nameIndex.get(normName(suppName)) ?? nameIndex.get(sortedTokenKey(suppName));

    if (!ek) {
      const org = supp.spa_slug ? "spa" : "supplement";
      ek = `${suppName}\x00${org}`;
      if (!empMap.has(ek)) {
        empMap.set(ek, { contact_name: suppName, org, monthly: {}, total: 0, coaCodes: new Set(), hasSupplement: false });
        nameIndex.set(normName(suppName), ek);
        nameIndex.set(sortedTokenKey(suppName), ek);
      }
    }

    const emp = empMap.get(ek)!;
    emp.monthly[month] = Math.round(((emp.monthly[month] ?? 0) + supp.amount) * 100) / 100;
    emp.total          = Math.round((emp.total + supp.amount) * 100) / 100;
    emp.hasSupplement  = true;
    monthSet.add(month);
  }

  const months = Array.from(monthSet).sort();

  const employees = Array.from(empMap.values())
    .map(emp => ({
      contact_name:    emp.contact_name,
      org:             emp.org,
      monthly:         emp.monthly,
      total:           emp.total,
      coa_codes:       Array.from(emp.coaCodes).sort(),
      has_supplement:  emp.hasSupplement,
    }))
    .sort((a, b) =>
      a.contact_name.localeCompare(b.contact_name, undefined, { sensitivity: "base" }) ||
      a.org.localeCompare(b.org),
    );

  return NextResponse.json({ date_from: dateFrom, date_to: dateTo, months, employees });
}
