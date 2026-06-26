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

    // Usage C: account transactions report via known account_id
    if (body.account_id && body.date_from && body.date_to) {
      const txnResp = await client.get("reports/accounttransactions", {
        account_id: body.account_id,
        from_date:  body.date_from,
        to_date:    body.date_to,
      }) as Record<string, unknown>;
      const transactions = ((txnResp.transactions ?? txnResp.account_transactions ?? []) as Record<string, unknown>[]);
      const debit  = transactions.reduce((s, t) => s + Number(t.debit_amount  ?? 0), 0);
      const credit = transactions.reduce((s, t) => s + Number(t.credit_amount ?? 0), 0);
      return NextResponse.json({
        account_id: body.account_id,
        date_from: body.date_from,
        date_to: body.date_to,
        transaction_count: transactions.length,
        debit_total:  Math.round(debit  * 100) / 100,
        credit_total: Math.round(credit * 100) / 100,
        net: Math.round((debit - credit) * 100) / 100,
        raw_keys: Object.keys(txnResp),
        transactions: transactions.map(t => ({
          date:   t.transaction_date,
          type:   t.transaction_type,
          ref:    t.reference_number,
          entity: t.entity_name,
          debit:  t.debit_amount,
          credit: t.credit_amount,
          desc:   t.description,
        })),
      });
    }

    // Usage B: scan all expenses for the date range, fetch detail for each
    const { account_code, date_from, date_to } = body;
    if (!account_code || !date_from || !date_to) {
      return NextResponse.json({ error: "Provide either txn_id+txn_type OR account_code+date_from+date_to" }, { status: 400 });
    }

    type Hit = { source: string; txn_id: string; date: string; status: string; vendor: string; account_code: string; account_name: string; amount: number; };
    const hits: Hit[] = [];
    const sources = [
      { source: "expense", ep: "expenses",      listKey: "expenses",      detailKey: "expense",      idField: "expense_id" },
      { source: "bill",    ep: "bills",          listKey: "bills",         detailKey: "bill",         idField: "bill_id"    },
      { source: "journal", ep: "journals",       listKey: "journals",      detailKey: "journal",      idField: "journal_id" },
    ];

    for (const src of sources) {
      const items = await client.getAllPages(src.ep, src.listKey, { date_start: date_from, date_end: date_to }) as Record<string, unknown>[];
      for (const item of items) {
        const id = String(item[src.idField] ?? "");
        // Fetch detail to get full line items with account codes
        let detail: Record<string, unknown>;
        try {
          const dr = await client.get(`${src.ep}/${id}`) as Record<string, unknown>;
          detail = (dr[src.detailKey] ?? dr) as Record<string, unknown>;
        } catch { continue; }

        const lines = (detail.line_items ?? []) as Record<string, unknown>[];
        for (const ln of lines) {
          const code = String(ln.account_code ?? "").trim();
          const name = String(ln.account_name ?? "").toLowerCase();
          if (code === account_code || name.includes("fuel")) {
            hits.push({
              source:       src.source,
              txn_id:       id,
              date:         String(detail.date ?? detail.journal_date ?? ""),
              status:       String(detail.status ?? ""),
              vendor:       String(detail.vendor_name ?? detail.contact_name ?? detail.payee ?? ""),
              account_code: code,
              account_name: String(ln.account_name ?? ""),
              amount:       Number(ln.amount ?? ln.debit_amount ?? 0),
            });
          }
        }
      }
    }

    const total = hits.reduce((s, h) => s + h.amount, 0);
    return NextResponse.json({ account_code, date_from, date_to, hit_count: hits.length, total_zoho: Math.round(total * 100) / 100, hits });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
