/**
 * GET /api/finance/wage-role-breakdown?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *
 * Returns per-employee wage amounts bucketed by venue slug and role.
 *
 * Fetches GL transactions from Zoho SPA org for venue-specific wage account codes
 * (accounts where COA_MAP assigns a fixed venue, e.g. hugos / hyatt / excelsior).
 * Each transaction's payee is matched against wage_role_mapping to determine role.
 * Unmatched payees fall into "unassigned".
 *
 * Response:
 *   byVenueRole:        { [venue_slug]: { [role | "unassigned"]: amount } }
 *   byVenueRoleContact: { [venue_slug]: { [role | "unassigned"]: { [contact]: amount } } }
 *
 * Used by the EBITDA page to populate the Wages & Salaries role sub-rows.
 * Parent row totals still come from spa_ebitda_daily (more accurate); this
 * endpoint only supplies the per-role / per-employee breakdown detail.
 */

import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient }            from "@/lib/etl/zoho-client";
import { fetchTransactionsForAccounts } from "@/lib/etl/zoho-account-transactions";
import { COA_MAP }                    from "@/lib/etl/spa-ebitda";
import { getAdminClient }             from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic     = "force-dynamic";

// Translate COA_MAP split_rule names → current DB venue slugs.
// sunny_coast was renamed to odycy; intercontinental shortened to inter.
const SPLIT_RULE_TO_SLUG: Record<string, string> = {
  intercontinental: "inter",
  hugos:            "hugos",
  hyatt:            "hyatt",
  ramla:            "ramla",
  sunny_coast:      "odycy",
  labranda:         "labranda",
  excelsior:        "excelsior",
  novotel:          "novotel",
};

// account_code → venue slug — built once at module load from COA_MAP.
// Only includes venue-specific codes; skips sales_ratio / equal / salary_cost.
const CODE_TO_VENUE: Record<string, string> = {};
for (const [code, [splitRule, ebitdaLine]] of Object.entries(COA_MAP)) {
  if (ebitdaLine !== "wages") continue;
  const slug = SPLIT_RULE_TO_SLUG[splitRule];
  if (slug) CODE_TO_VENUE[code] = slug;
}

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
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
    // 1. Load wage_role_mapping from Supabase (small table, fast)
    const supabase = getAdminClient();
    const { data: roleRows } = await supabase
      .from("wage_role_mapping")
      .select("contact_key, role");
    const roleByContact = new Map<string, string>(
      (roleRows ?? []).map((r: { contact_key: string; role: string }) => [r.contact_key, r.role]),
    );

    // 2. Fetch Zoho GL transactions for venue-specific wage codes (SPA org only)
    const client = new ZohoBooksClient("spa");
    const codes  = Object.keys(CODE_TO_VENUE);
    const { txns } = await fetchTransactionsForAccounts(client, codes, dateFrom, dateTo);

    // 3. Aggregate by venue × role — and keep per-contact detail for drill-down
    const byVenueRole: Record<string, Record<string, number>> = {};
    const byVenueRoleContact: Record<string, Record<string, Record<string, number>>> = {};

    for (const txn of txns) {
      const venue = CODE_TO_VENUE[txn.account_code];
      if (!venue || !txn.amount) continue;

      const contactKey  = normalizeContact(txn.payee);
      const role        = roleByContact.get(contactKey) ?? "unassigned";
      const contactName = txn.payee || "(no contact)";

      // byVenueRole totals
      if (!byVenueRole[venue]) byVenueRole[venue] = {};
      byVenueRole[venue][role] = (byVenueRole[venue][role] ?? 0) + txn.amount;

      // byVenueRoleContact detail
      if (!byVenueRoleContact[venue])       byVenueRoleContact[venue] = {};
      if (!byVenueRoleContact[venue][role]) byVenueRoleContact[venue][role] = {};
      byVenueRoleContact[venue][role][contactName] =
        (byVenueRoleContact[venue][role][contactName] ?? 0) + txn.amount;
    }

    return NextResponse.json({
      byVenueRole,
      byVenueRoleContact,
      date_from:  dateFrom,
      date_to:    dateTo,
      total_txns: txns.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `wage-role-breakdown failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
