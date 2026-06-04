import { ZohoBooksClient } from "./zoho-client";
import { upsert, deleteRange } from "./supabase-etl";
import { fetchTransactionLines, TxnLine } from "./zoho-line-extractor";
import {
  COA_MAP,
  LOCATION_MAP,
  detectLocation,
  detectLineFromName,
  loadSpaCoaFromSupabase,
} from "./spa-ebitda";

// Per-line, tag-aware EBITDA ETL for the SPA Zoho org — DAILY granularity.
//
// Writes raw daily rows to spa_ebitda_daily and hq_ebitda_daily (source='spa').
// No fallback logic here — wages / rent / laundry / salary-supplement fallbacks
// are applied at read time in useSpaEbitda / useHqEbitda, proportional to the
// user-selected period. The ETL's job is just to faithfully bucket Zoho line-
// level amounts into (date, venue, ebitda-line) cells via tag → name override
// → CoA rule.

// ── Tag option name → internal slug ─────────────────────────────────────────
const TAG_NAME_TO_SLUG: Record<string, string | null> = {
  excelsior:    "excelsior",
  hq:           "hq",
  hugos:        "hugos",
  hyatt:        "hyatt",
  inter:        "intercontinental",
  labranda:     "labranda",
  novotel:      "novotel",
  ramla:        "ramla",
  "sunny coast": "sunny_coast",
  unallocated:  null,
};

const ALL_LOCATION_IDS = Object.values(LOCATION_MAP);

const VALID_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);

const SALARY_RATIO_ACCOUNTS: Record<string, number> = {
  "30001":  1, "30002":  2, "30003":  3, "30005":  4,
  "30006":  5, "30004":  6, "602221": 7, "602222": 8,
};

const LAUNDRY_ACCOUNTS = new Set(["611514", "611520"]);

// ── Wages reclassification (contacts billed as SGA but treated as wages) ─────
// Contacts billed through professional-fees / consulting accounts that must be
// reported as Wages & Salaries in the EBITDA. They are always tagged to HQ
// so no venue split is needed — the amount flows directly to hq_ebitda_daily.wages.
// Mirror of the same list in zoho-aesthetics-transactions-ebitda.ts and
// zoho-transactions-daily.ts — keep all three in sync.
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
// Substring/token matches — first name or unique brand token is sufficient.
// "upwork" catches "Upwork", "Upwork payments", "Upwork Inc", etc.
const WAGES_RECLASS_FUZZY = ["yamuna", "mandar", "manan", "ruksana", "mellisa", "melissa", "upwork"];

function isWagesReclassContact(contactName: string): boolean {
  if (!contactName) return false;
  if (WAGES_RECLASS_CONTACT_KEYS.has(normalizeContactKey(contactName))) return true;
  const lower = contactName.toLowerCase();
  return WAGES_RECLASS_FUZZY.some(t => lower.includes(t));
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

type LocMap     = Record<number, number>;
type LineTotals = Record<string, number>;

function emptyLocTotals(): LocMap {
  return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, 0]));
}
function emptyLineTotals(): LineTotals {
  return { revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0 };
}
function emptyDayVenueMap(): Record<number, LineTotals> {
  const r: Record<number, LineTotals> = {};
  for (const id of ALL_LOCATION_IDS) r[id] = emptyLineTotals();
  return r;
}

function daysInMonth(year: number, month: number): number { return new Date(year, month, 0).getDate(); }

function normalizeTagName(name: string): string { return name.trim().toLowerCase(); }

function tagsToSlug(tags: TxnLine["tags"]): string | null {
  for (const t of tags) {
    const norm = normalizeTagName(t.tag_option_name);
    if (norm in TAG_NAME_TO_SLUG) return TAG_NAME_TO_SLUG[norm];
  }
  return null;
}

function distribute(
  rule: string,
  amount: number,
  locRevenue: LocMap, totalRevenue: number,
  locSalary: LocMap,  totalSalary: number,
): LocMap {
  if (rule in LOCATION_MAP) {
    const res = emptyLocTotals();
    res[LOCATION_MAP[rule]] = amount;
    return res;
  }
  if (rule === "equal") {
    return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount / ALL_LOCATION_IDS.length]));
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
  return Object.fromEntries(ALL_LOCATION_IDS.map(id => [id, amount / ALL_LOCATION_IDS.length]));
}

