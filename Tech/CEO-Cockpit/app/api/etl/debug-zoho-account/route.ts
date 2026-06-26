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

    // Replicate ETL's loadAccountMeta: active pass + AccountType.Inactive pass
    // Then look up the target account_id to see its type and section
    const target_account_id = body.account_id ?? "";
    if (!target_account_id) {
      return NextResponse.json({ error: "account_id required" }, { status: 400 });
    }

    type AccountEntry = { account_id: string; account_code: string; account_name: string; account_type: string; is_active: boolean; section: string; };
    const allAccounts = new Map<string, AccountEntry>();

    async function loadPass(extra: Record<string, string>, label: string) {
      let page = 1;
      while (true) {
        const data = await client.get("chartofaccounts", { page: String(page), per_page: "200", ...extra }) as Record<string, unknown>;
        const accounts = (data.chartofaccounts ?? []) as Record<string, unknown>[];
        for (const a of accounts) {
          const id = String(a.account_id ?? "");
          if (!id || allAccounts.has(id)) continue;
          const type = String(a.account_type ?? "").toLowerCase();
          let section = "other";
          if (type.includes("income") || type.includes("revenue")) section = "income";
          else if (type.includes("expense") || type.includes("cost_of_goods") || type.includes("cogs")) section = "expense";
          allAccounts.set(id, {
            account_id: id,
            account_code: String(a.account_code ?? "").trim(),
            account_name: String(a.account_name ?? "").trim(),
            account_type: type,
            is_active: Boolean(a.is_active),
            section,
          });
        }
        const ctx = data.page_context as Record<string, unknown> | undefined;
        if (!ctx?.has_more_page) break;
        page++;
      }
    }

    await loadPass({}, "active");
    const afterActive = allAccounts.size;
    await loadPass({ filter_by: "AccountType.Inactive" }, "inactive");

    const targetAcct = allAccounts.get(target_account_id);
    return NextResponse.json({
      target_account_id,
      found: !!targetAcct,
      account_detail: targetAcct ?? null,
      total_accounts: allAccounts.size,
      active_count: afterActive,
      inactive_count: allAccounts.size - afterActive,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
