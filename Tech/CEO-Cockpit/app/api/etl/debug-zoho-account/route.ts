import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "../../../../lib/etl/zoho-client";

// Temporary debug endpoint: pull raw Zoho account transactions for a given account
// and date range to compare against transactions_raw.
// Usage: POST { account_code: "611151", date_from: "2026-05-01", date_to: "2026-05-31" }
export async function POST(req: NextRequest) {
  const { account_code, date_from, date_to } = await req.json();
  if (!account_code || !date_from || !date_to) {
    return NextResponse.json({ error: "account_code, date_from, date_to required" }, { status: 400 });
  }

  const client = new ZohoBooksClient("spa");

  // Get account ID from account code
  const coaResp = await client.get("chartofaccounts", {
    filter_by: "AccountType.all",
    sort_column: "account_code",
    per_page: "200",
  }) as Record<string, unknown>;
  const accounts = (coaResp.chartofaccounts ?? []) as Record<string, string>[];
  const acct = accounts.find(a => a.account_code === account_code);
  if (!acct) {
    return NextResponse.json({ error: `Account ${account_code} not found`, accounts: accounts.map(a => ({ code: a.account_code, name: a.account_name, id: a.account_id })).slice(0, 20) });
  }

  // Pull account transactions report
  const txnResp = await client.get("reports/accounttransactions", {
    account_id: acct.account_id,
    from_date: date_from,
    to_date: date_to,
  }) as Record<string, unknown>;

  const transactions = (txnResp.transactions ?? []) as Record<string, unknown>[];
  const total = transactions.reduce((s, t) => s + (Number(t.debit_amount ?? 0) - Number(t.credit_amount ?? 0)), 0);

  return NextResponse.json({
    account_code,
    account_name: acct.account_name,
    account_id: acct.account_id,
    date_from,
    date_to,
    transaction_count: transactions.length,
    total_net: Math.round(total * 100) / 100,
    transactions: transactions.map(t => ({
      date: t.transaction_date,
      type: t.transaction_type,
      ref: t.reference_number,
      entity: t.entity_name,
      debit: t.debit_amount,
      credit: t.credit_amount,
      description: t.description,
    })),
  });
}
