import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "../../../../lib/etl/zoho-client";
import { loadSpaCoaFromSupabase, COA_MAP } from "../../../../lib/etl/spa-ebitda";

// Debug endpoint for Car-Fuel investigation.
// Usage A: POST { txn_id: "...", txn_type: "expense" }           → fetch expense detail
// Usage B: POST { account_id: "..." }                            → trace account through ETL's COA cache
// Usage C: POST { list_expenses: true, date_from: "...", date_to: "..." } → list all expense IDs in date range
// Usage D: POST { coa_check: true }                              → show runtime coaMap for fuel accounts (611151, 611152)
// Usage E: POST { fix_fuel_rule: true }                          → change 611151 split rule salary_cost→equal in Supabase zoho_coa_mapping
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>;
    const client = new ZohoBooksClient("spa");

    // Usage E: fix 611151 split rule in Supabase (salary_cost → equal)
    if (body.fix_fuel_rule) {
      const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const hdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

      // Step 1: find the split_rule_id for rule_type="equal" in coa_split_rules
      const rulesResp = await fetch(`${base}/rest/v1/coa_split_rules?select=id,rule_type&rule_type=eq.equal&limit=5`, { headers: hdrs });
      if (!rulesResp.ok) return NextResponse.json({ error: `coa_split_rules fetch failed: ${rulesResp.status} ${await rulesResp.text()}` }, { status: 500 });
      const rules = await rulesResp.json() as Array<{ id: number; rule_type: string }>;
      if (!rules.length) return NextResponse.json({ error: "No equal rule found in coa_split_rules" }, { status: 500 });
      const equalRuleId = rules[0].id;

      // Step 2: read current mapping for 611151
      const currentResp = await fetch(`${base}/rest/v1/zoho_coa_mapping?select=id,account_code,ebitda_line,split_rule_id&zoho_org=eq.spa&account_code=eq.611151`, { headers: hdrs });
      if (!currentResp.ok) return NextResponse.json({ error: `read current mapping failed: ${currentResp.status}` }, { status: 500 });
      const currentRows = await currentResp.json() as Array<{ id: number; account_code: string; ebitda_line: string; split_rule_id: number }>;

      // Step 3: update split_rule_id for each matching row
      const updated: unknown[] = [];
      for (const row of currentRows) {
        const patchResp = await fetch(`${base}/rest/v1/zoho_coa_mapping?id=eq.${row.id}`, {
          method: "PATCH", headers: hdrs, body: JSON.stringify({ split_rule_id: equalRuleId }),
        });
        updated.push({ id: row.id, account_code: row.account_code, old_rule_id: row.split_rule_id, new_rule_id: equalRuleId, ok: patchResp.ok, status: patchResp.status });
      }
      return NextResponse.json({ equal_rule_id: equalRuleId, rows_found: currentRows.length, updated });
    }

    // Usage D: check runtime coaMap for fuel accounts
    if (body.coa_check) {
      const supabaseMap = await loadSpaCoaFromSupabase().catch(() => null);
      const runtimeMap = supabaseMap ?? COA_MAP;
      const accounts = ["611151", "611152", "611539"];
      const result: Record<string, unknown> = {};
      for (const code of accounts) {
        result[code] = {
          hardcoded:   COA_MAP[code as keyof typeof COA_MAP] ?? null,
          supabase:    supabaseMap ? (supabaseMap[code] ?? null) : "SUPABASE_LOAD_FAILED",
          runtime:     runtimeMap[code as keyof typeof runtimeMap] ?? null,
        };
      }
      return NextResponse.json({ supabase_loaded: !!supabaseMap, supabase_total_accounts: supabaseMap ? Object.keys(supabaseMap).length : 0, accounts: result });
    }

    // Usage C: list ALL expense IDs from Zoho for a date range (replicates listAllPages)
    if (body.list_expenses) {
      const dateFrom = body.date_from ?? "2026-05-01";
      const dateTo   = body.date_to   ?? "2026-05-31";
      const allExpenses: Array<{ id: string; date: string; status: string; account_name?: string; vendor?: string; total?: number }> = [];
      let page = 1;
      while (true) {
        const data = await client.get("expenses", { page: String(page), per_page: "200", date_start: dateFrom, date_end: dateTo }) as Record<string, unknown>;
        const items = (data.expenses ?? []) as Record<string, unknown>[];
        for (const e of items) {
          allExpenses.push({
            id:           String(e.expense_id ?? ""),
            date:         String(e.date ?? ""),
            status:       String(e.status ?? ""),
            account_name: String(e.account_name ?? ""),
            vendor:       String(e.vendor_name ?? e.paid_through_account_name ?? ""),
            total:        Number(e.total ?? 0),
          });
        }
        const ctx = data.page_context as Record<string, unknown> | undefined;
        if (!ctx?.has_more_page) break;
        page++;
      }
      const TARGET_IDS = ["128265000029309134","128265000029294849","128265000029186704"];
      return NextResponse.json({
        date_from: dateFrom, date_to: dateTo,
        total_expenses: allExpenses.length,
        missing_in_list: TARGET_IDS.filter(id => !allExpenses.find(e => e.id === id)),
        found_in_list: TARGET_IDS.filter(id => !!allExpenses.find(e => e.id === id)),
        all_expense_ids: allExpenses.map(e => ({ id: e.id, date: e.date, status: e.status, vendor: e.vendor, total: e.total })),
      });
    }

    // Usage A: fetch specific transaction by ID
    if (body.txn_id) {
      const type = body.txn_type ?? "expense";
      const endpointMap: Record<string, { ep: string; key: string }> = {
        expense:      { ep: "expenses",       key: "expense"       },
        bill:         { ep: "bills",          key: "bill"          },
        journal:      { ep: "journals",       key: "journal"       },
        vendorcredit: { ep: "vendor_credits", key: "vendor_credit" },
      };
      const cfg = endpointMap[type];
      if (!cfg) return NextResponse.json({ error: `Unknown txn_type: ${type}` }, { status: 400 });
      const detail = await client.get(`${cfg.ep}/${body.txn_id}`) as Record<string, unknown>;
      return NextResponse.json({ txn_id: body.txn_id, txn_type: type, detail: detail[cfg.key] ?? detail });
    }

    // Usage B: replicate ETL's loadAccountMeta (active + inactive passes) and
    // return what section the target account gets. This tells us whether the
    // ETL would drop lines for this account at the "if (section === 'other')" gate.
    const target_account_id = body.account_id ?? "";
    if (!target_account_id) return NextResponse.json({ error: "account_id or txn_id required" }, { status: 400 });

    type AccountEntry = {
      account_id: string; account_code: string; account_name: string;
      account_type: string; is_active: boolean; section: string; pass: string;
    };
    const allAccounts = new Map<string, AccountEntry>();

    async function loadPass(extra: Record<string, string>, passLabel: string) {
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
            pass: passLabel,
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
      etl_would_drop: !targetAcct || targetAcct.section === "other",
      total_accounts: allAccounts.size,
      active_count: afterActive,
      inactive_count: allAccounts.size - afterActive,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), stack: (e as Error).stack?.split("\n").slice(0, 5) }, { status: 500 });
  }
}
