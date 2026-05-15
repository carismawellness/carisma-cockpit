import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { fetchPlAccounts } from "./zoho-pl-parser";

const DEPTS = ["aesthetics", "slimming"] as const;
type Dept = (typeof DEPTS)[number];

// ── Department keyword detection ──────────────────────────────────────────────

const DEPT_KEYWORDS: [string[], Dept][] = [
  [["aesthetics", "aesthetic", " aest ", "clinic"], "aesthetics"],
  [["slimming", "slim", "weight loss", "weight-loss"],  "slimming"],
];

function detectDept(name: string): Dept | null {
  const low = ` ${name.toLowerCase()} `;
  for (const [keywords, dept] of DEPT_KEYWORDS) {
    if (keywords.some(kw => low.includes(kw))) return dept;
  }
  return null;
}

// ── Benchmark rent ────────────────────────────────────────────────────────────

const BENCHMARK_RENT: Record<Dept, number> = {
  aesthetics: 0,
  slimming:   0,
};
const RENT_ZERO_THRESHOLD = 1;

// ── Name-based EBITDA line detection ─────────────────────────────────────────

function detectLine(name: string, section: string): string {
  const low = name.toLowerCase();
  if (section === "income") return "revenue";
  if (/salary|salaries|wage|overtime|bonus|national insurance|ni |payroll|sick pay/.test(low)) return "wages";
  if (/rent|lease/.test(low)) return "rent";
  if (/electric|water|internet|broadband|telephone|mobile|utility|wifi/.test(low)) return "utilities";
  if (/advertis|marketing|digital|social media|meta ads|google ads|influenc/.test(low)) return "advertising";
  if (section === "cogs" || section === "cost_of_goods_sold") return "cogs";
  return "sga";
}

// ── CoA map loader ────────────────────────────────────────────────────────────

export async function loadAestheticsCoaMap(): Promise<Record<string, [string, string]>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({
    select:        "account_code,ebitda_line,coa_split_rules(rule_type,config)",
    zoho_org:      "eq.aesthetics",
    ebitda_line:   "not.is.null",
    split_rule_id: "not.is.null",
  });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to load aesthetics CoA: ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>[];

  const result: Record<string, [string, string]> = {};
  for (const row of data) {
    const code = String(row.account_code ?? "").trim();
    const line = row.ebitda_line as string;
    if (line === "excluded") { result[code] = ["excluded", "excluded"]; continue; }
    const ruleObj = (row.coa_split_rules ?? {}) as Record<string, unknown>;
    const rtype   = String(ruleObj.rule_type ?? "equal");
    const config  = ruleObj.config as Record<string, number> | null ?? {};
    let ruleStr: string;
    if (rtype === "direct") ruleStr = "equal";
    else if (["equal", "sales_ratio", "marketing_spend_ratio"].includes(rtype)) ruleStr = rtype;
    else if (rtype === "salary_ratio" || rtype === "salary_cost") ruleStr = "salary_ratio";
    else if (rtype === "custom_fixed") ruleStr = `custom:${JSON.stringify(config)}`;
    else ruleStr = "equal";
    result[code] = [ruleStr, line];
  }
  return result;
}

// ── Marketing spend ratio (Growth Sheet) ─────────────────────────────────────

const GROWTH_SHEET_ID  = "1JGlBdii7Zu25yha0zrmi72PPH1BFZRdVeGvcig3r6GE";
const GROWTH_SHEET_GID = "335421089";

