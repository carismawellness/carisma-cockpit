import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { fetchPlAccounts, PlAccount } from "./zoho-pl-parser";

// ── Location mapping ──────────────────────────────────────────────────────────

export const LOCATION_MAP: Record<string, number> = {
  intercontinental: 1,
  hugos:            2,
  hyatt:            3,
  ramla:            4,
  labranda:         5,
  sunny_coast:      6,
  excelsior:        7,
  novotel:          8,
};
const ALL_LOCATION_IDS = Object.values(LOCATION_MAP);

const BENCHMARK_RENT_MONTHLY: Record<number, number> = {
  1: 5100.00,  // InterContinental
  2: 1000.00,  // Hugos
  3: 1407.00,  // Hyatt
  4: 1000.00,  // Ramla
  5: 1000.00,  // Labranda
  6:  944.44,  // Sunny Coast (€2833.305/quarter ÷ 3)
  7: 2500.00,  // Excelsior
  8:    0.00,  // Novotel
};

const SUPP_SLUG_TO_LOC: Record<string, number> = {
  inter:     1,
  hugos:     2,
  hyatt:     3,
  ramla:     4,
  labranda:  5,
  odycy:     6,
  excelsior: 7,
  novotel:   8,
};

// Direct salary accounts — used as the base for salary_cost splits.
// Excludes Directors (616110), Other (616112), Center (602220).
const SALARY_RATIO_ACCOUNTS: Record<string, number> = {
  "30001":  1,
  "30002":  2,
  "30003":  3,
  "30005":  4,
  "30006":  5,
  "30004":  6,
  "602221": 7,
  "602222": 8,
};

const LAUNDRY_ACCOUNTS = new Set(["611514", "611520"]);

// ── Full hardcoded CoA map ────────────────────────────────────────────────────
// Source: ListChartOfAccounts_Mapping.xlsx (approved 2026-04-24)
// format: account_code → [split_rule, ebitda_line]

