import { ZohoBooksClient } from "./zoho-client";
import { select } from "./supabase-etl";
import { fetchPlAccounts, PlAccount } from "./zoho-pl-parser";
import { COA_MAP, loadSpaCoaFromSupabase } from "./spa-ebitda";

// ── Below-EBITDA detection ────────────────────────────────────────────────────

const BELOW_EBITDA_CODES: Record<string, string> = {
  "605":    "Interest & Finance Charges",
  "616800": "Corporate Tax",
  "2356":   "Assets Written Off / Amortisation",
  "611110": "Depreciation",
  "611114": "Depreciation",
  "611115": "Depreciation",
};
const BELOW_EBITDA_KEYWORDS = [
  "depreciat", "amortis", "amortiz",
  "interest paid", "finance charge", "bank interest",
  "corporate tax", "income tax",
];
const SPA_SUPP_SLUGS = new Set([
  "inter", "hugos", "hyatt", "ramla", "labranda", "odycy", "excelsior", "novotel", "hq",
]);

function isBelowEbitda(code: string, name: string): [boolean, string] {
  if (code in BELOW_EBITDA_CODES) return [true, BELOW_EBITDA_CODES[code]];
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

// ── Full CoA loader from DB ───────────────────────────────────────────────────

async function loadAllCoaFromDb(org: string): Promise<Record<string, Record<string, unknown>>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({
    select:   "account_code,account_name,ebitda_line,split_rule_id",
    zoho_org: `eq.${org}`,
    limit:    "2000",
  });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to load CoA from DB: ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>[];
  return Object.fromEntries(data.map(r => [String(r.account_code ?? ""), r]));
}

// ── Gap analysis ──────────────────────────────────────────────────────────────

function gapAnalysis(
  accounts: PlAccount[],
  activeCoaCodes: Set<string>,
  dbMap: Record<string, Record<string, unknown>>,
) {
  const incomeInDb  = Object.fromEntries(
    Object.entries(dbMap).filter(([, r]) => r.ebitda_line === "revenue"),
  );
  const zohoByCode  = Object.fromEntries(
    accounts.filter(a => a.amount > 0).map(a => [a.code, a]),
  );

  const excludedExp:   { code: string; name: string; amount: number }[] = [];
  const notLinkedExp:  { code: string; name: string; amount: number; note: string }[] = [];
  const notInDbExp:    { code: string; name: string; amount: number; note: string }[] = [];
  const belowExp:      { code: string; name: string; amount: number; category: string }[] = [];
  const incomeMissing: { code: string; name: string; amount: number; note: string }[] = [];

  for (const [code, acc] of Object.entries(zohoByCode)) {
    if (!["cogs", "expense", "other_expense"].includes(acc.section)) continue;
    const amt = +acc.amount.toFixed(2);
    const [below, label] = isBelowEbitda(code, acc.name);
    if (below) { belowExp.push({ code, name: acc.name, amount: amt, category: label }); continue; }
    if (code in dbMap) {
      const row  = dbMap[code];
      const el   = row.ebitda_line as string | null;
      const name = String(row.account_name ?? acc.name);
      if (el === "excluded") excludedExp.push({ code, name, amount: amt });
      else if (!el) notLinkedExp.push({ code, name, amount: amt, note: "In DB but no EBITDA line assigned" });
      continue;
    }
    if (!activeCoaCodes.has(code)) {
      notInDbExp.push({ code, name: acc.name, amount: amt, note: "Not in COA mapping (ETL used name-based default)" });
    }
  }

  for (const [code, row] of Object.entries(incomeInDb)) {
    if (!(code in zohoByCode)) {
      incomeMissing.push({ code, name: String(row.account_name ?? code), amount: 0, note: "Mapped as revenue in settings but no Zoho figure this period" });
    }
  }

  const byAmt = <T extends { amount: number }>(a: T[]) => [...a].sort((x, y) => y.amount - x.amount);
  return {
    excluded_expenses:    byAmt(excludedExp),
    not_linked_expenses:  byAmt(notLinkedExp),
    not_in_db_expenses:   byAmt(notInDbExp),
    below_ebitda:         byAmt(belowExp),
    income_mapped_missing: [...incomeMissing].sort((a, b) => a.code.localeCompare(b.code)),
    totals: {
      excluded_total:      +excludedExp .reduce((s, x) => s + x.amount, 0).toFixed(2),
      not_linked_total:    +notLinkedExp.reduce((s, x) => s + x.amount, 0).toFixed(2),
      not_in_db_total:     +notInDbExp  .reduce((s, x) => s + x.amount, 0).toFixed(2),
      below_ebitda_total:  +belowExp    .reduce((s, x) => s + x.amount, 0).toFixed(2),
    },
  };
}

// ── Month key iteration ───────────────────────────────────────────────────────

