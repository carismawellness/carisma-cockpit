import { ZohoBooksClient } from "./zoho-client";
import { upsert, deleteRange } from "./supabase-etl";
import { fetchTransactionLines, TxnLine } from "./zoho-line-extractor";
import { loadAestheticsCoaMap } from "./aesthetics-ebitda";

// Per-line, tag-aware EBITDA ETL for the Aesthetics Zoho org — DAILY granularity.
//
// Writes raw daily rows to aesthetics_ebitda_daily (per date, dept). HQ-tagged
// (custom_fixed {"hq":100}) lines route to hq_ebitda_daily with source='aesthetics'.
// No fallback logic here — rent / supplement / wage fallbacks are applied at
// read time in useAestheticsEbitda, period-aware.

const DEPTS = ["aesthetics", "slimming"] as const;
type Dept = (typeof DEPTS)[number];

const TAG_NAME_TO_DEPT: Record<string, Dept> = {
  "carisma aesthetics": "aesthetics",
  "carisma slimming":   "slimming",
  "aesthetics":         "aesthetics",
  "slimming":           "slimming",
};

const DEPT_KEYWORDS: [string[], Dept][] = [
  [["aesthetics", "aesthetic", " aest ", "clinic"],  "aesthetics"],
  [["slimming", "slim ", "weight loss", "weight-loss"], "slimming"],
];

function detectDept(name: string): Dept | null {
  const low = ` ${name.toLowerCase()} `;
  for (const [keywords, dept] of DEPT_KEYWORDS) {
    if (keywords.some(kw => low.includes(kw))) return dept;
  }
  return null;
}

function tagsToDept(tags: TxnLine["tags"]): Dept | null {
  for (const t of tags) {
    const norm = t.tag_option_name.trim().toLowerCase();
    if (norm in TAG_NAME_TO_DEPT) return TAG_NAME_TO_DEPT[norm];
  }
  return null;
}

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

