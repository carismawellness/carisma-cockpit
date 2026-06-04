/**
 * GET /api/finance/wage-role-breakdown?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *
 * Returns per-employee wage amounts bucketed by venue slug and role.
 *
 * Source: salary_supplement_monthly (is_frozen=true) — the canonical per-employee
 * per-venue monthly salary table. Fast Supabase-only query, no Zoho API calls.
 *
 * Response:
 *   byVenueRole:        { [venue_slug]: { [role | "unassigned"]: amount } }
 *   byVenueRoleContact: { [venue_slug]: { [role | "unassigned"]: { [contact]: amount } } }
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** First day of the month containing the given ISO date. */
function monthStart(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "date_from and date_to required" },
      { status: 400 },
    );
  }

  try {
    const supabase = getAdminClient();

    // 1. Load role mapping (contact_key → role)
    const { data: roleRows, error: roleErr } = await supabase
      .from("wage_role_mapping")
      .select("contact_key, role");
    if (roleErr) throw new Error(`wage_role_mapping: ${roleErr.message}`);

    const roleByContact = new Map<string, string>(
      (roleRows ?? []).map((r: { contact_key: string; role: string }) => [r.contact_key, r.role]),
    );

    // 2. Load salary_supplement_monthly for months overlapping the date range
    const { data: salaryRows, error: salErr } = await supabase
      .from("salary_supplement_monthly")
      .select("employee_name, spa_slug, amount, month")
      .eq("is_frozen", true)
      .gte("month", monthStart(dateFrom))
      .lte("month", monthStart(dateTo));
    if (salErr) throw new Error(`salary_supplement_monthly: ${salErr.message}`);

    // 3. Aggregate by venue × role
    const byVenueRole: Record<string, Record<string, number>> = {};
    const byVenueRoleContact: Record<string, Record<string, Record<string, number>>> = {};

    for (const row of salaryRows ?? []) {
      const venue       = (row.spa_slug || "").trim().toLowerCase();
      const amount      = Number(row.amount ?? 0);
      if (!venue || !amount) continue;

      const contactKey  = normalizeContact(row.employee_name);
      const role        = roleByContact.get(contactKey) ?? "unassigned";
      const contactName = (row.employee_name || "").trim() || "(no name)";

      // byVenueRole
      if (!byVenueRole[venue]) byVenueRole[venue] = {};
      byVenueRole[venue][role] = (byVenueRole[venue][role] ?? 0) + amount;

      // byVenueRoleContact
      if (!byVenueRoleContact[venue])       byVenueRoleContact[venue] = {};
      if (!byVenueRoleContact[venue][role]) byVenueRoleContact[venue][role] = {};
      byVenueRoleContact[venue][role][contactName] =
        (byVenueRoleContact[venue][role][contactName] ?? 0) + amount;
    }

    return NextResponse.json({
      byVenueRole,
      byVenueRoleContact,
      date_from:  dateFrom,
      date_to:    dateTo,
      total_rows: (salaryRows ?? []).length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `wage-role-breakdown failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
