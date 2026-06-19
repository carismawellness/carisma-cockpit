import { ZohoBooksClient } from "./zoho-client";

export type PlAccount = { code: string; name: string; section: string; amount: number };

const SECTION_TYPES: Record<string, string> = {
  income:             "income",
  revenue:            "income",
  other_income:       "other_income",
  cost_of_goods_sold: "cogs",
  cogs:               "cogs",
  operating_expense:  "expense",
  expense:            "expense",
  expenses:           "expense",
  other_expense:      "other_expense",
};

const SUBSECTION_TYPES: Record<string, string> = {
  "operating income":       "income",
  "income":                 "income",
  "revenue":                "income",
  "non operating income":   "other_income",
  "other income":           "other_income",
  "cost of goods sold":     "cogs",
  "operating expense":      "expense",
  "operating expenses":     "expense",
  "expense":                "expense",
  "expenses":               "expense",
  "non operating expense":  "other_expense",
  "non operating expenses": "other_expense",
  "other expense":          "other_expense",
  "other expenses":         "other_expense",
};

function extractAccounts(node: unknown, sectionType: string, result: PlAccount[]): void {
  if (Array.isArray(node)) {
    for (const item of node) extractAccounts(item, sectionType, result);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const sub = obj.accounts;
  if (sub) { extractAccounts(sub, sectionType, result); return; }

  const code = String(obj.account_code ?? "").trim();
  const name = String(obj.account_name ?? "").trim();
  if (!name && !code) return;

  let amount = 0;
  for (const field of ["bcy_balance", "balance", "total", "amount", "debit_amount"]) {
    const raw = obj[field];
    if (raw != null) { amount = Math.abs(Number(raw) || 0); break; }
  }
  if (amount === 0) {
    const debit  = Number(obj.debit_amount  ?? 0);
    const credit = Number(obj.credit_amount ?? 0);
    amount = sectionType === "income"
      ? Math.max(0, credit - debit)
      : Math.max(0, debit - credit);
  }
  result.push({ code, name, section: sectionType, amount });
}

function walkAccountTxns(nodes: unknown[], sectionType: string | null, result: PlAccount[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    let raw   = String(obj.name ?? "").toLowerCase().trim();
    if (raw.startsWith("total ")) raw = raw.slice(6);
    const stype = SUBSECTION_TYPES[raw] ?? sectionType;

    const sub = obj.account_transactions as unknown[] | undefined;
    if (sub) {
      walkAccountTxns(sub, stype, result);
    } else {
      if (!stype) continue;
      const code   = String(obj.account_code ?? "").trim();
      const name   = String(obj.name ?? "").trim();
      if (!name && !code) continue;
      const amount = Math.abs(Number(obj.total ?? 0));
      result.push({ code, name, section: stype, amount });
    }
  }
}

export async function fetchPlAccounts(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
  tagId?: string,
): Promise<PlAccount[]> {
  const params: Record<string, string> = {
    from_date:  fromDate,
    to_date:    toDate,
    cash_based: "false",
  };
  if (tagId) {
    params.tag_id        = tagId;   // tag group ID filter (some Zoho versions)
    params.tag_option_id = tagId;   // tag option ID filter (Zoho Books v3)
  }
  const data = await client.get("reports/profitandloss", params) as Record<string, unknown>;

  const pl: unknown = data.profit_and_loss ?? data;
  const accounts: PlAccount[] = [];

  if (Array.isArray(pl)) {
    walkAccountTxns(pl, null, accounts);
  } else if (pl && typeof pl === "object") {
    const plObj = pl as Record<string, unknown>;
    for (const [key, stype] of Object.entries(SECTION_TYPES)) {
      if (key in plObj) extractAccounts(plObj[key], stype, accounts);
    }
  }
  return accounts;
}