async function loadMarketingRatio(fromDate: string, toDate: string): Promise<Record<Dept, number>> {
  const equal = { aesthetics: 0.5, slimming: 0.5 };
  try {
    const sheetId  = process.env.GROWTH_SHEET_ID  ?? GROWTH_SHEET_ID;
    const sheetGid = process.env.GROWTH_SHEET_GID ?? GROWTH_SHEET_GID;
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`;
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return equal;
    const text = await resp.text();
    const rows  = text.split("\n").map(r => r.split(",").map(c => c.replace(/^"|"$/g, "")));
    if (rows.length < 3) return equal;

    const fromD = new Date(fromDate);
    const toD   = new Date(toDate);
    const dateRow = rows[1];
    const relevantCols: number[] = [];
    for (let i = 1; i < dateRow.length; i++) {
      const cell = dateRow[i].trim();
      if (!cell) continue;
      for (const fmt of [
        (s: string) => { const [d, m, y] = s.split("/"); return new Date(`${y}-${m}-${d}`); },
        (s: string) => new Date(s),
      ]) {
        try {
          const d = fmt(cell);
          if (!isNaN(d.getTime())) {
            const weekEnd = new Date(d); weekEnd.setDate(weekEnd.getDate() + 6);
            if (d <= toD && weekEnd >= fromD) { relevantCols.push(i); break; }
          }
        } catch { /* */ }
      }
    }
    if (!relevantCols.length) return equal;

    let currentSection: Dept | null = null;
    const marketingRowIdx: Partial<Record<Dept, number>> = {};
    for (let ri = 0; ri < rows.length; ri++) {
      const label = (rows[ri][0] ?? "").trim();
      if (label.toUpperCase() === "AESTHETICS") currentSection = "aesthetics";
      else if (["SLIMMING", "SLIM", "SLIMMING SECTION"].includes(label.toUpperCase())) currentSection = "slimming";
      else if (currentSection && label.toLowerCase().includes("marketing spend week")) {
        if (!(currentSection in marketingRowIdx)) marketingRowIdx[currentSection] = ri;
      }
    }

    const deptSpend: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
    for (const [dept, ridx] of Object.entries(marketingRowIdx) as [Dept, number][]) {
      const row = rows[ridx];
      for (const ci of relevantCols) {
        if (ci < row.length) {
          const raw = row[ci].trim().replace(/,/g, "").replace(/^[€£$]/g, "");
          deptSpend[dept] += parseFloat(raw) || 0;
        }
      }
    }
    const total = deptSpend.aesthetics + deptSpend.slimming;
    return total > 0 ? { aesthetics: deptSpend.aesthetics / total, slimming: deptSpend.slimming / total } : equal;
  } catch {
    return equal;
  }
}

// ── Salary supplement ─────────────────────────────────────────────────────────

async function loadSalarySupplementAesth(monthKey: string): Promise<Record<Dept, number>> {
  const result: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
  try {
    const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const qs   = new URLSearchParams([
      ["select",   "spa_slug,amount"],
      ["month",    `eq.${monthKey}`],
      ["spa_slug", "in.(aesthetics,slimming)"],
    ]);
    const resp = await fetch(`${base}/rest/v1/salary_supplement_monthly?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (resp.ok) {
      const rows = await resp.json() as Record<string, unknown>[];
      for (const row of rows) {
        const slug = row.spa_slug as Dept;
        if (slug in result) result[slug] += Number(row.amount ?? 0);
      }
    }
  } catch { /* ignore */ }
  return result;
}

// ── Revenue base from Supabase sales tables ───────────────────────────────────

