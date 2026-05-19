import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const ZOHO_AUTH  = "https://accounts.zoho.eu/oauth/v2/token";
const ZOHO_API   = "https://www.zohoapis.eu/books/v3";

async function getZohoAccessToken(org: string): Promise<string> {
  // HQ uses the same Zoho org/credentials as Aesthetics
  const refreshToken = org === "spa"
    ? process.env.ZOHO_BOOKS_SPA_REFRESH_TOKEN
    : process.env.ZOHO_BOOKS_REFRESH_TOKEN;
  const r = await fetch(
    `${ZOHO_AUTH}?grant_type=refresh_token` +
    `&client_id=${process.env.ZOHO_BOOKS_CLIENT_ID}` +
    `&client_secret=${process.env.ZOHO_BOOKS_CLIENT_SECRET}` +
    `&refresh_token=${refreshToken}`,
    { method: "POST" }
  );
  const d = await r.json();
  if (!d.access_token) throw new Error(`Zoho token refresh failed: ${JSON.stringify(d)}`);
  return d.access_token;
}

export async function POST(req: NextRequest) {
  const supabase = getAdminClient();
  const { org = "spa" } = await req.json().catch(() => ({}));

  // HQ accounts live in the SPA Zoho org
  const zohoOrg = org === "hq" ? "spa" : org;

  const clientId     = process.env.ZOHO_BOOKS_CLIENT_ID;
  const clientSecret = process.env.ZOHO_BOOKS_CLIENT_SECRET;
  const refreshToken = zohoOrg === "spa"
    ? process.env.ZOHO_BOOKS_SPA_REFRESH_TOKEN
    : process.env.ZOHO_BOOKS_REFRESH_TOKEN;
  const orgId        = zohoOrg === "spa"
    ? process.env.ZOHO_BOOKS_SPA_ORG_ID
    : process.env.ZOHO_BOOKS_AESTH_ORG_ID;

  if (!clientId || !clientSecret || !refreshToken || !orgId ||
      [clientId, clientSecret, refreshToken, orgId].some(v => v === "TO_BE_FILLED")) {
    const orgIdVar = zohoOrg === "spa" ? "ZOHO_BOOKS_SPA_ORG_ID" : "ZOHO_BOOKS_AESTH_ORG_ID";
    const tokenVar = zohoOrg === "spa" ? "ZOHO_BOOKS_SPA_REFRESH_TOKEN" : "ZOHO_BOOKS_REFRESH_TOKEN";
    return NextResponse.json({
      error: `Zoho Books credentials not configured for ${org}. Check ZOHO_BOOKS_CLIENT_ID, CLIENT_SECRET, ${tokenVar} and ${orgIdVar} in .env.local`,
    }, { status: 400 });
  }

  try {
    const token = await getZohoAccessToken(zohoOrg);

    async function fetchAllPages(filterBy: string) {
      const accounts: Array<{ account_id: string; account_code?: string; account_name: string; account_type: string }> = [];
      let page = 1;
      while (true) {
        const r = await fetch(
          `${ZOHO_API}/chartofaccounts?organization_id=${orgId}&page=${page}&per_page=200&filter_by=${filterBy}`,
          { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
        );
        const d = await r.json();
        accounts.push(...(d.chartofaccounts ?? []));
        if (!d.page_context?.has_more_page) break;
        page++;
      }
      return accounts;
    }

    // Fetch all P&L-relevant account types — Income, Other Income, Expense,
    // Other Expense, and Cost of Goods Sold all appear in the Zoho P&L report.
    const [incomeAccounts, otherIncomeAccounts, expenseAccounts, otherExpenseAccounts, cogsAccounts] =
      await Promise.all([
        fetchAllPages("AccountType.Income"),
        fetchAllPages("AccountType.OtherIncome"),
        fetchAllPages("AccountType.Expense"),
        fetchAllPages("AccountType.OtherExpense"),
        fetchAllPages("AccountType.CostOfGoodsSold"),
      ]);

    // Deduplicate by account_id (in case any overlap)
    const seen = new Set<string>();
    const allAccounts = [
      ...incomeAccounts, ...otherIncomeAccounts,
      ...expenseAccounts, ...otherExpenseAccounts, ...cogsAccounts,
    ].filter(a => {
      if (seen.has(a.account_id)) return false;
      seen.add(a.account_id);
      return true;
    });

    // allAccounts already scoped to Income + Expense by the Zoho filter_by params
    const filtered = allAccounts;

    // Prefer the short user-visible account_code; fall back to internal account_id
    // Deduplicate by computed account_code to avoid ON CONFLICT errors when
    // multiple Zoho accounts share the same short code.
    const codeMap = new Map<string, any>();
    for (const a of filtered) {
      const code = (a.account_code && String(a.account_code).trim()) || a.account_id;
      if (!codeMap.has(code)) codeMap.set(code, a);
    }
    const rows = Array.from(codeMap.entries()).map(([code, a]) => ({
      account_code: code,
      account_name: a.account_name,
      account_type: a.account_type,
      zoho_org:     org,   // store as 'hq' when org='hq', even though fetched from aesthetics Zoho org
      last_synced_at: new Date().toISOString(),
    }));

    let inserted = 0;
    const CHUNK = 50;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase
        .from("zoho_coa_mapping")
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: "account_code,zoho_org",
          ignoreDuplicates: false,
        });
      if (error) throw new Error(error.message);
      inserted += rows.slice(i, i + CHUNK).length;
    }

    // ── Remove accounts deleted in Zoho ──────────────────────────────────────
    // Fetch every code currently stored in Supabase for this org, then delete
    // any that Zoho no longer returned.
    const { data: existingRows } = await supabase
      .from("zoho_coa_mapping")
      .select("id, account_code")
      .eq("zoho_org", org);

    const zohoCodeSet = new Set(rows.map(r => r.account_code));
    const toDelete = (existingRows ?? []).filter(r => !zohoCodeSet.has(r.account_code));

    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const ids = toDelete.slice(i, i + CHUNK).map(r => r.id);
      const { error } = await supabase
        .from("zoho_coa_mapping")
        .delete()
        .in("id", ids);
      if (error) throw new Error(error.message);
      deleted += ids.length;
    }

    // Count unmapped
    const { count } = await supabase
      .from("zoho_coa_mapping")
      .select("id", { count: "exact", head: true })
      .eq("zoho_org", org)
      .is("ebitda_line", null);

    const uniqueTypes = [...new Set(allAccounts.map(a => a.account_type))].sort();
    return NextResponse.json({ ok: true, synced: inserted, deleted, unmapped: count ?? 0, total_fetched: allAccounts.length, account_types_seen: uniqueTypes });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