export const COA_MAP: Record<string, [string, string]> = {
  // OTHER / NON-OPERATING INCOME (flow into revenue EBITDA line)
  "000003": ["sales_ratio",      "revenue"],   // Dividends from Investments
  "000004": ["sales_ratio",      "revenue"],   // Interest Income from Investments
  // COGS
  "651110": ["sales_ratio",      "cogs"],
  "651120": ["sales_ratio",      "cogs"],
  "651210": ["intercontinental", "cogs"],
  "651220": ["intercontinental", "cogs"],
  "651310": ["ramla",            "cogs"],
  "651320": ["ramla",            "cogs"],
  "651410": ["sunny_coast",      "cogs"],
  "651420": ["sunny_coast",      "cogs"],
  "651510": ["hugos",            "cogs"],
  "651520": ["hugos",            "cogs"],
  "651610": ["hyatt",            "cogs"],
  "651620": ["hyatt",            "cogs"],
  "651630": ["sales_ratio",      "cogs"],
  "651640": ["sales_ratio",      "cogs"],
  "655110": ["sales_ratio",      "cogs"],
  "659110": ["sales_ratio",      "cogs"],
  "659120": ["sales_ratio",      "cogs"],
  "659130": ["sales_ratio",      "cogs"],
  "659140": ["sales_ratio",      "cogs"],
  "659150": ["sales_ratio",      "cogs"],
  "659151": ["equal",            "cogs"],
  "659152": ["equal",            "cogs"],
  "659153": ["equal",            "cogs"],
  "651111": ["equal",            "cogs"],
  "5552":   ["equal",            "cogs"],
  "147806": ["sales_ratio",      "cogs"],
  "651625": ["equal",            "cogs"],
  "659172": ["sales_ratio",      "cogs"],
  "651130": ["equal",            "sga"],
  // WAGES & SALARIES
  "616100": ["sales_ratio",      "wages"],
  "616110": ["sales_ratio",      "wages"],
  "616111": ["sales_ratio",      "wages"],
  "616112": ["sales_ratio",      "wages"],
  "616113": ["sales_ratio",      "wages"],
  "616114": ["intercontinental", "wages"],
  "616115": ["hugos",            "wages"],
  "616116": ["hyatt",            "wages"],
  "616117": ["ramla",            "wages"],
  "616118": ["sunny_coast",      "wages"],
  "616120": ["intercontinental", "wages"],
  "616121": ["hugos",            "wages"],
  "616122": ["hyatt",            "wages"],
  "616123": ["ramla",            "wages"],
  "616124": ["sunny_coast",      "wages"],
  "616130": ["intercontinental", "wages"],
  "616131": ["hugos",            "wages"],
  "616132": ["hyatt",            "wages"],
  "616133": ["ramla",            "wages"],
  "616134": ["sunny_coast",      "wages"],
  "616140": ["intercontinental", "wages"],
  "616141": ["hugos",            "wages"],
  "616142": ["hyatt",            "wages"],
  "616143": ["ramla",            "wages"],
  "616144": ["sunny_coast",      "sga"],
  "616145": ["sales_ratio",      "wages"],
  "616150": ["sales_ratio",      "wages"],
  "616660": ["salary_cost",      "wages"],
  "30001":  ["intercontinental", "wages"],
  "30002":  ["hugos",            "wages"],
  "30003":  ["hyatt",            "wages"],
  "30004":  ["sunny_coast",      "wages"],
  "30005":  ["ramla",            "wages"],
  "30006":  ["labranda",         "wages"],
  "602220": ["sales_ratio",      "wages"],
  "602221": ["excelsior",        "wages"],
  "602222": ["novotel",          "wages"],
  "1":      ["sales_ratio",      "wages"],
  "11":     ["sales_ratio",      "wages"],
  "123":    ["sunny_coast",      "wages"],
  "145":    ["sales_ratio",      "wages"],
  "659171": ["sales_ratio",      "wages"],
  // ADVERTISING
  "611111": ["sales_ratio", "advertising"],
  "611112": ["sales_ratio", "advertising"],
  "611113": ["sales_ratio", "advertising"],
  "659168": ["equal",       "advertising"],
  // RENT
  "619000": ["equal",            "rent"],
  "619110": ["ramla",            "rent"],
  "619120": ["sunny_coast",      "rent"],
  "619121": ["excelsior",        "rent"],
  "619123": ["novotel",          "rent"],
  "619140": ["intercontinental", "rent"],
  "619150": ["hyatt",            "rent"],
  "619160": ["hugos",            "rent"],
  "10001":  ["sunny_coast",      "rent"],
  "0":      ["labranda",         "rent"],
  "619500": ["equal",            "rent"],
  "619510": ["equal",            "rent"],
  "619520": ["equal",            "rent"],
  "619530": ["equal",            "rent"],
  "7786":   ["equal",            "rent"],
  "659162": ["equal",            "rent"],
  // UTILITIES
  "100":     ["equal",            "utilities"],
  "9090":    ["labranda",         "utilities"],
  "611511":  ["intercontinental", "utilities"],
  "611521":  ["hyatt",            "utilities"],
  "611531":  ["hugos",            "utilities"],
  "611541":  ["sunny_coast",      "utilities"],
  "611551":  ["ramla",            "utilities"],
  "611561":  ["sales_ratio",      "utilities"],
  "611562":  ["labranda",         "utilities"],
  "611563":  ["novotel",          "utilities"],
  "611564":  ["excelsior",        "utilities"],
  "12346":   ["sunny_coast",      "utilities"],
  "6125000": ["equal",            "utilities"],
  "659163":  ["equal",            "utilities"],
  // SG&A
  "616780":  ["equal",            "sga"],
  "611120":  ["sales_ratio",      "sga"],
  "611130":  ["equal",            "sga"],
  "611141":  ["equal",            "sga"],
  "611142":  ["equal",            "sga"],   // Motor Vehicles - Repairs & Maintenance (also in Supabase as sga_maintenance)
  "611143":  ["equal",            "sga"],
  "611151":  ["salary_cost",      "sga"],
  "611152":  ["intercontinental", "sga"],
  "611160":  ["equal",            "sga"],
  "611170":  ["sales_ratio",      "sga"],
  "611180":  ["equal",            "sga"],
  "611191":  ["equal",            "sga"],
  "611192":  ["equal",            "sga"],
  "611193":  ["sales_ratio",      "sga"],
  "611194":  ["equal",            "sga"],
  "611195":  ["equal",            "sga"],
  "611200":  ["equal",            "sga"],
  "611220":  ["equal",            "sga"],
  "611221":  ["equal",            "sga"],
  "611222":  ["equal",            "sga"],
  "611223":  ["equal",            "sga"],
  "611224":  ["equal",            "sga"],
  "611225":  ["equal",            "sga"],
  "611230":  ["equal",            "sga"],
  "611240":  ["equal",            "sga"],
  "611251":  ["sales_ratio",      "sga"],
  "611252":  ["sales_ratio",      "sga"],
  "611253":  ["equal",            "sga"],
  "611254":  ["sales_ratio",      "sga"],
  "611512":  ["intercontinental", "sga"],
  "611513":  ["intercontinental", "sga"],
  "611514":  ["intercontinental", "sga"],
  "611515":  ["intercontinental", "sga"],
  "611516":  ["intercontinental", "sga"],
  "611517":  ["intercontinental", "sga"],
  "611518":  ["intercontinental", "sga"],
  "611519":  ["equal",            "sga"],
  "611520":  ["equal",            "sga"],
  "611522":  ["hyatt",            "sga"],
  "611523":  ["hyatt",            "sga"],
  "611524":  ["hyatt",            "sga"],
  "611525":  ["hyatt",            "sga"],
  "611526":  ["hyatt",            "sga"],
  "611527":  ["hyatt",            "sga"],
  "611528":  ["hyatt",            "sga"],
  "611530":  ["sales_ratio",      "sga"],
  "611532":  ["hugos",            "sga"],
  "611533":  ["hugos",            "sga"],
  "611534":  ["hugos",            "sga"],
  "611535":  ["hugos",            "sga"],
  "611536":  ["hugos",            "sga"],
  "611537":  ["hugos",            "sga"],
  "611538":  ["hugos",            "sga"],
  "611539":  ["salary_cost",      "sga"],
  "611540":  ["equal",            "sga"],
  "611542":  ["sunny_coast",      "sga"],
  "611543":  ["sunny_coast",      "sga"],
  "611544":  ["sunny_coast",      "sga"],
  "611545":  ["sunny_coast",      "sga"],
  "611546":  ["sunny_coast",      "sga"],
  "611547":  ["sunny_coast",      "sga"],
  "611548":  ["sunny_coast",      "sga"],
  "611550":  ["excelsior",        "sga"],
  "611570":  ["excelsior",        "sga"],
  "611552":  ["ramla",            "sga"],
  "611553":  ["ramla",            "sga"],
  "611554":  ["ramla",            "sga"],
  "611555":  ["ramla",            "sga"],
  "611556":  ["ramla",            "sga"],
  "611557":  ["ramla",            "sga"],
  "611558":  ["ramla",            "sga"],
  "611559":  ["equal",            "sga"],
  "611560":  ["novotel",          "sga"],
  "611572":  ["novotel",          "sga"],
  "611571":  ["equal",            "sga"],
  "611110":  ["equal",            "sga"],
  "611114":  ["equal",            "sga"],
  "611115":  ["equal",            "sga"],
  "611196":  ["equal",            "sga"],
  "612520":  ["equal",            "sga"],
  "651180":  ["equal",            "sga"],
  "400025":  ["equal",            "sga"],
  "600":     ["equal",            "sga"],
  "12":      ["equal",            "sga"],
  "2222":    ["salary_cost",      "sga"],
  "98765":   ["equal",            "sga"],
  "4411":    ["labranda",         "sga"],
  "619122":  ["labranda",         "sga"],
  "619126":  ["labranda",         "sga"],
  "1457":    ["sunny_coast",      "sga"],
  "1566":    ["labranda",         "sga"],
  "14575":   ["novotel",          "sga"],
  "60007":   ["labranda",         "sga"],
  "123456":  ["equal",            "sga"],
  "123455":  ["equal",            "sga"],
  "CUST":    ["equal",            "sga"],
  "659157":  ["equal",            "sga"],
  "659158":  ["equal",            "sga"],
  "659159":  ["equal",            "sga"],
  "659160":  ["equal",            "sga"],
  "659161":  ["equal",            "sga"],
  "659164":  ["equal",            "sga"],
  "659165":  ["equal",            "sga"],
  "659166":  ["equal",            "sga"],
  "659167":  ["equal",            "sga"],
  "659169":  ["equal",            "sga"],
  "659170":  ["equal",            "sga"],
  "659173":  ["salary_cost",      "sga"],
  "659174":  ["sales_ratio",      "sga"],
  "659175":  ["equal",            "sga"],
  "659176":  ["equal",            "sga"],
  "659177":  ["equal",            "sga"],
  "616610":  ["sales_ratio",      "sga"],
  "616611":  ["sales_ratio",      "sga"],
  "616620":  ["sales_ratio",      "sga"],
  "616630":  ["sales_ratio",      "sga"],
  "616640":  ["salary_cost",      "sga"],
  "616641":  ["intercontinental", "sga"],
  "616642":  ["sunny_coast",      "sga"],
  "616643":  ["ramla",            "sga"],
  "616644":  ["salary_cost",      "sga"],
  "616650":  ["equal",            "sga"],
  "616670":  ["sales_ratio",      "sga"],
  "616671":  ["ramla",            "sga"],
  "616680":  ["equal",            "sga"],
  "616681":  ["equal",            "sga"],
  "616700":  ["equal",            "sga"],
  "616710":  ["sales_ratio",      "sga"],
  "616720":  ["equal",            "sga"],
  "616730":  ["equal",            "sga"],
  "616740":  ["equal",            "sga"],
  "616750":  ["equal",            "sga"],
  "616770":  ["equal",            "sga"],
  "616771":  ["labranda",         "sga"],
  "605":     ["equal",            "sga"],
  "6050005": ["equal",            "sga"],
  "2356":    ["equal",            "sga"],
  "616800":  ["equal",            "sga"],
  "25":      ["equal",            "sga"],
  "999":     ["equal",            "sga"],
};

