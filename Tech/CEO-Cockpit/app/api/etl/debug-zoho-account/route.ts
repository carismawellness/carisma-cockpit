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

    // Usage B: scan all expenses+bills+journals, match by account_id or account_name containing "fuel"
    const { date_from, date_to } = body;
    const target_account_id = body.account_id ?? "";  // can also pass account_id here
    const account_code = body.account_code ?? "";
    if (!date_from || !date_to) {
      return NextResponse.json({ error: "Provide date_from and date_to for a full scan" }, { status: 400 });
    }

    type Hit = { source: string; txn_id: string; date: string; status: string; vendor: string; account_id: string; account_code: string; account_name: string; amount: number; };
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
        let detail: Record<string, unknown>;
        try {
          const dr = await client.get(`${src.ep}/${id}`) as Record<string, unknown>;
          detail = (dr[src.detailKey] ?? dr) as Record<string, unknown>;
        } catch { continue; }

        // Also check top-level account_id/account_name for single-line expenses
        const topAccountId   = String(detail.account_id ?? "");
        const topAccountName = String(detail.account_name ?? "").toLowerCase();
        const lines = (detail.line_items ?? []) as Record<string, unknown>[];

        const allLines: Record<string, unknown>[] = lines.length > 0 ? lines : [detail];
        for (const ln of allLines) {
          const lid  = String(ln.account_id ?? topAccountId);
          const code = String(ln.account_code ?? "").trim();
          const name = String(ln.account_name ?? topAccountName).toLowerCase();
          const matchesId   = target_account_id && lid  === target_account_id;
          const matchesCode = account_code       && code === account_code;
          const matchesFuel = name.includes("fuel");
          if (matchesId || matchesCode || matchesFuel) {
            hits.push({
              source:       src.source,
              txn_id:       id,
              date:         String(detail.date ?? detail.journal_date ?? ""),
              status:       String(detail.status ?? ""),
              vendor:       String(detail.vendor_name ?? detail.contact_name ?? detail.payee ?? ""),
              account_id:   lid,
              account_code: code,
              account_name: String(ln.account_name ?? topAccountName),
              amount:       Number(ln.amount ?? ln.debit_amount ?? 0),
            });
          }
        }
      }
    }

    const total = hits.reduce((s, h) => s + h.amount, 0);
    return NextResponse.json({ date_from, date_to, hit_count: hits.length, total_zoho: Math.round(total * 100) / 100, hits });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
