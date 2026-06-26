import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "../../../../lib/etl/zoho-client";

// Debug endpoint: inspect Zoho transactions for a given account_code.
// Usage A: POST { txn_id: "128265000029661114", txn_type: "expense" }
//   → fetch that specific transaction detail
// Usage B: POST { account_code: "611151", date_from: "2026-05-01", date_to: "2026-05-31" }
//   → list expenses for date range; for each, fetch detail and check line items
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>;
    const client = new ZohoBooksClient("spa");

    // Usage A: fetch specific transaction by ID
    if (body.txn_id) {
      const type = body.txn_type ?? "expense";
      const endpointMap: Record<string, { ep: string; key: string }> = {
        expense:      { ep: "expenses",       key: "expense"      },
        bill:         { ep: "bills",          key: "bill"         },
        journal:      { ep: "journals",       key: "journal"      },
        vendorcredit: { ep: "vendor_credits", key: "vendor_credit"},
      };
      const cfg = endpointMap[type];
      if (!cfg) return NextResponse.json({ error: `Unknown txn_type: ${type}` }, { status: 400 });
      const detail = await client.get(`${cfg.ep}/${body.txn_id}`) as Record<string, unknown>;
      return NextResponse.json({ txn_id: body.txn_id, txn_type: type, detail: detail[cfg.key] ?? detail });
    }

    // Usage B: P&L report + expenses filtered by account_id (single API calls, no per-txn detail fetching)
    const { date_from, date_to } = body;
    const target_account_id = body.account_id ?? "";
    if (!date_from || !date_to) {
      return NextResponse.json({ error: "Provide date_from and date_to" }, { status: 400 });
    }

    // Fetch expenses filtered by account_id directly (single paginated list call, no detail fetches)
    if (!target_account_id) {
      return NextResponse.json({ error: "account_id required for this scan" }, { status: 400 });
    }
    const filteredExpenses = await client.getAllPages("expenses", "expenses", {
      account_id: target_account_id,
      date_start: date_from,
      date_end:   date_to,
    }) as Record<string, unknown>[];

    const total = filteredExpenses.reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0);
    return NextResponse.json({
      date_from,
      date_to,
      account_id: target_account_id,
      count: filteredExpenses.length,
      total_zoho: Math.round(total * 100) / 100,
      expenses: filteredExpenses.map(e => ({
        id:      e.expense_id,
        date:    e.date,
        status:  e.status,
        account: e.account_name,
        amount:  e.total ?? e.amount,
        vendor:  e.vendor_name ?? e.paid_through_account_name,
        desc:    e.description,
        created: e.created_time,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
