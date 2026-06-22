import { NextRequest, NextResponse } from "next/server";

// GET /api/etl/debug-wages?date_from=2026-05-01&date_to=2026-05-31&venue=intercontinental
//
// Wages diagnostic: cross-references transactions_raw (ebitda_line=wages) against
// wage_role_mapping to surface which employees have no role assigned (→ unassigned).
// Also shows salary_supplement_monthly for the period.

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}
function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function fetchAll<T>(url: string): Promise<T[]> {
  const resp = await fetch(url, { headers: sbHeaders() });
  if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T[]>;
}

export async function GET(req: NextRequest) {
  const dateFrom = req.nextUrl.searchParams.get("date_from") ?? "2026-05-01";
  const dateTo   = req.nextUrl.searchParams.get("date_to")   ?? "2026-05-31";
  const venue    = req.nextUrl.searchParams.get("venue");      // optional filter
  const org      = req.nextUrl.searchParams.get("org")        ?? "spa";

  // 1. Raw wage transactions
  const txnParams = [
    `org=eq.${org}`,
    `ebitda_line=eq.wages`,
    `date=gte.${dateFrom}`,
    `date=lte.${dateTo}`,
    `select=date,contact_name,account_name,account_code,amount,venue`,
    `order=contact_name.asc`,
    `limit=2000`,
  ];
  if (venue) txnParams.push(`venue=eq.${venue}`);

  // 2. wage_role_mapping
  // 3. salary_supplement_monthly for the overlapping months
  const month = dateFrom.slice(0, 7);
  const [txnRows, roleRows, suppRows] = await Promise.all([
    fetchAll<{ date: string; contact_name: string; account_name: string; account_code: string; amount: number; venue: string }>(
      `${sbUrl("transactions_raw")}?${txnParams.join("&")}`
    ),
    fetchAll<{ contact_key: string; role: string; venue_override?: string; is_prof_fee?: boolean }>(
      `${sbUrl("wage_role_mapping")}?select=contact_key,role,venue_override,is_prof_fee&limit=1000`
    ),
    fetchAll<{ month: string; employee_name: string; amount: number; spa_slug: string; role: string; is_frozen: boolean }>(
      `${sbUrl("salary_supplement_monthly")}?month=gte.${month}-01&month=lte.${month}-28&is_frozen=eq.true&select=month,employee_name,amount,spa_slug,role&order=spa_slug.asc&limit=500`
    ),
  ]);

  // Build role lookup
  const roleMap = new Map(roleRows.map(r => [r.contact_key.toLowerCase().trim(), r.role]));

  // Summarise transactions by employee
  type EmployeeSummary = {
    contact_name: string;
    total: number;
    mapped_role: string;
    venues: string[];
    account_codes: string[];
  };
  const byEmployee = new Map<string, { total: number; venues: Set<string>; account_codes: Set<string> }>();
  for (const r of txnRows) {
    const k = r.contact_name || "(no contact)";
    if (!byEmployee.has(k)) byEmployee.set(k, { total: 0, venues: new Set(), account_codes: new Set() });
    const e = byEmployee.get(k)!;
    e.total += r.amount;
    e.venues.add(r.venue);
    e.account_codes.add(r.account_code);
  }

  const employees: EmployeeSummary[] = [];
  for (const [name, e] of byEmployee) {
    const mapped_role = roleMap.get(name.toLowerCase().trim()) ?? "⚠ UNMAPPED";
    employees.push({
      contact_name: name,
      total: +e.total.toFixed(2),
      mapped_role,
      venues: [...e.venues].sort(),
      account_codes: [...e.account_codes].sort(),
    });
  }
  employees.sort((a, b) => b.total - a.total);

  // Summarise by venue
  const byVenue: Record<string, { total_zoho: number; contacts: string[] }> = {};
  for (const r of txnRows) {
    if (!byVenue[r.venue]) byVenue[r.venue] = { total_zoho: 0, contacts: [] };
    byVenue[r.venue].total_zoho += r.amount;
  }
  for (const r of txnRows) {
    const v = byVenue[r.venue];
    if (!v.contacts.includes(r.contact_name)) v.contacts.push(r.contact_name);
  }

  // Unmapped employees (→ "unassigned" bucket in ebitda-v2)
  const unmapped = employees.filter(e => e.mapped_role === "⚠ UNMAPPED");

  // Salary supplement summary
  const suppByVenue: Record<string, number> = {};
  for (const r of suppRows) {
    suppByVenue[r.spa_slug] = (suppByVenue[r.spa_slug] ?? 0) + r.amount;
  }

  return NextResponse.json({
    period:  { dateFrom, dateTo },
    transactions_raw: {
      total_rows: txnRows.length,
      total_amount: +txnRows.reduce((s, r) => s + r.amount, 0).toFixed(2),
      by_venue: Object.fromEntries(
        Object.entries(byVenue).map(([v, d]) => [v, { total: +d.total_zoho.toFixed(2), contacts: d.contacts }])
      ),
    },
    employees,
    unmapped_employees: unmapped,
    wage_role_mapping_count: roleRows.length,
    salary_supplement: {
      frozen_rows: suppRows.length,
      total_amount: +suppRows.reduce((s, r) => s + r.amount, 0).toFixed(2),
      by_venue: suppByVenue,
      rows: suppRows,
    },
  });
}

// POST /api/etl/debug-wages
// Body: { assignments: Array<{ contact_name: string; role: string }> }
// Bulk-upserts wage_role_mapping rows using service role key (bypasses session auth).
export async function POST(req: NextRequest) {
  const VALID_ROLES = ["manager", "reception", "practitioner", "therapist", "crm"] as const;
  const body = await req.json().catch(() => ({})) as { assignments?: Array<{ contact_name: string; role: string }> };
  const assignments = body.assignments ?? [];
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return NextResponse.json({ error: "assignments array required" }, { status: 400 });
  }
  const rows = assignments
    .filter(a => typeof a.contact_name === "string" && VALID_ROLES.includes(a.role as typeof VALID_ROLES[number]))
    .map(a => ({
      contact_key:  a.contact_name.trim().toLowerCase().replace(/\s+/g, " "),
      contact_name: a.contact_name.trim(),
      role:         a.role,
      updated_at:   new Date().toISOString(),
    }));
  if (rows.length === 0) return NextResponse.json({ error: "No valid assignments" }, { status: 400 });

  const resp = await fetch(
    `${sbUrl("wage_role_mapping")}?on_conflict=contact_key`,
    { method: "POST", headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(rows) }
  );
  if (!resp.ok) return NextResponse.json({ error: await resp.text() }, { status: 500 });
  const saved = await resp.json() as unknown[];
  return NextResponse.json({ ok: true, saved: saved.length, rows });
}