// ── CoA loader from Supabase ──────────────────────────────────────────────────

const UI_KEY_TO_LOC: Record<string, string> = {
  inter:     "intercontinental",
  hugos:     "hugos",
  hyatt:     "hyatt",
  ramla:     "ramla",
  labranda:  "labranda",
  odycy:     "sunny_coast",
  excelsior: "excelsior",
  novotel:   "novotel",
  hq:        "hq",
};

function ruleFromDb(ruleType: string, config: Record<string, number> | null): string {
  if (["equal", "sales_ratio", "salary_cost"].includes(ruleType)) return ruleType;
  if (ruleType === "direct") return "equal";
  if (ruleType === "custom_fixed" && config) {
    const nonZero = Object.entries(config).filter(([, v]) => v > 0);
    if (nonZero.length === 1) {
      const [uiKey, pct] = nonZero[0];
      if (pct >= 99.9) return UI_KEY_TO_LOC[uiKey] ?? "equal";
    }
    return `custom:${JSON.stringify(config)}`;
  }
  return "equal";
}

// Loads the SPA CoA mapping from Supabase. Returns the mapping on success;
// returns null only for the LEGITIMATE empty case (no rows match the filter).
// Throws on any fetch / network / Supabase failure so the ETL caller can
// retry instead of silently falling back to the hardcoded COA_MAP — a Supabase
// outage masquerading as "no special mapping" would cause CoA splits to use
// stale defaults instead of the user's configured rules.
export async function loadSpaCoaFromSupabase(): Promise<Record<string, [string, string]> | null> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({
    select:       "account_code,ebitda_line,coa_split_rules(rule_type,config)",
    zoho_org:     "eq.spa",
    ebitda_line:  "not.is.null",
    split_rule_id: "not.is.null",
  });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) {
    throw new Error(`loadSpaCoaFromSupabase: HTTP ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json() as Record<string, unknown>[];
  if (!data.length) return null;

  const result: Record<string, [string, string]> = {};
  for (const row of data) {
    const code = String(row.account_code ?? "").trim();
    const line = row.ebitda_line as string;
    if (line === "excluded") continue;
    const ruleObj = (row.coa_split_rules ?? {}) as Record<string, unknown>;
    const ruleStr = ruleFromDb(
      String(ruleObj.rule_type ?? "equal"),
      (ruleObj.config as Record<string, number>) ?? null,
    );
    result[code] = [ruleStr, line];
  }
  return Object.keys(result).length ? result : null;
}

// ── Name-based helpers ────────────────────────────────────────────────────────

const LOC_KEYWORDS: [string[], string][] = [
  [["intercontinental", " inter "], "intercontinental"],
  [["hugos", "hugo's", "hugo "],    "hugos"],
  [["hyatt"],                        "hyatt"],
  [["ramla"],                        "ramla"],
  [["labranda"],                     "labranda"],
  [["seashell", "qawra", "sunny", "odycy"], "sunny_coast"],
  [["excelsior"],                    "excelsior"],
  [["novotel"],                      "novotel"],
];

export function detectLocation(name: string): string | null {
  const low = ` ${name.toLowerCase()} `;
  for (const [keywords, key] of LOC_KEYWORDS) {
    if (keywords.some(kw => low.includes(kw))) return key;
  }
  return null;
}

export function detectLineFromName(name: string, section: string): string {
  const low = name.toLowerCase();
  if (section === "income") return "revenue";
  if (/salary|salaries|wage|overtime|bonus|ni |paye|payroll/.test(low)) return "wages";
  if (/rent|lease/.test(low)) return "rent";
  if (/electric|water|utility|wifi|telephon|mobile|internet/.test(low)) return "utilities";
  if (/marketing|advertis|digital|print|influenc/.test(low)) return "advertising";
  if (section === "cogs" || section === "cost_of_goods_sold") return "cogs";
  return "sga";
}

// ── Distribution ──────────────────────────────────────────────────────────────

type LocMap = Record<number, number>;

function emptyLocTotals(): LocMap {
  return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, 0]));
}

function distribute(
  rule: string,
  amount: number,
  locRevenue: LocMap,
  totalRevenue: number,
  locSalary: LocMap,
  totalSalary: number,
): LocMap {
  if (rule in LOCATION_MAP) {
    const res = emptyLocTotals();
    res[LOCATION_MAP[rule]] = amount;
    return res;
  }
  if (rule === "equal") {
    return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount / 8]));
  }
  if (rule === "sales_ratio") {
    const denom = totalRevenue || 1;
    return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount * (locRevenue[id] ?? 0) / denom]));
  }
  if (rule === "salary_cost") {
    const denom = totalSalary || 1;
    return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount * (locSalary[id] ?? 0) / denom]));
  }
  if (rule.startsWith("custom:")) {
    const config: Record<string, number> = JSON.parse(rule.slice(7));
    const res = emptyLocTotals();
    const totalPct = Object.values(config).reduce((a, b) => a + b, 0) || 100;
    for (const [uiKey, pct] of Object.entries(config)) {
      const locKey = UI_KEY_TO_LOC[uiKey];
      if (locKey && locKey in LOCATION_MAP) {
        res[LOCATION_MAP[locKey]] += amount * (pct / totalPct);
      }
    }
    return res;
  }
  return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount / 8]));
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function lastDay(year: number, month: number): string {
  return new Date(year, month, 0).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

// ── Idempotency check ─────────────────────────────────────────────────────────

async function monthAlreadySynced(monthKey: string): Promise<boolean> {
  try {
    const rows = await select("spa_ebitda_monthly", { month: monthKey });
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ── Core month runner ─────────────────────────────────────────────────────────

export async function runSpaEbitdaMonth(
  client: ZohoBooksClient,
  year: number,
  month: number,
  opts: {
    force?: boolean;
    coaMap?: Record<string, [string, string]>;
    fromDateOverride?: string;
    toDateOverride?: string;
  } = {},
): Promise<{ rowsUpserted: number; log: string[] }> {
  const log: string[] = [];
  const fromDate = opts.fromDateOverride ?? `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate   = opts.toDateOverride   ?? lastDay(year, month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}-01`;

  const fromD = new Date(fromDate);
  const toD   = new Date(toDate);
  const periodDays = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;

  if (!opts.force && await monthAlreadySynced(monthKey)) {
    log.push(`${monthKey}: cached — skipping`);
    return { rowsUpserted: 0, log };
  }

  const coaMap = opts.coaMap ?? COA_MAP;
  log.push(`${monthKey}: fetching from Zoho Books...`);
  const rawAccounts = await fetchPlAccounts(client, fromDate, toDate);

  if (!rawAccounts.length) {
    log.push(`${monthKey}: no accounts returned from Zoho`);
    return { rowsUpserted: 0, log };
  }

  // ── Step 1: Map every account ─────────────────────────────────────────────
  const BASE_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);
  const mapped: [string, string, number][] = [];  // [rule, line, amount]

  for (const acc of rawAccounts) {
    if (acc.amount === 0) continue;
    if (acc.section === "other_income" && !(acc.code in coaMap)) continue;

    let configuredRule: string;
    let line: string;

    if (acc.code in coaMap) {
      [configuredRule, line] = coaMap[acc.code];
    } else if (acc.section === "income") {
      configuredRule = "sales_ratio";
      line = "revenue";
    } else {
      configuredRule = "equal";
      line = detectLineFromName(acc.name, acc.section);
    }

    // Normalise granular sga_* sub-categories → sga bucket
    if (line.startsWith("sga_")) line = "sga";
    const loc  = detectLocation(acc.name);
    const rule = loc ?? configuredRule;
    if (rule === "hq") continue; // routed to HQ EBITDA via HQ ETL, excluded from venue distribution
    if (!BASE_LINES.has(line)) continue;
    mapped.push([rule, line, acc.amount]);
  }

  // ── Step 2: Build revenue & salary bases ──────────────────────────────────
  const locRevenue = emptyLocTotals();
  for (const [rule, line, amount] of mapped) {
    if (line === "revenue" && rule in LOCATION_MAP) {
      locRevenue[LOCATION_MAP[rule]] += amount;
    }
  }

  const locSalary = emptyLocTotals();
  for (const acc of rawAccounts) {
    if (acc.code in SALARY_RATIO_ACCOUNTS) {
      locSalary[SALARY_RATIO_ACCOUNTS[acc.code]] += acc.amount;
    }
  }

  const totalRevenue = Math.max(Object.values(locRevenue).reduce((a, b) => a + b, 0), 1);
  const totalSalary  = Math.max(Object.values(locSalary).reduce((a, b) => a + b, 0), 1);

  // ── Step 3: Distribute all amounts ────────────────────────────────────────
  const totals: Record<number, Record<string, number>> = {};
  for (const id of ALL_LOCATION_IDS) {
    totals[id] = { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 };
  }
  for (const [rule, line, amount] of mapped) {
    const dist = distribute(rule, amount, locRevenue, totalRevenue, locSalary, totalSalary);
    for (const [locId, share] of Object.entries(dist)) {
      totals[Number(locId)][line] += share;
    }
  }

  // Track laundry separately for fallback
  const laundryTotals = emptyLocTotals();
  for (const acc of rawAccounts) {
    if (LAUNDRY_ACCOUNTS.has(acc.code) && acc.code in coaMap) {
      const [ruleL] = coaMap[acc.code];
      const locL = detectLocation(acc.name);
      const effectiveRule = locL ?? ruleL;
      const dist = distribute(effectiveRule, acc.amount, locRevenue, totalRevenue, locSalary, totalSalary);
      for (const [locId, share] of Object.entries(dist)) {
        laundryTotals[Number(locId)] += share;
      }
    }
  }

  // ── Step 3c: Wage fallback ────────────────────────────────────────────────
  const WAGE_ZERO_THRESHOLD = 100;
  const WAGE_LOW_FRACTION   = 0.35;
  const totalZohoWages = ALL_LOCATION_IDS.reduce((s, id) => s + totals[id].wages, 0);
  const [prevY, prevM] = prevMonth(year, month);
  const prevKey  = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const prevDays = daysInMonth(prevY, prevM);

  try {
    const prevEbitda   = await select("spa_ebitda_monthly", { month: prevKey });
    const prevSuppRows = await select("salary_supplement_monthly", { month: prevKey, is_frozen: "true" });

    const prevSuppByLoc: Record<number, number> = Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, 0]));
    let centrePrev = 0;
    for (const sr of prevSuppRows) {
      const slug = sr.spa_slug as string;
      const amt  = Number(sr.amount ?? 0);
      if (slug in SUPP_SLUG_TO_LOC) prevSuppByLoc[SUPP_SLUG_TO_LOC[slug]] += amt;
      else if (slug === "hq") centrePrev += amt;
    }
    if (centrePrev > 0 && totalSalary > 0) {
      for (const id of ALL_LOCATION_IDS) prevSuppByLoc[id] += centrePrev * locSalary[id] / totalSalary;
    } else if (centrePrev > 0) {
      for (const id of ALL_LOCATION_IDS) prevSuppByLoc[id] += centrePrev / ALL_LOCATION_IDS.length;
    }

    const prevZohoWagesByLoc: Record<number, number> = {};
    let prevTotalZohoWages = 0;
    for (const pr of prevEbitda) {
      const locId = Number(pr.location_id);
      if (locId in totals) {
        const w = Math.max(0, Number(pr.wages ?? 0) - (prevSuppByLoc[locId] ?? 0));
        prevZohoWagesByLoc[locId] = w;
        prevTotalZohoWages += w;
      }
    }

    const useFallback =
      totalZohoWages < WAGE_ZERO_THRESHOLD ||
      (prevTotalZohoWages > 0 && totalZohoWages < prevTotalZohoWages * WAGE_LOW_FRACTION);

    if (useFallback && prevEbitda.length) {
      for (const id of ALL_LOCATION_IDS) {
        const w = prevZohoWagesByLoc[id] ?? 0;
        totals[id].wages = (w / prevDays) * periodDays;
      }
      log.push(`Wages fallback: Zoho €${totalZohoWages.toFixed(0)} < ${WAGE_LOW_FRACTION * 100}% of ${prevKey} €${prevTotalZohoWages.toFixed(0)} — using ${prevKey} prorated ${periodDays}/${prevDays} days`);
    }
  } catch (e) {
    log.push(`Warning: wage fallback failed: ${e}`);
  }

  // ── Step 3d: Rent fallback ────────────────────────────────────────────────
  const RENT_ZERO_THRESHOLD = 1;
  const monthDays = daysInMonth(year, month);
  const prevRentByLoc: Record<number, number> = {};
  try {
    const prevRows = await select("spa_ebitda_monthly", { month: prevKey });
    for (const pr of prevRows) {
      const locId = Number(pr.location_id);
      if (locId in totals) prevRentByLoc[locId] = Number(pr.rent ?? 0);
    }
  } catch (e) {
    log.push(`Warning: could not load previous month rent: ${e}`);
  }

  let fallbackCount = 0, benchmarkCount = 0;
  for (const id of ALL_LOCATION_IDS) {
    const currentRent = totals[id].rent;
    const prevRent    = prevRentByLoc[id] ?? 0;
    const benchmark   = BENCHMARK_RENT_MONTHLY[id] ?? 0;

    if (currentRent < RENT_ZERO_THRESHOLD && prevRent > 0) {
      totals[id].rent = (prevRent / prevDays) * periodDays;
      fallbackCount++;
    } else if (currentRent < RENT_ZERO_THRESHOLD && prevRent <= 0 && benchmark > 0) {
      totals[id].rent = (benchmark / monthDays) * periodDays;
      benchmarkCount++;
    } else if (currentRent >= RENT_ZERO_THRESHOLD && periodDays < monthDays) {
      totals[id].rent = (currentRent / monthDays) * periodDays;
    }
  }
  if (fallbackCount) log.push(`Rent fallback: ${fallbackCount} locations used ${prevKey} prorated ${periodDays}/${prevDays} days`);
  if (benchmarkCount) log.push(`Rent benchmark: ${benchmarkCount} locations used hardcoded benchmark`);

  // ── Step 3e: Laundry fallback ─────────────────────────────────────────────
  const LAUNDRY_ZERO_THRESHOLD = 10;
  const LAUNDRY_LOW_FRACTION   = 0.35;
  const totalZohoLaundry = Object.values(laundryTotals).reduce((a, b) => a + b, 0);
  try {
    const prevLaundryRows = await select("spa_ebitda_monthly", { month: prevKey });
    const prevLaundryByLoc: Record<number, number> = {};
    let prevTotalLaundry = 0;
    for (const pr of prevLaundryRows) {
      const locId = Number(pr.location_id);
      if (locId in totals) {
        const l = Number(pr.laundry ?? 0);
        prevLaundryByLoc[locId] = l;
        prevTotalLaundry += l;
      }
    }
    const useLaundryFallback =
      totalZohoLaundry < LAUNDRY_ZERO_THRESHOLD ||
      (prevTotalLaundry > 0 && totalZohoLaundry < prevTotalLaundry * LAUNDRY_LOW_FRACTION);

    if (useLaundryFallback && prevTotalLaundry > 0) {
      for (const id of ALL_LOCATION_IDS) {
        const fallbackL = (prevLaundryByLoc[id] ?? 0) / prevDays * periodDays;
        const delta     = fallbackL - laundryTotals[id];
        totals[id].sga += delta;
        laundryTotals[id] = fallbackL;
      }
      log.push(`Laundry fallback: Zoho €${totalZohoLaundry.toFixed(0)} < ${LAUNDRY_LOW_FRACTION * 100}% of ${prevKey} — using ${prevKey} prorated`);
    }
  } catch (e) {
    log.push(`Warning: laundry fallback failed: ${e}`);
  }

  // ── Step 3b: Salary supplement ────────────────────────────────────────────
  try {
    let suppRows = await select("salary_supplement_monthly", { month: monthKey, is_frozen: "true" });
    let suppDays = monthDays;
    if (!suppRows.length) {
      const [py, pm] = prevMonth(year, month);
      const pk = `${py}-${String(pm).padStart(2, "0")}-01`;
      suppRows = await select("salary_supplement_monthly", { month: pk, is_frozen: "true" });
      suppDays = daysInMonth(py, pm);
      if (suppRows.length) log.push(`Supplement: no frozen data for ${monthKey}, using ${pk}`);
    }
    if (suppRows.length) {
      let centreSupplement = 0;
      let assignedCount    = 0;
      for (const sr of suppRows) {
        const slug = sr.spa_slug as string;
        if (!slug) continue;
        const prorated = Number(sr.amount ?? 0) / suppDays * periodDays;
        if (slug in SUPP_SLUG_TO_LOC) {
          totals[SUPP_SLUG_TO_LOC[slug]].wages += prorated;
          assignedCount++;
        } else if (slug === "hq") {
          centreSupplement += prorated;
          assignedCount++;
        }
      }
      if (centreSupplement > 0 && totalSalary > 0) {
        for (const id of ALL_LOCATION_IDS) {
          totals[id].wages += centreSupplement * locSalary[id] / totalSalary;
        }
      } else if (centreSupplement > 0) {
        for (const id of ALL_LOCATION_IDS) {
          totals[id].wages += centreSupplement / ALL_LOCATION_IDS.length;
        }
      }
      log.push(`Supplement: ${assignedCount} rows added to wages (${periodDays}/${suppDays} day proration)`);
    }
  } catch (e) {
    log.push(`Warning: could not load salary supplement: ${e}`);
  }

  // ── Step 4: Upsert ────────────────────────────────────────────────────────
  const nowTs = new Date().toISOString();
  const rows  = ALL_LOCATION_IDS.map(id => {
    const d = totals[id];
    return {
      month:          monthKey,
      location_id:    id,
      revenue:        +d.revenue.toFixed(2),
      cogs:           +d.cogs.toFixed(2),
      wages:          +d.wages.toFixed(2),
      advertising:    +d.advertising.toFixed(2),
      rent:           +d.rent.toFixed(2),
      utilities:      +d.utilities.toFixed(2),
      sga:            +d.sga.toFixed(2),
      laundry:        +(laundryTotals[id] ?? 0).toFixed(2),
      total:          +(d.revenue - d.cogs - d.wages - d.advertising - d.rent - d.utilities - d.sga).toFixed(2),
      zoho_synced_at: nowTs,
    };
  });

  const n = await upsert("spa_ebitda_monthly", rows as Record<string, unknown>[], "month,location_id");
  log.push(`${monthKey}: ${n} rows upserted`);
  return { rowsUpserted: n, log };
}
