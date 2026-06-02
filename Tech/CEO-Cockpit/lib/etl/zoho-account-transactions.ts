import { ZohoBooksClient } from "./zoho-client";

// ─────────────────────────────────────────────────────────────────────────────
// Per-account GL transaction puller.
//
// Drives the EBITDA "drill-down" feature: given a Zoho account_code (or several)
// and a date window, return every individual GL line that posted to that account
// in the window — the genuine transaction-level audit trail behind a P&L-by-Venue
// cell.
//
// Source endpoint: `chartofaccounts/transactions` (the same one the Python
// breakdown scripts in /etl use). It exposes, per GL line:
//   transaction_date, transaction_type, transaction_id, entry_number,
//   reference_number, payee, debit_amount, credit_amount, account_id,
//   (sometimes) description / notes.
//
// Unlike the entity endpoints used by zoho-line-extractor, this endpoint is
// already keyed by account so we don't have to pull/scan every invoice + bill +
// expense in the org. That keeps the drill-down fast (a handful of calls per
// cell instead of the full EBIDA Layer pull).
//
// NOTE: this endpoint returns the LITERAL signed GL amount (debit − credit for
// expense/COGS accounts, credit − debit for income). The dashboard cell value
// is the POST-allocation, POST-fallback figure. The route layered on top of this
// reconciles the two and surfaces the allocation factor — see the route file.
// ─────────────────────────────────────────────────────────────────────────────

export type AccountTxn = {
  account_code:     string;
  account_name:     string;
  date:             string;        // YYYY-MM-DD
  transaction_type: string;        // invoice / bill / expense / journal / …
  transaction_id:   string;
  reference:        string;        // entry_number || reference_number
  payee:            string;        // vendor / customer / GL-line payee
  description:      string;        // line description / notes when available
  // Signed literal amount in base currency (EUR), using the section convention:
  //   expense / cogs accounts → debit − credit  (a cost is positive)
  //   income accounts         → credit − debit  (revenue is positive)
  amount:           number;
};

// chartofaccounts list cache, per org+account_code → { id, name, section }.
// One COA list call per org is enough; cached across requests in-process.
type AcctInfo = { id: string; name: string; section: "income" | "expense" | "other" };
const coaCache = new Map<string, Map<string, AcctInfo>>();   // org → (code → info)

function sectionForType(type: string): "income" | "expense" | "other" {
  const t = type.toLowerCase();
  if (t.includes("income") || t.includes("revenue")) return "income";
  if (t.includes("expense") || t.includes("cost_of_goods") || t.includes("cogs")) return "expense";
  return "other";
}

async function loadCoaByCode(client: ZohoBooksClient): Promise<Map<string, AcctInfo>> {
  const cached = coaCache.get(client.org);
  if (cached) return cached;

  const byCode = new Map<string, AcctInfo>();
  // Two passes (active + inactive) mirror loadAccountMeta in zoho-line-extractor —
  // historical postings can sit on since-deactivated accounts.
  for (const extra of [{}, { filter_by: "AccountType.Inactive" }] as Record<string, string>[]) {
    let page = 1;
    while (true) {
      let data: Record<string, unknown>;
      try {
        data = await client.get("chartofaccounts", {
          page: String(page), per_page: "200", ...extra,
        }) as Record<string, unknown>;
      } catch {
        break;   // inactive filter unsupported / failed — keep what we have
      }
      const accounts = (data.chartofaccounts ?? []) as Array<Record<string, unknown>>;
      for (const a of accounts) {
        const id   = String(a.account_id ?? "");
        const code = String(a.account_code ?? "").trim();
        if (!id || !code) continue;
        if (byCode.has(code)) continue;   // active pass wins
        byCode.set(code, {
          id,
          name:    String(a.account_name ?? "").trim(),
          section: sectionForType(String(a.account_type ?? "")),
        });
      }
      const ctx = data.page_context as Record<string, unknown> | undefined;
      if (!ctx?.has_more_page) break;
      page++;
    }
  }
  coaCache.set(client.org, byCode);
  return byCode;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull every GL line for one account_code in [fromDate, toDate] (inclusive).
 * Returns [] (not an error) when the code is unknown to the org's COA.
 */
export async function fetchAccountTransactions(
  client:   ZohoBooksClient,
  accountCode: string,
  fromDate: string,
  toDate:   string,
): Promise<AccountTxn[]> {
  const coa  = await loadCoaByCode(client);
  const info = coa.get(accountCode);
  if (!info) return [];

  const raw = await client.getAllPages(
    "chartofaccounts/transactions",
    "transactions",
    { account_id: info.id, from_date: fromDate, to_date: toDate },
  ) as Array<Record<string, unknown>>;

  const out: AccountTxn[] = [];
  for (const t of raw) {
    const date = String(t.transaction_date ?? "").slice(0, 10);
    if (!date || date < fromDate || date > toDate) continue;

    const debit  = num(t.debit_amount);
    const credit = num(t.credit_amount);
    // Section convention: cost positive for expense/cogs, revenue positive for income.
    const signed = info.section === "income" ? credit - debit : debit - credit;
    if (signed === 0) continue;

    out.push({
      account_code:     accountCode,
      account_name:     info.name,
      date,
      transaction_type: String(t.transaction_type ?? "").trim(),
      transaction_id:   String(t.transaction_id ?? ""),
      reference:        String(t.entry_number ?? t.reference_number ?? "").trim(),
      payee:            String(t.payee ?? t.contact_name ?? "").trim(),
      description:      String(t.description ?? t.notes ?? "").trim(),
      amount:           Math.round(signed * 100) / 100,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  return out;
}

/** Pull transactions for many account codes in parallel-ish (sequential to be
 *  gentle on Zoho rate limits). Returns one flat array tagged by account_code. */
export async function fetchTransactionsForAccounts(
  client:   ZohoBooksClient,
  codes:    string[],
  fromDate: string,
  toDate:   string,
): Promise<{ txns: AccountTxn[]; unknownCodes: string[] }> {
  const txns: AccountTxn[] = [];
  const unknownCodes: string[] = [];
  const coa = await loadCoaByCode(client);
  for (const code of codes) {
    if (!coa.has(code)) { unknownCodes.push(code); continue; }
    const part = await fetchAccountTransactions(client, code, fromDate, toDate);
    txns.push(...part);
  }
  return { txns, unknownCodes };
}