// ── Core runner ──────────────────────────────────────────────────────────────

export type SpaRunResult = {
  spaRowsUpserted: number;
  hqRowsUpserted:  number;
  log:             string[];
};

export async function runSpaEbitdaMonthFromTransactions(
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
): Promise<SpaRunResult> {
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
    return { spaRowsUpserted: 0, hqRowsUpserted: 0, log };
  }

  const coaMap = opts.coaMap ?? (await loadSpaCoaFromSupabase()) ?? COA_MAP;

  // ── 2. Per-line CoA lookup + EBITDA line + initial classification ────────
  type Classified = {
    date:         string;
    line:         string;
    sub_line:     string;
    rule:         string;
    tagSlug:      string | null;
    code:         string;
    account_name: string;
    txn_id:       string;
    txn_type:     string;
    contact_name: string;
    amount:       number;
    section:      TxnLine["section"];
  };

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

  const classified: Classified[] = [];
  let droppedExcluded = 0, droppedZero = 0;
  for (const ln of lines) {
    if (ln.amount === 0) { droppedZero++; continue; }

    let rule: string, line: string;
    if (ln.account_code && ln.account_code in coaMap) {
      [rule, line] = coaMap[ln.account_code];
    } else if (ln.section === "income") {
      rule = "sales_ratio"; line = "revenue";
    } else {
      rule = "equal"; line = detectLineFromName(ln.account_name, ln.section);
    }
    if (line.startsWith("sga_")) line = "sga";
    if (line === "excluded") { droppedExcluded++; continue; }
    if (!VALID_LINES.has(line)) { droppedExcluded++; continue; }

    // Contact-based wages override: contractors billed through SGA/professional
    // fees that are employment costs. They are always HQ-tagged, so the amount
    // flows straight to hq_ebitda_daily.wages — no venue split needed.
    if (line === "sga" && isWagesReclassContact(ln.contact_name)) line = "wages";

    const tagSlug = tagsToSlug(ln.tags);
    const nameLoc = tagSlug ? null : detectLocation(ln.account_name);

    classified.push({
      date:         ln.date,
      line,
      sub_line:     resolveSubLine(line, ln.account_name),
      rule:         nameLoc ?? rule,
      tagSlug,
      code:         ln.account_code,
      account_name: ln.account_name,
      txn_id:       ln.txn_id,
      txn_type:     ln.source,
      contact_name: ln.contact_name,
      amount:       ln.amount,
      section:      ln.section,
    });
  }

  if (droppedExcluded || droppedZero) {
    log.push(`${monthKey}: classify: ${classified.length} kept; dropped ${droppedExcluded} excluded, ${droppedZero} zero`);
  }

  // ── 3. Bases for sales_ratio / salary_cost splits (computed once, full window) ──
  const locRevenue = emptyLocTotals();
  for (const c of classified) {
    if (c.line !== "revenue") continue;
    let slug: string | null = null;
    if (c.tagSlug && c.tagSlug !== "hq") slug = c.tagSlug;
    else if (c.tagSlug === "hq") continue;
    else if (c.rule in LOCATION_MAP) slug = c.rule;
    if (slug && slug in LOCATION_MAP) locRevenue[LOCATION_MAP[slug]] += c.amount;
  }
  const totalRevenue = Math.max(Object.values(locRevenue).reduce((a, b) => a + b, 0), 1);

  const locSalary = emptyLocTotals();
  for (const c of classified) {
    if (c.code in SALARY_RATIO_ACCOUNTS) locSalary[SALARY_RATIO_ACCOUNTS[c.code]] += c.amount;
  }
  const totalSalary = Math.max(Object.values(locSalary).reduce((a, b) => a + b, 0), 1);

  // ── 4. Allocate every line to (date, venue, ebitda-line) buckets ─────────
  const dailyVenue:   Map<string, Record<number, LineTotals>> = new Map();
  const dailyHq:      Map<string, LineTotals>                 = new Map();
  const dailyLaundry: Map<string, LocMap>                     = new Map();

  function dayBuckets(date: string) {
    if (!dailyVenue.has(date))   dailyVenue.set(date, emptyDayVenueMap());
    if (!dailyHq.has(date))      dailyHq.set(date, emptyLineTotals());
    if (!dailyLaundry.has(date)) dailyLaundry.set(date, emptyLocTotals());
    return { venue: dailyVenue.get(date)!, hq: dailyHq.get(date)!, laundry: dailyLaundry.get(date)! };
  }

  for (const c of classified) {
    const b = dayBuckets(c.date);

    if (c.tagSlug === "hq") {
      b.hq[c.line] += c.amount;
      continue;
    }
    if (c.tagSlug && c.tagSlug in LOCATION_MAP) {
      const id = LOCATION_MAP[c.tagSlug];
      b.venue[id][c.line] += c.amount;
      if (LAUNDRY_ACCOUNTS.has(c.code)) b.laundry[id] += c.amount;
      continue;
    }
    if (c.rule === "hq") {
      b.hq[c.line] += c.amount;
      continue;
    }
    const dist = distribute(c.rule, c.amount, locRevenue, totalRevenue, locSalary, totalSalary);
    for (const [locId, share] of Object.entries(dist)) {
      const id = Number(locId);
      b.venue[id][c.line] += share;
      if (LAUNDRY_ACCOUNTS.has(c.code)) b.laundry[id] += share;
    }
  }

  // ── 5. Upsert SPA venue daily rows + HQ daily rows ────────────────────────
  // Only non-zero rows are written (sparse). To overwrite stale prior-run cells
  // when re-running with force=true, the caller should clear the window first;
  // for now the route's force-clear is left to a separate code path.
  const nowTs = new Date().toISOString();

  const spaRows: Record<string, unknown>[] = [];
  for (const [date, venueT] of dailyVenue) {
    const lndT = dailyLaundry.get(date) ?? emptyLocTotals();
    for (const id of ALL_LOCATION_IDS) {
      const d = venueT[id];
      const lnd = lndT[id] ?? 0;
      const any = d.revenue || d.cogs || d.wages || d.advertising || d.rent || d.utilities || d.sga || lnd;
      if (!any) continue;
      spaRows.push({
        date,
        location_id:    id,
        revenue:        +d.revenue.toFixed(2),
        cogs:           +d.cogs.toFixed(2),
        wages:          +d.wages.toFixed(2),
        advertising:    +d.advertising.toFixed(2),
        rent:           +d.rent.toFixed(2),
        utilities:      +d.utilities.toFixed(2),
        sga:            +d.sga.toFixed(2),
        laundry:        +lnd.toFixed(2),
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
      source:         "spa",
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

  const spaCount = await upsert("spa_ebitda_daily", spaRows, "date,location_id");
  const hqCount  = await upsert("hq_ebitda_daily",  hqRows,  "date,source");

  // ── 6. Write raw transaction lines for contact-level drill-down ───────────
  await deleteRange("transactions_raw", [["org", "eq.spa"], ["date", `gte.${fromDate}`], ["date", `lte.${toDate}`]]);
  // Deduplicate by (txn_id, account_code, contact_name, ebitda_line) — sum amounts
  // for rows that share the same key (e.g. same employee on two lines of same account).
  const rawMap = new Map<string, Record<string, unknown>>();
  for (const c of classified) {
    const key = `${c.txn_id}|${c.code}|${c.contact_name}|${c.line}`;
    const existing = rawMap.get(key);
    if (existing) {
      existing.amount = +((existing.amount as number) + c.amount).toFixed(2);
    } else {
      rawMap.set(key, {
        org: "spa", txn_id: c.txn_id, date: c.date,
        ebitda_line: c.line, ebitda_sub_line: c.sub_line,
        account_code: c.code, account_name: c.account_name,
        contact_name: c.contact_name, transaction_type: c.txn_type,
        amount: +c.amount.toFixed(2), synced_at: nowTs,
      });
    }
  }
  const rawRows = Array.from(rawMap.values());
  const rawCount = await upsert("transactions_raw", rawRows, "org,txn_id,account_code,contact_name,ebitda_line");

  log.push(`${monthKey}: ${spaCount} spa daily row(s) + ${hqCount} hq daily row(s) + ${rawCount} raw line(s) upserted`);
  return { spaRowsUpserted: spaCount, hqRowsUpserted: hqCount, log };
}