function iterMonthKeys(dateFrom: string, dateTo: string): string[] {
  const keys: string[] = [];
  let y = parseInt(dateFrom.slice(0, 4)), m = parseInt(dateFrom.slice(5, 7));
  const ey = parseInt(dateTo.slice(0, 4)), em = parseInt(dateTo.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return keys;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function runSpaEbitdaCheck(dateFrom: string, dateTo: string) {
  const monthKeys = iterMonthKeys(dateFrom, dateTo);
  const client    = new ZohoBooksClient("spa");
  const accounts  = await fetchPlAccounts(client, dateFrom, dateTo);

  const activeCoa  = await loadSpaCoaFromSupabase() ?? COA_MAP;
  const activeCoaCodes = new Set(Object.keys(activeCoa));

  let dbMap: Record<string, Record<string, unknown>> = {};
  try { dbMap = await loadAllCoaFromDb("spa"); } catch { /* ignore */ }

  let ebitdaIncome = 0, ebitdaCosts = 0, belowTotal = 0;
  const belowItems: { label: string; amount: number }[] = [];

  for (const acc of accounts) {
    const [below, label] = isBelowEbitda(acc.code, acc.name);
    if (below && acc.section !== "income") {
      belowTotal += acc.amount;
      const found = belowItems.find(b => b.label === label);
      if (found) found.amount += acc.amount; else belowItems.push({ label, amount: acc.amount });
    } else if (acc.section === "income") {
      ebitdaIncome += acc.amount;
    } else if (["cogs", "expense", "other_expense"].includes(acc.section)) {
      ebitdaCosts += acc.amount;
    }
  }
  const zohoEbitda = ebitdaIncome - ebitdaCosts;

  // Salary supplement
  let salarySupplement = 0;
  const suppBySlag: Record<string, number> = {};
  let allSuppRows: Record<string, unknown>[] = [];
  for (const mk of monthKeys) {
    const rows = await select("salary_supplement_monthly", { month: mk, is_frozen: "true" });
    allSuppRows.push(...rows);
  }
  if (!allSuppRows.length && monthKeys.length) {
    const [y, m] = [parseInt(monthKeys[0].slice(0, 4)), parseInt(monthKeys[0].slice(5, 7)) - 1];
    const prevKey = `${m === 0 ? y - 1 : y}-${String(m === 0 ? 12 : m).padStart(2, "0")}-01`;
    allSuppRows = await select("salary_supplement_monthly", { month: prevKey, is_frozen: "true" });
  }
  for (const sr of allSuppRows) {
    const slug = sr.spa_slug as string;
    if (SPA_SUPP_SLUGS.has(slug)) {
      const amt = Number(sr.amount ?? 0);
      salarySupplement += amt;
      suppBySlag[slug]  = (suppBySlag[slug] ?? 0) + amt;
    }
  }

  // Actuals from spa_ebitda_daily (aggregated over date range)
  let actualEbitda = 0, actualRevenue = 0;
  {
    const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const qs = new URLSearchParams([
      ["select", "revenue,cogs,wages,advertising,rent,utilities,sga"],
      ["date",   `gte.${dateFrom}`],
      ["date",   `lte.${dateTo}`],
    ]);
    const resp = await fetch(`${base}/rest/v1/spa_ebitda_daily?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      for (const r of await resp.json() as Record<string, unknown>[]) {
        const rev   = Number(r.revenue ?? 0);
        const costs = (["cogs", "wages", "advertising", "rent", "utilities", "sga"] as const)
          .reduce((s: number, f) => s + Number(r[f] ?? 0), 0);
        actualEbitda  += rev - costs;
        actualRevenue += rev;
      }
    }
  }

  let cockpitRevenue = 0;
  for (const mk of monthKeys) {
    const rows = await select("spa_revenue_monthly", { month: mk });
    for (const r of rows) {
      cockpitRevenue += Number(r.services ?? 0) + Number(r.product_phytomer ?? 0) +
        Number(r.product_purest ?? 0) + Number(r.product_other ?? 0) +
        Number(r.wholesale ?? 0) - Number(r.sales_discount ?? 0) - Number(r.sales_refund ?? 0);
    }
  }

  const revenueGap         = cockpitRevenue - actualRevenue;
  const frontendEbitda     = actualEbitda + revenueGap;
  const expectedEbitda     = zohoEbitda - salarySupplement;
  const expectedWithCockpit  = expectedEbitda + revenueGap;

  return {
    period: { date_from: dateFrom, date_to: dateTo },
    zoho: {
      revenue:      +ebitdaIncome.toFixed(2),
      costs:        +ebitdaCosts .toFixed(2),
      ebitda:       +zohoEbitda  .toFixed(2),
      below_ebitda: belowItems.map(b => ({ label: b.label, amount: +b.amount.toFixed(2) })),
      below_total:  +belowTotal  .toFixed(2),
    },
    salary_supplement: {
      total:    +salarySupplement.toFixed(2),
      by_slug:  Object.fromEntries(Object.entries(suppBySlag).map(([k, v]) => [k, +v.toFixed(2)])),
    },
    reconciliation: {
      zoho_ebitda:            +zohoEbitda      .toFixed(2),
      salary_supplement:      +salarySupplement.toFixed(2),
      expected_ebitda:        +expectedEbitda  .toFixed(2),
      actual_ebitda_zoho_rev: +actualEbitda    .toFixed(2),
      cockpit_revenue:          +cockpitRevenue    .toFixed(2),
      zoho_revenue:           +actualRevenue   .toFixed(2),
      revenue_gap:            +revenueGap      .toFixed(2),
      frontend_ebitda:        +frontendEbitda  .toFixed(2),
      expected_with_cockpit:    +expectedWithCockpit.toFixed(2),
      difference:             +(frontendEbitda - expectedWithCockpit).toFixed(2),
      status: Math.abs(frontendEbitda - expectedWithCockpit) < 500 ? "ok" : "mismatch",
    },
    gap_analysis: gapAnalysis(accounts, activeCoaCodes, dbMap),
  };
}