// ── Wages reclassification contacts ──────────────────────────────────────────
// Specific Aesthetics-org practitioners/contacts whose payments must roll up to
// Wages & Salaries regardless of which Chart-of-Account they were booked to in
// Zoho. Department still follows the line tag (Aesthetics / Slimming) and
// defaults to Aesthetics when untagged. Only non-excluded P&L lines are
// reclassified (excluded accounts are dropped before this runs). Exact
// full-name match, case / punctuation / whitespace-insensitive. Mirror of the
// same list in zoho-transactions-daily.ts — keep both in sync.
function normalizeContactKey(name: string): string {
  return name.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

const WAGES_RECLASS_CONTACT_KEYS: Set<string> = new Set(
  [
    "Dr. Walter",
    "FRANCESCA CHIRCOP",
    "Giovanni Scornavacca",
    "Dr Zaid Teebi",
    "Ivana Boskovic Stamenkovic",
  ].map(normalizeContactKey),
);

// Contacts where a substring/token match is sufficient (first name, or a
// name token that is unique enough). "upwork" catches "Upwork", "Upwork
// payments", "Upwork Inc", etc.  All matched case-insensitively.
const WAGES_RECLASS_FUZZY = ["yamuna", "mandar", "manan", "ruksana", "mellisa", "melissa", "upwork"];

function isWagesReclassContact(contactName: string): boolean {
  if (!contactName) return false;
  if (WAGES_RECLASS_CONTACT_KEYS.has(normalizeContactKey(contactName))) return true;
  const lower = contactName.toLowerCase();
  return WAGES_RECLASS_FUZZY.some(t => lower.includes(t));
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
    const rows = text.split("\n").map(r => r.split(",").map(c => c.replace(/^"|"$/g, "")));
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
      const qs = new URLSearchParams([
        ["select",          "price_ex_vat"],
        ["date_of_service", `gte.${fromDate}`],
        ["date_of_service", `lte.${toDate}`],
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

function distribute(
  rule: string,
  amount: number,
  deptRevenue: Record<Dept, number>, totalRevenue: number,
  deptSalary: Record<Dept, number>,  totalSalary: number,
  deptMarketing: Record<Dept, number> | null, totalMarketing: number,
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

function isHqOnlyRule(rule: string): boolean {
  if (!rule.startsWith("custom:")) return false;
  try {
    const cfg: Record<string, number> = JSON.parse(rule.slice(7));
    const nonZero = Object.entries(cfg).filter(([, v]) => v > 0);
    return nonZero.length === 1 && nonZero[0][0] === "hq";
  } catch { return false; }
}

// ── Core runner ────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number): number { return new Date(year, month, 0).getDate(); }

export type AesthRunResult = { rowsUpserted: number; log: string[] };

export async function runAestheticsEbitdaMonthFromTransactions(
  client: ZohoBooksClient,
  year: number,
  month: number,
  opts: {
    force?:            boolean;
    coaMap?:           Record<string, [string, string]>;
    fromDateOverride?: string;
    toDateOverride?:   string;
    preLoadedLines?:   TxnLine[];
  } = {},
): Promise<AesthRunResult> {
  const log: string[] = [];
  const monthDays = daysInMonth(year, month);
  const fromDate  = opts.fromDateOverride ?? `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate    = opts.toDateOverride   ?? `${year}-${String(month).padStart(2, "0")}-${String(monthDays).padStart(2, "0")}`;
  const monthKey  = `${year}-${String(month).padStart(2, "0")}-01`;

  // ── 1. Pull lines ────────────────────────────────────────────────────────
  let lines: TxnLine[];
  if (opts.preLoadedLines) {
    lines = opts.preLoadedLines.filter(l => l.date >= fromDate && l.date <= toDate);
    log.push(`${monthKey}: using ${lines.length} pre-loaded line(s) in window`);
  } else {
    log.push(`${monthKey}: pulling transactions from Zoho (${fromDate}..${toDate})…`);
    const pull = await fetchTransactionLines(client, fromDate, toDate);
    log.push(...pull.log.map(s => `  ${s}`));
    lines = pull.lines.filter(l => l.date >= fromDate && l.date <= toDate);
  }
  if (!lines.length) {
    log.push(`${monthKey}: no transaction lines in window`);
    return { rowsUpserted: 0, log };
  }

  const coaMap = opts.coaMap ?? (await loadAestheticsCoaMap());

  // ── 2. Per-line classify ─────────────────────────────────────────────────
  const VALID_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);

  function resolveSubLine(line: string, account_name: string): string {
    const low = account_name.toLowerCase();
    if (line === "wages")       return "wages";
    if (line === "cogs")        return "cogs";
    if (line === "rent")        return "rent";
    if (line === "utilities")   return "utilities";
    if (line === "revenue")     return "revenue";
    if (line === "advertising") {
      if (/meta|facebook/.test(low))  return "meta";
      if (/google/.test(low))         return "google";
      if (/klaviyo/.test(low))        return "klaviyo";
      return "misc";
    }
    if (line === "sga") {
      if (/professional|legal|audit|accounting|consultant|advisory/.test(low)) return "prof_services";
      if (/fuel|petrol|diesel|gas station/.test(low))                          return "fuel";
      if (/laundry|linen|uniform/.test(low))                                   return "laundry";
      if (/software|subscription|saas|licen[cs]e|system/.test(low))           return "software";
      if (/clean|hygiene|sanitiz|pest/.test(low))                              return "cleaning";
      if (/travel|transport|flight|hotel|accommodation|taxi|uber|airbnb/.test(low)) return "travel";
      if (/insur/.test(low))                                                   return "insurance";
      if (/event|function|catering|hospitality/.test(low))                     return "events";
      if (/maintenance|repair|service contract|fix/.test(low))                 return "maintenance";
      if (/telecom|telephone|mobile|internet|broadband|phone/.test(low))       return "telecom";
      return "misc";
    }
    return line;
  }

  type Classified = {
    date:         string;
    line:         string;
    sub_line:     string;
    rule:         string;
    tagDept:      Dept | null;
    nameDept:     Dept | null;
    code:         string;
    account_name: string;
    txn_id:       string;
    txn_type:     string;
    contact_name: string;
    amount:       number;
    isHq:         boolean;
    reclass:      boolean;
    section:      TxnLine["section"];
  };

  const classified: Classified[] = [];
  let droppedExcluded = 0, droppedZero = 0;
  for (const ln of lines) {
    if (ln.amount === 0) { droppedZero++; continue; }

    let rule: string, line: string;
    if (ln.account_code && ln.account_code in coaMap) {
      [rule, line] = coaMap[ln.account_code];
      if (line === "excluded") { droppedExcluded++; continue; }
    } else if (ln.section === "income") {
      // unmapped income skipped — revenue comes from sales_daily, not Zoho
      continue;
    } else {
      rule = "equal"; line = detectLine(ln.account_name, ln.section);
    }
    if (line.startsWith("sga_")) line = "sga";
    if (!VALID_LINES.has(line)) { droppedExcluded++; continue; }

    // Wages reclassification: named contacts roll up to Wages & Salaries
    // regardless of CoA. Never reclassify revenue (these are vendor expenses).
    const reclass = line !== "revenue" && isWagesReclassContact(ln.contact_name);
    if (reclass) line = "wages";

    classified.push({
      date:         ln.date,
      line,
      sub_line:     resolveSubLine(line, ln.account_name),
      rule,
      tagDept:      tagsToDept(ln.tags),
      nameDept:     detectDept(ln.account_name),
      code:         ln.account_code,
      account_name: ln.account_name,
      txn_id:       ln.txn_id,
      txn_type:     ln.source,
      contact_name: ln.contact_name,
      amount:       ln.amount,
      isHq:         isHqOnlyRule(rule),
      reclass,
      section:      ln.section,
    });
  }
  if (droppedExcluded || droppedZero) {
    log.push(`${monthKey}: classify: ${classified.length} kept; dropped ${droppedExcluded} excluded, ${droppedZero} zero`);
  }

  // ── 3. Bases for ratio rules ─────────────────────────────────────────────
  const deptRevenue  = await loadRevenueBase(fromDate, toDate);
  const totalRevenue = Math.max(deptRevenue.aesthetics + deptRevenue.slimming, 1);

  const deptSalary: Record<Dept, number> = { aesthetics: 0, slimming: 0 };
  for (const c of classified) {
    if (c.line !== "wages") continue;
    let dept: Dept | null = null;
    if (c.tagDept) dept = c.tagDept;
    else if (c.reclass) dept = "aesthetics";   // reclassed contacts default to Aesthetics
    else if (c.nameDept) dept = c.nameDept;
    else if (c.rule === "aesthetics" || c.rule === "slimming") dept = c.rule;
    if (dept) deptSalary[dept] += c.amount;
  }
  const totalSalary = Math.max(deptSalary.aesthetics + deptSalary.slimming, 1);

  const needsMarketing = classified.some(c => c.rule === "marketing_spend_ratio");
  const deptMarketing  = needsMarketing ? await loadMarketingRatio(fromDate, toDate) : null;
  const totalMarketing = deptMarketing ? deptMarketing.aesthetics + deptMarketing.slimming : 1;

  // ── 4. Allocate every line to (date, dept, ebitda-line) buckets ─────────
  type LineTotals = Record<string, number>;
  function emptyLineTotals(): LineTotals {
    return { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 };
  }
  function emptyDeptMap(): Record<Dept, LineTotals> {
    return { aesthetics: emptyLineTotals(), slimming: emptyLineTotals() };
  }

  const dailyDept: Map<string, Record<Dept, LineTotals>> = new Map();
  const dailyHq:   Map<string, LineTotals>                = new Map();

  function dayBuckets(date: string) {
    if (!dailyDept.has(date)) dailyDept.set(date, emptyDeptMap());
    if (!dailyHq.has(date))   dailyHq.set(date, emptyLineTotals());
    return { dept: dailyDept.get(date)!, hq: dailyHq.get(date)! };
  }

  for (const c of classified) {
    const b = dayBuckets(c.date);
    // Reclassed contacts → Wages & Salaries under their tagged dept, defaulting
    // to Aesthetics. Routed before the HQ/name/split paths so a doctor's pay
    // never lands in HQ or gets revenue-split across depts.
    if (c.reclass) {
      const dept: Dept = c.tagDept ?? "aesthetics";
      b.dept[dept][c.line] += c.amount;
      continue;
    }
    if (c.isHq) {
      b.hq[c.line] += c.amount;
      continue;
    }
    if (c.tagDept) {
      b.dept[c.tagDept][c.line] += c.amount;
      continue;
    }
    if (c.nameDept) {
      b.dept[c.nameDept][c.line] += c.amount;
      continue;
    }
    if (c.rule === "aesthetics" || c.rule === "slimming") {
      b.dept[c.rule][c.line] += c.amount;
      continue;
    }
    const dist = distribute(c.rule, c.amount, deptRevenue, totalRevenue, deptSalary, totalSalary, deptMarketing, totalMarketing);
    for (const d of DEPTS) b.dept[d][c.line] += dist[d];
  }

  // ── 5. Upsert daily rows ────────────────────────────────────────────────
  const nowTs = new Date().toISOString();
  const deptRows: Record<string, unknown>[] = [];
  for (const [date, deptT] of dailyDept) {
    for (const d of DEPTS) {
      const t = deptT[d];
      const any = t.revenue || t.cogs || t.wages || t.advertising || t.rent || t.utilities || t.sga;
      if (!any) continue;
      deptRows.push({
        date,
        department:     d,
        revenue:        +t.revenue.toFixed(2),
        cogs:           +t.cogs.toFixed(2),
        wages:          +t.wages.toFixed(2),
        advertising:    +t.advertising.toFixed(2),
        rent:           +t.rent.toFixed(2),
        utilities:      +t.utilities.toFixed(2),
        sga:            +t.sga.toFixed(2),
        zoho_synced_at: nowTs,
      });
    }
  }

  const hqRows: Record<string, unknown>[] = [];
  for (const [date, hqT] of dailyHq) {
    const any = hqT.revenue || hqT.cogs || hqT.wages || hqT.advertising || hqT.rent || hqT.utilities || hqT.sga;
    if (!any) continue;
    hqRows.push({
      date,
      source:         "aesthetics",
      revenue:        +hqT.revenue.toFixed(2),
      cogs:           +hqT.cogs.toFixed(2),
      wages:          +hqT.wages.toFixed(2),
      advertising:    +hqT.advertising.toFixed(2),
      rent:           +hqT.rent.toFixed(2),
      utilities:      +hqT.utilities.toFixed(2),
      sga:            +hqT.sga.toFixed(2),
      zoho_synced_at: nowTs,
    });
  }

  const deptCount = await upsert("aesthetics_ebitda_daily", deptRows, "date,department");
  const hqCount   = await upsert("hq_ebitda_daily",         hqRows,   "date,source");

  // ── 6. Write raw transaction lines for contact-level drill-down ───────────
  await deleteRange("transactions_raw", [["org", "eq.aesthetics"], ["date", `gte.${fromDate}`], ["date", `lte.${toDate}`]]);
  const rawMap = new Map<string, Record<string, unknown>>();
  for (const c of classified) {
    const key = `${c.txn_id}|${c.code}|${c.contact_name}|${c.line}`;
    const existing = rawMap.get(key);
    if (existing) {
      existing.amount = +((existing.amount as number) + c.amount).toFixed(2);
    } else {
      rawMap.set(key, {
        org: "aesthetics", txn_id: c.txn_id, date: c.date,
        ebitda_line: c.line, ebitda_sub_line: c.sub_line,
        account_code: c.code, account_name: c.account_name,
        contact_name: c.contact_name, transaction_type: c.txn_type,
        amount: +c.amount.toFixed(2), synced_at: nowTs,
      });
    }
  }
  const rawRows = Array.from(rawMap.values());
  const rawCount = await upsert("transactions_raw", rawRows, "org,txn_id,account_code,contact_name,ebitda_line");

  log.push(`${monthKey}: ${deptCount} aesth daily row(s) + ${hqCount} hq row(s) + ${rawCount} raw line(s) upserted`);
  return { rowsUpserted: deptCount + hqCount, log };
}
