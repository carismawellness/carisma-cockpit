import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "../../../../lib/etl/zoho-client";

// Temporary debug endpoint: pull raw Zoho account transactions for a given account
// and date range to compare against transactions_raw.
// Usage: POST { account_code: "611151", date_from: "2026-05-01", date_to: "2026-05-31" }
export async function POST(req: NextRequest) {
  try {
    const { account_code, date_from, date_to } = await req.json();
    if (!account_code || !date_from || !date_to) {
      return NextResponse.json({ error: "account_code, date_from, date_to required" }, { status: 400 });
    }

    const client = new ZohoBooksClient("spa");

    // Get account ID from account code — try active, then inactive (show_inactive_accounts)
    let acct: Record<string, string> | undefined;
    let allAccounts: Record<string, string>[] = [];
    for (const showInactive of ["false", "true"]) {
      let page = 1;
      while (true) {
        const coaResp = await client.get("chartofaccounts", {
          sort_column: "account_code",
          per_page: "200",
          page: String(page),
          show_inactive_accounts: showInactive,
        }) as Record<string, unknown>;
        const batch = (coaResp.chartofaccounts ?? []) as Record<string, string>[];
        if (batch.length === 0) break;
        allAccounts = allAccounts.concat(batch);
        const found = batch.find(a => a.account_code === account_code);
        if (found) { acct = found; break; }
        const ctx = coaResp.page_context as Record<string, unknown> | undefined;
        if (!ctx?.has_more_page) break;
        page++;
      }
      if (acct) break;
    }
    if (!acct) {
      const fuelAccounts = allAccounts.filter(a => /fuel|car/i.test(a.account_name ?? ""));
      return NextResponse.json({ error: `Account ${account_code} not found (fetched ${allAccounts.length} total)`, fuel_accounts: fuelAccounts });
    }

    // Pull account transactions report
    const txnResp = await client.get("reports/accounttransactions", {
      account_id: acct.account_id,
      from_date: date_from,
      to_date: date_to,
    }) as Record<string, unknown>;

    const transactions = (txnResp.transactions ?? txnResp.account_transactions ?? []) as Record<string, unknown>[];
    const debitTotal  = transactions.reduce((s, t) => s + Number(t.debit_amount  ?? 0), 0);
    const creditTotal = transactions.reduce((s, t) => s + Number(t.credit_amount ?? 0), 0);

    return NextResponse.json({
      account_code,
      account_name: acct.account_name ?? acct.name,
      account_id: acct.account_id,
      acct_raw: acct,
      date_from,
      date_to,
      transaction_count: transactions.length,
      debit_total:  Math.round(debitTotal  * 100) / 100,
      credit_total: Math.round(creditTotal * 100) / 100,
      net: Math.round((debitTotal - creditTotal) * 100) / 100,
      raw_response_keys: Object.keys(txnResp),
      transactions: transactions.map(t => ({
        date:    t.transaction_date,
        type:    t.transaction_type,
        ref:     t.reference_number,
        entity:  t.entity_name,
        debit:   t.debit_amount,
        credit:  t.credit_amount,
        balance: t.running_balance,
        desc:    t.description,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
