import { ZohoBooksClient } from "./zoho-client";
import { fetchPlAccounts, PlAccount } from "./zoho-pl-parser";
import { loadAestheticsCoaMap } from "./aesthetics-ebitda";

const BELOW_EBITDA_KEYWORDS = [
  "depreciat", "amortis", "amortiz",
  "interest paid", "finance charge", "bank interest",
  "corporate tax", "income tax",
];

function isBelowEbitda(name: string): [boolean, string] {
  const low = name.toLowerCase();
  for (const kw of BELOW_EBITDA_KEYWORDS) {
    if (low.includes(kw)) {
      const label = /depreciat|amortis|amortiz/.test(low)
        ? "Depreciation & Amortisation"
        : /interest|finance/.test(low)
          ? "Interest & Finance Charges"
          : "Corporate Tax";
      return [true, label];
    }
  }
  return [false, ""];
}

async function loadAllCoaFromDb(org: string): Promise<Record<string, Record<string, unknown>>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({ select: "account_code,account_name,ebitda_line,split_rule_id", zoho_org: `eq.${org}`, limit: "2000" });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!resp.ok) throw new Error(`Failed to load CoA: ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>[];
  return Object.fromEntries(data.map(r => [String(r.account_code ?? ""), r]));
}

async function loadSalesRevenue(fromDate: string, toDate: string): Promise<Record<string, number>> {
  const result: Record<string, number> = { aesthetics: 0, slimming: 0 };
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  for (const [table, dept] of [["aesthetics_sales_daily", "aesthetics"], ["slimming_sales_daily", "slimming"]] as const) {
    try {
      const qs = new URLSearchParams([["select", "price_ex_vat"], ["date_of_service", `gte.${fromDate}`], ["date_of_service", `lte.${toDate}`], ["limit", "10000"]]);
      const resp = await fetch(`${base}/rest/v1/${table}?${qs}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (resp.ok) result[dept] = (await resp.json() as Record<string, unknown>[]).reduce((s, r) => s + Number(r.price_ex_vat ?? 0), 0);
    } catch { /* ignore */ }
  }
  return result;
}

function gapAnalysis(
  accounts: PlAccount[],
  activeCoaCodes: Set<string>,
  dbMap: Record<string, Record<string, unknown>>,
) {
  const incomeInDb  = Object.fromEntries(Object.entries(dbMap).filter(([, r]) => r.ebitda_line === "revenue"));
  const zohoByCode  = Object.fromEntries(accounts.filter(a => a.amount > 0).map(a => [a.code, a]));

  const excludedExp: { code: string; name: string; amount: number }[] = [];
  const notLinkedExp: { code: string; name: string; amount: number; note: string }[] = [];
  const notInDbExp:  { code: string; name: string; amount: number; note: string }[] = [];
  const belowExp:    { code: string; name: string; amount: number; category: string }[] = [];
  const incomeMissing: { code: string; name: string; amount: number; note: string }[] = [];

  for (const [code, acc] of Object.entries(zohoByCode)) {
    if (!["cogs", "expense", "other_expense"].includes(acc.section)) continue;
    const amt = +acc.amount.toFixed(2);
    const [below, label] = isBelowEbitda(acc.name);
    if (below) { belowExp.push({ code, name: acc.name, amount: amt, category: label }); continue; }
    if (code in dbMap) {
      const row = dbMap[code]; const el = row.ebitda_line as string | null; const name = String(row.account_name ?? acc.name);
      if (el === "excluded") excludedExp.push({ code, name, amount: amt });
      else if (!el) notLinkedExp.push({ code, name, amount: amt, note: "In DB but no EBITDA line assigned" });
      continue;
    }
    if (!activeCoaCodes.has(code)) notInDbExp.push({ code, name: acc.name, amount: amt, note: "Not in COA mapping" });
  }
  for (const [code, row] of Object.entries(incomeInDb)) {
    if (!(code in zohoByCode)) incomeMissing.push({ code, name: String(row.account_name ?? code), amount: 0, note: "Mapped as revenue but no Zoho figure this period" });
  }

  const byAmt = <T extends { amount: number }>(a: T[]) => [...a].sort((x, y) => y.amount - x.amount);
  return {
    excluded_expenses:     byAmt(excludedExp),
    not_linked_expenses:   byAmt(notLinkedExp),
    not_in_db_expenses:    byAmt(notInDbExp),
    below_ebitda:          byAmt(belowExp),
    income_mapped_missing: [...incomeMissing].sort((a, b) => a.code.localeCompare(b.code)),
    totals: {
      excluded_total:      +excludedExp .reduce((s, x) => s + x.amount, 0).toFixed(2),
      not_linked_total:    +notLinkedExp.reduce((s, x) => s + x.amount, 0).toFixed(2),
      not_in_db_total:     +notInDbExp  .reduce((s, x) => s + x.amount, 0).toFixed(2),
      below_ebitda_total:  +belowExp    .reduce((s, x) => s + x.amount, 0).toFixed(2),
    },
  };
}

