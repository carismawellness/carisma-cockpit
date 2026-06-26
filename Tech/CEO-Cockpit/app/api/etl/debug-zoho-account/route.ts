import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "../../../../lib/etl/zoho-client";

// Debug endpoint: scan Zoho expenses + bills for a given account_code in a date range.
// Bypasses chart-of-accounts lookup (611151 not in COA API).
// Usage: POST { account_code: "611151", date_from: "2026-05-01", date_to: "2026-05-31" }
export async function POST(req: NextRequest) {
  try {
    const { account_code, date_from, date_to } = await req.json();
    if (!account_code || !date_from || !date_to) {
      return NextResponse.json({ error: "account_code, date_from, date_to required" }, { status: 400 });
    }

    const client = new ZohoBooksClient("spa");

    type Hit = {
      source: string;
      txn_id: string;
      date: string;
      status: string;
      vendor: string;
      line_account_code: string;
      line_account_name: string;
      amount: number;
      debit_or_credit?: string;
    };
    const hits: Hit[] = [];

    // Helper: scan a list endpoint, check line items for the target account_code
    async function scanSource(source: string, endpoint: string, listKey: string, params: Record<string, string>) {
      const items = await client.getAllPages(endpoint, listKey, params) as Record<string, unknown>[];

      for (const item of items) {
        const lines = (item.line_items ?? []) as Record<string, unknown>[];
        for (const ln of lines) {
          const code = String(ln.account_code ?? ln.account_id ?? "");
          if (code === account_code || String(ln.account_name ?? "").toLowerCase().includes("fuel")) {
            hits.push({
              source,
              txn_id:            String(item.expense_id ?? item.bill_id ?? item.journal_id ?? ""),
              date:              String(item.date ?? ""),
              status:            String(item.status ?? ""),
              vendor:            String(item.vendor_name ?? item.payee ?? item.notes ?? ""),
              line_account_code: code,
              line_account_name: String(ln.account_name ?? ""),
              amount:            Number(ln.amount ?? ln.debit_amount ?? 0),
              debit_or_credit:   String(ln.debit_or_credit ?? ""),
            });
          }
        }
      }
    }

    await scanSource("expense", "expenses", "expenses", { date_start: date_from, date_end: date_to });
    await scanSource("bill",    "bills",    "bills",    { date_start: date_from, date_end: date_to });
    await scanSource("journal", "journals", "journals", { date_start: date_from, date_end: date_to });

    const total = hits.reduce((s, h) => s + h.amount, 0);

    return NextResponse.json({
      account_code,
      date_from,
      date_to,
      hit_count: hits.length,
      total_zoho: Math.round(total * 100) / 100,
      hits,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
