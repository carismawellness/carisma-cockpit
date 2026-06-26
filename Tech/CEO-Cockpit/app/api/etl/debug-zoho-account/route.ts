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

    // 1. Fetch P&L report to see account totals
    const plResp = await client.get("reports/profitandloss", {
      from_date: date_from,
      to_date:   date_to,
      cash_based: "false",
    }) as Record<string, unknown>;

    // Walk the P&L tree looking for "fuel" accounts
    type PlLine = { account_id?: string; account_name?: string; total?: number; account_transactions?: PlLine[]; accounts?: PlLine[]; };
    function findFuelLines(node: Record<string, unknown>): PlLine[] {
      const results: PlLine[] = [];
      const name = String(node.account_name ?? node.name ?? "").toLowerCase();
      if (name.includes("fuel")) {
        results.push({ account_id: String(node.account_id ?? ""), account_name: String(node.account_name ?? node.name ?? ""), total: Number(node.total ?? node.amount ?? 0) });
      }
      for (const key of ["account_transactions", "accounts", "line_items", "transactions"]) {
        const children = node[key] as Record<string, unknown>[] | undefined;
        if (Array.isArray(children)) {
          for (const child of children) results.push(...findFuelLines(child));
        }
      }
      return results;
    }
    const fuelLines = findFuelLines(plResp as Record<string, unknown>);

    // 2. Fetch expenses filtered by account_id directly (Zoho supports this filter)
    let filteredExpenses: Record<string, unknown>[] = [];
    if (target_account_id) {
      filteredExpenses = await client.getAllPages("expenses", "expenses", {
        account_id:  target_account_id,
        date_start:  date_from,
        date_end:    date_to,
      }) as Record<string, unknown>[];
    }

    return NextResponse.json({
      date_from,
      date_to,
      pl_fuel_lines: fuelLines,
      pl_top_keys: Object.keys(plResp),
      expenses_filtered_count: filteredExpenses.length,
      expenses_filtered_total: Math.round(filteredExpenses.reduce((s, e) => s + Number(e.total ?? e.amount ?? 0), 0) * 100) / 100,
      expenses_filtered: filteredExpenses.map(e => ({ id: e.expense_id, date: e.date, status: e.status, account: e.account_name, amount: e.total ?? e.amount, vendor: e.vendor_name ?? e.paid_through_account_name })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