export async function runAestheticsEbitdaCheck(dateFrom: string, dateTo: string) {
  const client    = new ZohoBooksClient("aesthetics");
  const accounts  = await fetchPlAccounts(client, dateFrom, dateTo);

  let coaMap: Record<string, [string, string]> = {};
  let activeCoaCodes = new Set<string>();
  try { coaMap = await loadAestheticsCoaMap(); activeCoaCodes = new Set(Object.keys(coaMap)); } catch { /* ignore */ }

  let dbMap: Record<string, Record<string, unknown>> = {};
  try { dbMap = await loadAllCoaFromDb("aesthetics"); } catch { /* ignore */ }

  let zohoTotalIncome = 0, ebitdaIncome = 0, ebitdaCosts = 0, belowTotal = 0;
  const belowItems: { label: string; amount: number }[] = [];
  const incomeAccounts: Record<string, unknown>[] = [];

  for (const acc of accounts) {
    const [below, label] = isBelowEbitda(acc.name);
    if (below && acc.section !== "income") {
      belowTotal += acc.amount;
      const found = belowItems.find(b => b.label === label);
      if (found) found.amount += acc.amount; else belowItems.push({ label, amount: acc.amount });
    } else if (acc.section === "income") {
      const dbRow   = dbMap[acc.code] ?? {};
      const ebitdaLn = dbRow.ebitda_line as string | null;
      const inCoa    = activeCoaCodes.has(acc.code);
      const included = inCoa && ebitdaLn === "revenue";
      zohoTotalIncome += acc.amount;
      if (included) ebitdaIncome += acc.amount;
      const deptHint = acc.name.toLowerCase().includes("slimming") ? "slimming" : "aesthetics";
      const coaRule  = coaMap[acc.code]?.[0] ?? null;
      incomeAccounts.push({
        code: acc.code || "(no code)", name: acc.name, amount: +acc.amount.toFixed(2),
        dept: deptHint, ebitda_line: ebitdaLn, split_rule: coaRule ?? "not mapped — excluded",
        in_coa_map: inCoa, included,
      });
    } else if (["cogs", "expense", "other_expense"].includes(acc.section)) {
      ebitdaCosts += acc.amount;
    }
  }
  incomeAccounts.sort((a, b) => Number(b.amount) - Number(a.amount));

  const zohoEbitda = zohoTotalIncome - ebitdaCosts;
  const coaEbitda  = ebitdaIncome    - ebitdaCosts;

  const salesRev   = await loadSalesRevenue(dateFrom, dateTo);
  const salesTotal = salesRev.aesthetics + salesRev.slimming;
  const expectedEbitda = coaEbitda + salesTotal;

  const DEPTS = ["aesthetics", "slimming"] as const;
  const fields = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"];
  const dbByDept: Record<string, Record<string, number>> = {
    aesthetics: Object.fromEntries(fields.map(f => [f, 0])),
    slimming:   Object.fromEntries(fields.map(f => [f, 0])),
  };
  {
    const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const qs = new URLSearchParams([
      ["select", "department,revenue,cogs,wages,advertising,rent,utilities,sga"],
      ["date",   `gte.${dateFrom}`],
      ["date",   `lte.${dateTo}`],
    ]);
    const resp = await fetch(`${base}/rest/v1/aesthetics_ebitda_daily?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      for (const r of await resp.json() as Record<string, unknown>[]) {
        const dept = String(r.department ?? "aesthetics");
        if (dept in dbByDept) for (const f of fields) dbByDept[dept][f] += Number(r[f] ?? 0);
      }
    }
  }

  const dbTotals: Record<string, unknown> = {};
  for (const dept of DEPTS) {
    const d    = dbByDept[dept];
    const costs = fields.slice(1).reduce((s, f) => s + d[f], 0);
    const sales = salesRev[dept] ?? 0;
    dbTotals[dept] = {
      coa_revenue:   +d.revenue.toFixed(2),
      sales_revenue: +sales.toFixed(2),
      revenue:       +(d.revenue + sales).toFixed(2),
      costs:         +costs.toFixed(2),
      ebitda:        +(d.revenue + sales - costs).toFixed(2),
    };
  }

  const frontendEbitda = DEPTS.reduce((s, d) => s + Number((dbTotals[d] as Record<string, number>).ebitda), 0);
  const difference     = frontendEbitda - expectedEbitda;

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    zoho: {
      total_income:    +zohoTotalIncome.toFixed(2),
      zoho_ebitda:     +zohoEbitda    .toFixed(2),
      coa_income:      +ebitdaIncome  .toFixed(2),
      costs:           +ebitdaCosts   .toFixed(2),
      coa_ebitda:      +coaEbitda     .toFixed(2),
      below_ebitda:    belowItems.map(b => ({ label: b.label, amount: +b.amount.toFixed(2) })),
      below_total:     +belowTotal    .toFixed(2),
      income_accounts: incomeAccounts,
    },
    sales_daily: {
      aesthetics: +salesRev.aesthetics.toFixed(2),
      slimming:   +salesRev.slimming  .toFixed(2),
      total:      +salesTotal         .toFixed(2),
    },
    db_totals: dbTotals,
    reconciliation: {
      zoho_coa_income:   +ebitdaIncome  .toFixed(2),
      zoho_costs:        +ebitdaCosts   .toFixed(2),
      zoho_coa_ebitda:   +coaEbitda     .toFixed(2),
      sales_daily_total: +salesTotal    .toFixed(2),
      expected_ebitda:   +expectedEbitda.toFixed(2),
      frontend_ebitda:   +frontendEbitda.toFixed(2),
      difference:        +difference    .toFixed(2),
      status: Math.abs(difference) < 500 ? "ok" : "mismatch",
    },
    gap_analysis: gapAnalysis(accounts, activeCoaCodes, dbMap),
  };
}