async function loadRevenueBase(fromDate: string, toDate: string): Promise<Record<Dept, number>> {
  const rev: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const tables: [string, Dept][] = [
    ["aesthetics_sales_daily", "aesthetics"],
    ["slimming_sales_daily",   "slimming"],
  ];
  for (const [table, dept] of tables) {
    try {
      const qs   = new URLSearchParams([
        ["select",           "price_ex_vat"],
        ["date_of_service",  `gte.${fromDate}`],
        ["date_of_service",  `lte.${toDate}`],
      ]);
      const resp = await fetch(`${base}/rest/v1/${table}?${qs}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (resp.ok) {
        const rows = await resp.json() as Record<string, unknown>[];
        rev[dept] = rows.reduce((s, r) => s + Number(r.price_ex_vat ?? 0), 0);
      }
    } catch { /* ignore */ }
  }
  return rev;
}

// ── Distribution ──────────────────────────────────────────────────────────────

function distribute(
  rule: string,
  amount: number,
  deptRevenue: Record<Dept, number>,
  totalRevenue: number,
  deptSalary: Record<Dept, number>,
  totalSalary: number,
  deptMarketing: Record<Dept, number> | null,
  totalMarketing: number,
): Record<Dept, number> {
  if (rule === "aesthetics" || rule === "slimming") {
    return { aesthetics: rule === "aesthetics" ? amount : 0, slimming: rule === "slimming" ? amount : 0 };
  }
  if (rule === "sales_ratio") {
    if (totalRevenue > 0) return { aesthetics: amount * deptRevenue.aesthetics / totalRevenue, slimming: amount * deptRevenue.slimming / totalRevenue };
    return { aesthetics: amount / 2, slimming: amount / 2 };
  }
  if (rule === "salary_ratio") {
    if (totalSalary > 0) return { aesthetics: amount * deptSalary.aesthetics / totalSalary, slimming: amount * deptSalary.slimming / totalSalary };
    return { aesthetics: amount / 2, slimming: amount / 2 };
  }
  if (rule === "marketing_spend_ratio" && deptMarketing && totalMarketing > 0) {
    return { aesthetics: amount * (deptMarketing.aesthetics ?? 0) / totalMarketing, slimming: amount * (deptMarketing.slimming ?? 0) / totalMarketing };
  }
  if (rule.startsWith("custom:")) {
    try {
      const cfg: Record<string, number> = JSON.parse(rule.slice(7));
      const total = DEPTS.reduce((s, d) => s + (cfg[d] ?? 0), 0);
      if (total > 0) return { aesthetics: amount * (cfg.aesthetics ?? 0) / total, slimming: amount * (cfg.slimming ?? 0) / total };
    } catch { /* fallthrough */ }
  }
  return { aesthetics: amount / 2, slimming: amount / 2 };
}

// ── Idempotency check ─────────────────────────────────────────────────────────

async function monthAlreadySynced(monthKey: string): Promise<boolean> {
  try { return (await select("aesthetics_ebitda_monthly", { month: monthKey })).length > 0; }
  catch { return false; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function prevMonth(year: number, month: number): [number, number] {
  return month === 1 ? [year - 1, 12] : [year, month - 1];
}

// ── Core month runner ─────────────────────────────────────────────────────────

export async function runAestheticsEbitdaMonth(
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
  const monthDays = daysInMonth(year, month);
  const fromDate  = opts.fromDateOverride ?? `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate    = opts.toDateOverride   ?? `${year}-${String(month).padStart(2, "0")}-${String(monthDays).padStart(2, "0")}`;
  const monthKey  = `${year}-${String(month).padStart(2, "0")}-01`;

  const fromD = new Date(fromDate);
  const toD   = new Date(toDate);
  const periodDays = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;

  if (!opts.force && await monthAlreadySynced(monthKey)) {
    log.push(`${monthKey}: cached — skipping`);
    return { rowsUpserted: 0, log };
  }

  const coaMap = opts.coaMap ?? {};
  log.push(`${monthKey}: fetching from Zoho Books (aesthetics org)...`);
  const rawAccounts = await fetchPlAccounts(client, fromDate, toDate);
  if (!rawAccounts.length) { log.push(`${monthKey}: no accounts returned`); return { rowsUpserted: 0, log }; }

  // ── Step 1: Map every account ─────────────────────────────────────────────
  const BASE_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);
  const mapped: [string, string, number][] = [];

  for (const acc of rawAccounts) {
    if (acc.amount === 0) continue;
    if (acc.section === "other_income" && !(acc.code in coaMap)) continue;

    let configuredRule: string;
    let line: string;

    if (acc.code in coaMap) {
      [configuredRule, line] = coaMap[acc.code];
      if (line === "excluded") continue;
    } else if (acc.section === "income") {
      continue; // unmapped income skipped — revenue comes from sales_daily
    } else {
      configuredRule = "equal";
      line = detectLine(acc.name, acc.section);
    }

    // Normalise granular sga_* sub-categories → sga bucket
    if (line.startsWith("sga_")) line = "sga";
    if (!BASE_LINES.has(line)) continue;
    const dept = detectDept(acc.name);
    const rule = dept ?? configuredRule;
    mapped.push([rule, line, acc.amount]);
  }

  // ── Step 2: Revenue, salary, marketing bases ──────────────────────────────
  const deptRevenue  = await loadRevenueBase(fromDate, toDate);
  const totalRevenue = Math.max(deptRevenue.aesthetics + deptRevenue.slimming, 1);

  const deptSalary: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
  for (const [rule, line, amount] of mapped) {
    if (line === "wages" && (rule === "aesthetics" || rule === "slimming")) deptSalary[rule] += amount;
  }
  const totalSalary = Math.max(deptSalary.aesthetics + deptSalary.slimming, 1);

  const needsMarketing = mapped.some(([rule]) => rule === "marketing_spend_ratio");
  const deptMarketing  = needsMarketing ? await loadMarketingRatio(fromDate, toDate) : null;
  const totalMarketing = deptMarketing ? deptMarketing.aesthetics + deptMarketing.slimming : 1;

  // ── Step 3: Distribute ────────────────────────────────────────────────────
  const totals: Record<Dept, Record<string, number>> = {
    aesthetics: { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 },
    slimming:   { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 },
  };
  for (const [rule, line, amount] of mapped) {
    const dist = distribute(rule, amount, deptRevenue, totalRevenue, deptSalary, totalSalary, deptMarketing, totalMarketing);
    for (const dept of DEPTS) totals[dept][line] += dist[dept];
  }

  // ── Step 4: Rent fallback ─────────────────────────────────────────────────
  const [prevY, prevM] = prevMonth(year, month);
  const prevKey  = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const prevDays = daysInMonth(prevY, prevM);
  const prevRent: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
  try {
    const prevRows = await select("aesthetics_ebitda_monthly", { month: prevKey });
    for (const pr of prevRows) {
      const dept = pr.department as Dept;
      if (DEPTS.includes(dept)) prevRent[dept] = Number(pr.rent ?? 0);
    }
  } catch { /* ignore */ }

  for (const dept of DEPTS) {
    const cur   = totals[dept].rent;
    const prev  = prevRent[dept];
    const bench = BENCHMARK_RENT[dept];
    if (cur < RENT_ZERO_THRESHOLD && prev > 0) totals[dept].rent = prev / prevDays * periodDays;
    else if (cur < RENT_ZERO_THRESHOLD && prev <= 0 && bench > 0) totals[dept].rent = bench / monthDays * periodDays;
    else if (cur >= RENT_ZERO_THRESHOLD && periodDays < monthDays) totals[dept].rent = cur / monthDays * periodDays;
  }

  // ── Step 4b: Salary supplement ────────────────────────────────────────────
  const supplement = await loadSalarySupplementAesth(monthKey);
  for (const dept of DEPTS) {
    if (supplement[dept] > 0) {
      totals[dept].wages += supplement[dept];
      log.push(`Salary supplement [${dept}]: +${supplement[dept].toFixed(2)} added to wages`);
    }
  }

  // ── Step 5: Upsert ────────────────────────────────────────────────────────
  const nowTs = new Date().toISOString();
  const rows  = DEPTS.map(dept => ({
    month:          monthKey,
    department:     dept,
    revenue:        +totals[dept].revenue.toFixed(2),
    cogs:           +totals[dept].cogs.toFixed(2),
    wages:          +totals[dept].wages.toFixed(2),
    advertising:    +totals[dept].advertising.toFixed(2),
    rent:           +totals[dept].rent.toFixed(2),
    utilities:      +totals[dept].utilities.toFixed(2),
    sga:            +totals[dept].sga.toFixed(2),
    zoho_synced_at: nowTs,
  }));

  const n = await upsert("aesthetics_ebitda_monthly", rows as Record<string, unknown>[], "month,department");
  log.push(`${monthKey}: ${n} rows upserted`);
  return { rowsUpserted: n, log };
}
