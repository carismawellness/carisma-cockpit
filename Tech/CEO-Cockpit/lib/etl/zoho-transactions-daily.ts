import { ZohoBooksClient } from "./zoho-client";
import { fetchTransactionLines, TxnLine } from "./zoho-line-extractor";
import { COA_MAP, detectLocation, loadSpaCoaFromSupabase } from "./spa-ebitda";
import { loadAestheticsCoaMap } from "./aesthetics-ebitda";
import {
  SLUG_DISPLAY,
  SALARY_RATIO_CODES,
  UI_KEY_TO_SLUG,
  ZOHO_TAG_TO_SLUG,
} from "./zoho-spa-breakdown";
import {
  loadSpaCockpitRevenue,
  loadAesthCockpitRevenue,
  loadSlimCockpitRevenue,
} from "./cockpit-revenue-feeds";
import {
  fetchZohoProfitAndLoss,
  reconcileApiVsPl,
  formatReconcileLog,
  loadExcludedCodes,
  PlReconcileResult,
} from "./zoho-pl-reconcile";

// Daily-granular per (account, allocation-target) pull for the "EBIDA Layer"
// Google Sheet tab. Source: zoho-line-extractor (invoices, bills, expenses,
// creditnotes, vendorcredits, journals) — exposes per-line reporting_tags.
//
// Allocation precedence: line tag wins → account-name keyword override →
// CoA split rule. tag_source = "tagged" only when a usable line tag drove the
// allocation; everything else is "split".

export type DailyRow = {
  brand:           "SPA" | "AES" | "SLIM";
  venue:           string;        // display name (e.g. "Hugos", "AES", "SLIM")
  venue_slug:      string;        // machine slug
  account_name:    string;
  account_code:    string;
  ebitda_category: string;        // revenue / cogs / wages / advertising / rent / utilities / sga
  split_rule:      string;        // raw CoA rule (sales_ratio, equal, hugos, custom:{}, …)
  tag_source:      "tagged" | "split";
  contact:         string;        // Advertising sub-bucket: Meta / Google / Klaviyo / GHL / Misc — empty for non-Advertising rows
  daily:           Record<string, number>;   // YYYY-MM-DD → amount
};

export type DailyResult = {
  rows:           DailyRow[];
  dates:          string[];
  period:         { from_date: string; to_date: string };
  log:            string[];
  // Optional cross-check vs Zoho `reports/profitandloss` for the same window.
  // Visibility-only: never blocks the pull. Absent when reconciliation failed
  // (e.g. P&L endpoint errored) or org wasn't configured for recon.
  reconciliation?: PlReconcileResult;
};

const VALID_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);

const SPA_VENUE_SLUGS = [
  "intercontinental", "hugos", "hyatt", "ramla",
  "labranda", "sunny_coast", "excelsior", "novotel",
];

// Aesthetics-org tag option name → department. Same map the dashboard ETL uses.
const AESTH_TAG_TO_DEPT: Record<string, "aesthetics" | "slimming"> = {
  "carisma aesthetics": "aesthetics",
  "aesthetics":         "aesthetics",
  "carisma slimming":   "slimming",
  "slimming":           "slimming",
};

const AESTH_DEPT_KEYWORDS: [string[], "aesthetics" | "slimming"][] = [
  [["aesthetics", "aesthetic", " aest ", "clinic"],     "aesthetics"],
  [["slimming", "slim ", "weight loss", "weight-loss"], "slimming"],
];

function detectAesthDept(name: string): "aesthetics" | "slimming" | null {
  const low = ` ${name.toLowerCase()} `;
  for (const [kws, dept] of AESTH_DEPT_KEYWORDS) {
    if (kws.some(kw => low.includes(kw))) return dept;
  }
  return null;
}

const AESTH_BRAND_DISPLAY: Record<"aesthetics" | "slimming", { brand: "AES" | "SLIM"; venue: string }> = {
  aesthetics: { brand: "AES",  venue: "Aesthetics" },
  slimming:   { brand: "SLIM", venue: "Slimming"   },
};

// ── Advertising contact mapping ─────────────────────────────────────────────
// Maps Zoho vendor / customer names to canonical advertising channel
// buckets (Meta, Google, Klaviyo, GHL, Misc). Loaded once per pull from
// the advertising_contact_mapping Supabase table. Used only for lines
// whose CoA mapping puts them on the "advertising" EBITDA line.

type AdContactMappingEntry = { pattern: string; canonical: string; priority: number };

async function loadAdvertisingContactMapping(): Promise<AdContactMappingEntry[]> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return [];
  try {
    const qs = new URLSearchParams({ select: "pattern,canonical,priority" });
    const resp = await fetch(`${base}/rest/v1/advertising_contact_mapping?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<Record<string, unknown>>;
    return rows
      .map(r => ({
        pattern:   String(r.pattern ?? "").trim().toLowerCase(),
        canonical: String(r.canonical ?? "").trim(),
        priority:  Number(r.priority ?? 100),
      }))
      .filter(r => r.pattern && r.canonical)
      .sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}

function resolveAdvertisingContact(
  contactName: string,
  mapping: AdContactMappingEntry[],
): string {
  if (!contactName) return "Misc";
  const low = contactName.toLowerCase();
  for (const m of mapping) {
    if (low.includes(m.pattern)) return m.canonical;
  }
  return "Misc";
}

// ── Tag resolution ──────────────────────────────────────────────────────────

function spaTagToSlug(tags: TxnLine["tags"]): string | null {
  for (const t of tags) {
    const norm = t.tag_option_name.trim().toLowerCase();
    const slug = ZOHO_TAG_TO_SLUG[norm];
    if (slug) return slug;        // "hq" or one of the 8 venue slugs
  }
  return null;
}

function aesthTagToDept(tags: TxnLine["tags"]): "aesthetics" | "slimming" | null {
  for (const t of tags) {
    const norm = t.tag_option_name.trim().toLowerCase();
    if (norm in AESTH_TAG_TO_DEPT) return AESTH_TAG_TO_DEPT[norm];
  }
  return null;
}

// ── Date helpers ────────────────────────────────────────────────────────────

function enumerateDates(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end   = new Date(`${toDate}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Returns the set of calendar months ("YYYY-MM") touched by the inclusive
// [fromDate, toDate] window, plus the first/last calendar day per month.
// Used by the salary-cost fallback below: when a pull window contains no
// salary postings (e.g. mid-month range on an org where salary books to
// the last calendar day), we widen to the whole month(s) instead.
function monthsCovering(fromDate: string, toDate: string): Array<{ ym: string; start: string; end: string }> {
  const out: Array<{ ym: string; start: string; end: string }> = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end   = new Date(`${toDate}T00:00:00Z`);
  const cur   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const first = new Date(Date.UTC(y, m,     1));
    const last  = new Date(Date.UTC(y, m + 1, 0));
    const ym    = `${y}-${String(m + 1).padStart(2, "0")}`;
    out.push({
      ym,
      start: first.toISOString().slice(0, 10),
      end:   last.toISOString().slice(0, 10),
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

// Zoho `reports/journal` returns dates in "DD Mon YYYY" form — mirror the
// extractor's parser locally so this module stays self-contained.
const JR_MONTH_ABBREV: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseJournalReportDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = JR_MONTH_ABBREV[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

// ── Salary-cost fallback ────────────────────────────────────────────────────
// When the pull window contains no salary postings (e.g. Jan 8-17 in SPA
// where salaries book on the last day of each month), `totalSal` is zero
// and every venue's salPct collapses to 0 — which silently zeroes out any
// line that uses the `salary_cost` split rule. To prevent that data loss
// we widen to the WHOLE calendar month(s) the window touches and re-pull
// salary postings for the SALARY_RATIO_CODES accounts from reports/journal.
//
// Returns updated salBySlug + totalSal. Caller decides whether to also
// fall back to equal split if even the monthly pull returns zero.

async function pullMonthlySalaryBase(
  client:   ZohoBooksClient,
  fromDate: string,
  toDate:   string,
  log:      string[],
): Promise<{ salBySlug: Record<string, number>; total: number; monthsUsed: string[] }> {
  const salBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  const months = monthsCovering(fromDate, toDate);
  const monthsUsed: string[] = [];
  for (const { ym, start, end } of months) {
    monthsUsed.push(ym);
    let page = 1;
    while (true) {
      const params: Record<string, string> = {
        filter_by: "TransactionDate.CustomDate",
        from_date: start,
        to_date:   end,
        per_page:  "200",
        page:      String(page),
      };
      let data: Record<string, unknown>;
      try {
        data = await client.get("reports/journal", params) as Record<string, unknown>;
      } catch (e) {
        log.push(`  WARN salary-fallback reports/journal ${ym} page ${page} failed: ${e}; skipping rest of month`);
        break;
      }
      const entries = (data.journal as Array<Record<string, unknown>>) ?? [];
      for (const j of entries) {
        const rawDate = String(j.date ?? "");
        const iso = parseJournalReportDate(rawDate);
        if (!iso || iso < start || iso > end) continue;   // belt-and-suspenders
        const atRows = (j.account_transactions as Array<Record<string, unknown>>) ?? [];
        for (const at of atRows) {
          const code = String(at.account_code ?? "").trim();
          if (!code) continue;
          const slug = SALARY_RATIO_CODES[code];
          if (!slug || !SPA_VENUE_SLUGS.includes(slug)) continue;
          // Salary accounts are expense-section — debit-positive convention.
          const debit  = Number(at.debit_amount  ?? 0);
          const credit = Number(at.credit_amount ?? 0);
          const signed = debit - credit;
          if (signed === 0) continue;
          salBySlug[slug] += signed;
        }
      }
      const ctx = data.page_context as Record<string, unknown> | undefined;
      if (!ctx?.has_more_page) break;
      page++;
    }
  }
  const total = Object.values(salBySlug).reduce((a, b) => a + b, 0);
  return { salBySlug, total, monthsUsed };
}

// ── SPA venue split (CoA-rule path, untagged lines only) ────────────────────

function spaVenueShares(
  rule: string,
  amount: number,
  revPct: Record<string, number>,
  salPct: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  if (amount === 0) return out;
  if (SPA_VENUE_SLUGS.includes(rule)) { out[rule] = amount; return out; }
  if (rule === "equal") {
    const share = amount / SPA_VENUE_SLUGS.length;
    for (const s of SPA_VENUE_SLUGS) out[s] = share;
    return out;
  }
  if (rule === "sales_ratio") {
    for (const s of SPA_VENUE_SLUGS) out[s] = amount * (revPct[s] ?? 0);
    return out;
  }
  if (rule === "salary_cost" || rule === "salary_ratio") {
    for (const s of SPA_VENUE_SLUGS) out[s] = amount * (salPct[s] ?? 0);
    return out;
  }
  if (rule.startsWith("custom:")) {
    try {
      const config: Record<string, number> = JSON.parse(rule.slice(7));
      const totalPct = Object.values(config).reduce((a, b) => a + b, 0) || 100;
      for (const [key, pct] of Object.entries(config)) {
        const s = UI_KEY_TO_SLUG[key];
        if (s && s in out) out[s] += amount * (pct / totalPct);
      }
      return out;
    } catch { /* fall through to equal */ }
  }
  const share = amount / SPA_VENUE_SLUGS.length;
  for (const s of SPA_VENUE_SLUGS) out[s] = share;
  return out;
}

// ── Aesthetics dept split (CoA-rule path, untagged lines only) ──────────────

function aesthDeptShares(
  rule: string,
  amount: number,
  revPct: Record<"aesthetics" | "slimming", number>,
): Record<"aesthetics" | "slimming", number> {
  const out: Record<"aesthetics" | "slimming", number> = { aesthetics: 0, slimming: 0 };
  if (amount === 0) return out;
  if (rule === "aesthetics" || rule === "slimming") { out[rule] = amount; return out; }
  if (rule === "equal") { out.aesthetics = amount / 2; out.slimming = amount / 2; return out; }
  if (rule === "sales_ratio" || rule === "marketing_spend_ratio") {
    out.aesthetics = amount * revPct.aesthetics;
    out.slimming   = amount * revPct.slimming;
    return out;
  }
  if (rule === "salary_ratio" || rule === "salary_cost") {
    // No separate dept-salary base on the sheet pull — fall back to revenue.
    out.aesthetics = amount * revPct.aesthetics;
    out.slimming   = amount * revPct.slimming;
    return out;
  }
  if (rule.startsWith("custom:")) {
    try {
      const cfg = JSON.parse(rule.slice(7)) as Record<string, number>;
      const total = (cfg.aesthetics ?? 0) + (cfg.slimming ?? 0);
      if (total > 0) {
        out.aesthetics = amount * (cfg.aesthetics ?? 0) / total;
        out.slimming   = amount * (cfg.slimming   ?? 0) / total;
        return out;
      }
    } catch { /* fall through */ }
  }
  out.aesthetics = amount / 2;
  out.slimming   = amount / 2;
  return out;
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function fetchZohoTransactionsDaily(
  client:   ZohoBooksClient,
  fromDate: string,
  toDate:   string,
  org:      "spa" | "aesthetics",
): Promise<DailyResult> {
  const period = { from_date: fromDate, to_date: toDate };
  const dates  = enumerateDates(fromDate, toDate);
  const log: string[] = [];

  // 1. Pull all transaction lines from the 6 detail endpoints
  log.push(`[${org}] pulling transaction lines ${fromDate} → ${toDate}…`);
  const pull = await fetchTransactionLines(client, fromDate, toDate);
  log.push(...pull.log.map(s => `  ${s}`));
  const lines = pull.lines.filter(l => l.date >= fromDate && l.date <= toDate);
  log.push(`  filtered to window: ${lines.length} line(s)`);

  // NOTE: we no longer early-return on empty `lines`. Cockpit-side revenue
  // (Lapis for SPA, Supabase POS tables for AES/SLIM) still needs to flow
  // into the EBIDA Layer sheet even when Zoho returns nothing for the window.

  if (org === "spa") return buildSpaRows(client, lines, dates, period, log, fromDate, toDate);
  return buildAesthRows(client, lines, dates, period, log, fromDate, toDate);
}

// ── P&L reconciliation helper ───────────────────────────────────────────────
// Visibility-only cross-check. Never throws — any failure is logged and
// returned as `undefined` so the caller can safely skip the recon block.

async function runReconciliation(
  client:   ZohoBooksClient,
  org:      "spa" | "aesthetics",
  rows:     DailyRow[],
  fromDate: string,
  toDate:   string,
  log:      string[],
): Promise<PlReconcileResult | undefined> {
  try {
    log.push(`Running P&L reconciliation for ${org} ${fromDate} → ${toDate}…`);
    const [pl, excluded] = await Promise.all([
      fetchZohoProfitAndLoss(client, fromDate, toDate),
      loadExcludedCodes(org),
    ]);
    log.push(`  P&L accounts: ${pl.size}; excluded-by-design codes: ${excluded.size}`);
    const recon = reconcileApiVsPl(rows, pl, excluded);
    log.push(...formatReconcileLog(recon, org, fromDate, toDate));
    return recon;
  } catch (e) {
    log.push(`  WARN P&L reconciliation failed: ${e}; continuing without recon block`);
    return undefined;
  }
}

// ── SPA rows ────────────────────────────────────────────────────────────────

async function buildSpaRows(
  client:   ZohoBooksClient,
  lines:    TxnLine[],
  dates:    string[],
  period:   { from_date: string; to_date: string },
  log:      string[],
  fromDate: string,
  toDate:   string,
): Promise<DailyResult> {
  log.push("Loading SPA CoA mapping + advertising contact mapping + Lapis POS revenue…");
  // Do NOT swallow Lapis fetch failures: a silent fallback to [] would emit
  // gross-of-adjustments revenue and diverge from spa_revenue_monthly. The
  // chunk runner already retries on failure, so propagating the error is
  // safer than silently writing wrong totals to the EBIDA Layer.
  const [coaMapMaybe, adContactMap, lapisRows] = await Promise.all([
    loadSpaCoaFromSupabase(),
    loadAdvertisingContactMapping(),
    loadSpaCockpitRevenue(fromDate, toDate),
  ]);
  const coaMap = coaMapMaybe ?? COA_MAP;
  log.push(`  Lapis rows fetched: ${lapisRows.length}`);
  log.push(`  advertising contact patterns loaded: ${adContactMap.length}`);

  // Per-day per-venue revenue from Lapis — the authoritative sales_ratio base.
  // Lapis is service+product ex-VAT, daily granularity, so a day's shared SG&A
  // is split by THAT day's actual revenue mix per venue (not a window-wide avg).
  const lapisByDate: Record<string, Record<string, number>> = {};
  const lapisWindowTotal: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  for (const r of lapisRows) {
    if (!SPA_VENUE_SLUGS.includes(r.venue_slug)) continue;
    if (!lapisByDate[r.date]) lapisByDate[r.date] = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
    lapisByDate[r.date][r.venue_slug] += r.amount;
    lapisWindowTotal[r.venue_slug] += r.amount;
  }
  const lapisWindowSum = Object.values(lapisWindowTotal).reduce((a, b) => a + b, 0);
  const lapisWindowPct: Record<string, number> | null = lapisWindowSum > 0
    ? Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, lapisWindowTotal[s] / lapisWindowSum]))
    : null;
  if (lapisWindowPct) {
    log.push(`SPA Lapis window revPct: ${SPA_VENUE_SLUGS.map(s => `${s}=${(lapisWindowPct[s] * 100).toFixed(1)}%`).join(" ")}`);
  }

  type Classified = {
    line:    TxnLine;
    ebitda:  string;          // revenue / cogs / wages / ...
    rule:    string;          // CoA split rule from the mapping
    tagSlug: string | null;   // "hq" or one of the 8 venue slugs (or null)
  };
  const classified: Classified[] = [];
  let droppedUnmapped = 0, droppedExcluded = 0;

  for (const ln of lines) {
    if (ln.amount === 0) continue;
    const mapped = coaMap[ln.account_code];
    if (!mapped) { droppedUnmapped++; continue; }
    const [rule, rawLine] = mapped;
    if (rawLine === "excluded") { droppedExcluded++; continue; }
    const ebitda = rawLine.startsWith("sga_") ? "sga" : rawLine;
    if (!VALID_LINES.has(ebitda)) { droppedExcluded++; continue; }
    classified.push({ line: ln, ebitda, rule, tagSlug: spaTagToSlug(ln.tags) });
  }
  log.push(`SPA classified: ${classified.length} kept; dropped ${droppedUnmapped} unmapped, ${droppedExcluded} excluded`);

  // 2. Ratio bases for sales_ratio splits. Must include venue-tagged revenue —
  //    in production most SPA revenue is tagged, so a base built only from
  //    untagged lines collapses to zero and falls back to equal 1/8 share,
  //    silently degrading every sales_ratio cell to an equal split. Mirrors
  //    the canonical logic in zoho-spa-transactions-ebitda.ts.
  const revBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  const salBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  for (const c of classified) {
    if (c.ebitda === "revenue") {
      let slug: string | null = null;
      if (c.tagSlug === "hq") {
        // HQ is not a SPA venue — never contributes to the ratio.
      } else if (c.tagSlug && SPA_VENUE_SLUGS.includes(c.tagSlug)) {
        slug = c.tagSlug;
      } else if (SPA_VENUE_SLUGS.includes(c.rule)) {
        slug = c.rule;
      } else {
        const loc = detectLocation(c.line.account_name);
        if (loc && SPA_VENUE_SLUGS.includes(loc)) slug = loc;
      }
      if (slug) revBySlug[slug] += c.line.amount;
    }
    if (c.line.account_code && SALARY_RATIO_CODES[c.line.account_code]) {
      const slug = SALARY_RATIO_CODES[c.line.account_code];
      if (SPA_VENUE_SLUGS.includes(slug)) salBySlug[slug] += c.line.amount;
    }
  }
  let totalRev = Object.values(revBySlug).reduce((a, b) => a + b, 0);
  if (totalRev === 0) { for (const s of SPA_VENUE_SLUGS) revBySlug[s] = 1; totalRev = SPA_VENUE_SLUGS.length; }
  let totalSal = Object.values(salBySlug).reduce((a, b) => a + b, 0);

  // Salary-cost fallback: if the pull window contains no salary postings
  // (typical for mid-month windows — SPA salaries book on the last
  // calendar day), widen to the WHOLE month(s) the window touches and
  // pull from reports/journal. Without this, every line on a
  // `salary_cost` split rule would silently allocate to all-zero shares
  // and disappear from the EBIDA Layer output.
  let salPct: Record<string, number>;
  if (totalSal === 0) {
    log.push(`SPA salary base = 0 in window ${fromDate} → ${toDate}; falling back to monthly salary postings…`);
    const fb = await pullMonthlySalaryBase(client, fromDate, toDate, log);
    if (fb.total > 0) {
      for (const s of SPA_VENUE_SLUGS) salBySlug[s] = fb.salBySlug[s] ?? 0;
      totalSal = fb.total;
      log.push(`Salary-cost fallback: pulled monthly salary postings for ${fb.monthsUsed.join(", ")} → totalSal=€${totalSal.toFixed(2)}`);
      salPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, (salBySlug[s] ?? 0) / totalSal]));
    } else {
      // Final fallback: equal split (better than silently zeroing the line).
      log.push(`Salary-cost fallback: monthly pull also €0 across ${fb.monthsUsed.join(", ") || "no months"}; using equal-share allocation`);
      const equalShare = 1 / SPA_VENUE_SLUGS.length;
      salPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, equalShare]));
    }
  } else {
    salPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, salBySlug[s] / totalSal]));
  }
  const zohoRevPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, revBySlug[s] / totalRev]));
  log.push(`SPA Zoho-tagged revPct (fallback): ${SPA_VENUE_SLUGS.map(s => `${s}=${(zohoRevPct[s] * 100).toFixed(1)}%`).join(" ")}`);
  log.push(`SPA salPct: ${SPA_VENUE_SLUGS.map(s => `${s}=${(salPct[s] * 100).toFixed(1)}%`).join(" ")}`);

  // sales_ratio precedence for a given line date:
  //   1. Lapis revenue per venue on that exact date  (truthiest signal)
  //   2. Lapis revenue per venue across the pull window  (smooths empty days)
  //   3. Zoho venue-tagged revenue across the window  (Lapis unavailable)
  //   4. Equal 1/8 share  (degenerate fallback baked into zohoRevPct above)
  function dailyRevPctSpa(date: string): Record<string, number> {
    const day = lapisByDate[date];
    if (day) {
      const total = SPA_VENUE_SLUGS.reduce((a, s) => a + (day[s] ?? 0), 0);
      if (total > 0) {
        return Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, (day[s] ?? 0) / total]));
      }
    }
    if (lapisWindowPct) return lapisWindowPct;
    return zohoRevPct;
  }

  // 3. Bucket per (account, venue, tag_source, contact) — daily values inside
  type Bucket = {
    brand:           "SPA";
    venue:           string;
    venue_slug:      string;
    account_name:    string;
    account_code:    string;
    ebitda_category: string;
    split_rule:      string;
    tag_source:      "tagged" | "split";
    contact:         string;
    daily:           Record<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  const venueDisplay = (slug: string): string => SLUG_DISPLAY[slug] ?? slug;
  const tagCount = { tagged: 0, split: 0 };

  function addToBucket(
    c: Classified,
    slug: string,
    amount: number,
    tagSource: "tagged" | "split",
  ) {
    if (amount === 0) return;
    const contact = c.ebitda === "advertising"
      ? resolveAdvertisingContact(c.line.contact_name, adContactMap)
      : "";
    const accountKey = c.line.account_code || c.line.account_name;
    const key = `${accountKey}::${slug}::${tagSource}::${contact}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        brand:           "SPA",
        venue:           venueDisplay(slug),
        venue_slug:      slug,
        account_name:    c.line.account_name,
        account_code:    c.line.account_code,
        ebitda_category: c.ebitda,
        split_rule:      c.rule,
        tag_source:      tagSource,
        contact,
        daily:           {},
      };
      buckets.set(key, b);
    }
    b!.daily[c.line.date] = (b!.daily[c.line.date] ?? 0) + amount;
  }

  for (const c of classified) {
    // Tag wins
    if (c.tagSlug === "hq") {
      addToBucket(c, "hq", c.line.amount, "tagged");
      tagCount.tagged++;
      continue;
    }
    if (c.tagSlug && SPA_VENUE_SLUGS.includes(c.tagSlug)) {
      addToBucket(c, c.tagSlug, c.line.amount, "tagged");
      tagCount.tagged++;
      continue;
    }
    // No usable tag → name override → CoA rule
    const nameLoc = detectLocation(c.line.account_name);
    const effectiveRule = nameLoc ?? c.rule;
    if (effectiveRule === "hq") {
      addToBucket(c, "hq", c.line.amount, "split");
    } else if (SPA_VENUE_SLUGS.includes(effectiveRule)) {
      addToBucket(c, effectiveRule, c.line.amount, "split");
    } else {
      const shares = spaVenueShares(effectiveRule, c.line.amount, dailyRevPctSpa(c.line.date), salPct);
      for (const [slug, amt] of Object.entries(shares)) addToBucket(c, slug, amt, "split");
    }
    tagCount.split++;
  }
  log.push(`SPA allocation: ${tagCount.tagged} tagged, ${tagCount.split} split-rule`);

  // 4. Cockpit-side revenue (Lapis POS) — one bucket per (date, venue_slug).
  //    Layered on TOP of Zoho-derived revenue so the EBIDA Layer sheet shows
  //    both authoritative POS revenue and Zoho's non-excluded revenue CoA.
  //    Reuses lapisRows already loaded above for the sales_ratio base.
  let lapisAdded = 0;
  for (const r of lapisRows) {
    if (!SPA_VENUE_SLUGS.includes(r.venue_slug)) continue;
    const key = `LAPIS_REV::${r.venue_slug}::split::`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        brand:           "SPA",
        venue:           venueDisplay(r.venue_slug),
        venue_slug:      r.venue_slug,
        account_name:    "SPA Revenue (Lapis)",
        account_code:    "LAPIS_REV",
        ebitda_category: "revenue",
        split_rule:      "lapis_pos",
        tag_source:      "split",
        contact:         "",
        daily:           {},
      };
      buckets.set(key, b);
    }
    b.daily[r.date] = (b.daily[r.date] ?? 0) + r.amount;
    lapisAdded++;
  }
  log.push(`  Lapis bucket entries added: ${lapisAdded}`);

  const result = finalizeRows(buckets, dates, period, log);
  result.reconciliation = await runReconciliation(client, "spa", result.rows, fromDate, toDate, log);
  return result;
}

// ── Aesthetics rows (covers AES + SLIM brands) ──────────────────────────────

async function buildAesthRows(
  client:   ZohoBooksClient,
  lines:    TxnLine[],
  dates:    string[],
  period:   { from_date: string; to_date: string },
  log:      string[],
  fromDate: string,
  toDate:   string,
): Promise<DailyResult> {
  log.push("Loading Aesthetics CoA mapping + advertising contact mapping + Cockpit POS revenue…");
  // Do NOT swallow Cockpit POS fetch failures: a silent fallback to [] would
  // emit zero AES / SLIM revenue, write wrong totals to the EBIDA Layer, and
  // bias every shared-cost split (sales_ratio uses AES+SLIM as denominator).
  // The chunk runner retries on failure, so propagating is safer than silent
  // zeros.
  const [coaMap, adContactMap, aesRows, slimRows]: [
    Record<string, [string, string]>,
    AdContactMappingEntry[],
    Array<{ date: string; amount: number }>,
    Array<{ date: string; amount: number }>,
  ] = await Promise.all([
    loadAestheticsCoaMap(),
    loadAdvertisingContactMapping(),
    loadAesthCockpitRevenue(fromDate, toDate),
    loadSlimCockpitRevenue(fromDate, toDate),
  ]);
  log.push(`  advertising contact patterns loaded: ${adContactMap.length}`);
  log.push(`  Cockpit POS rows fetched: AES=${aesRows.length} SLIM=${slimRows.length}`);

  // Per-day per-dept revenue from Cockpit POS — the authoritative sales_ratio
  // base. Daily-granular so a day's shared SG&A splits by THAT day's actual
  // dept revenue mix, not a window-wide average that may be dominated by one
  // dept's busier period.
  const cockpitByDate: Record<string, Record<"aesthetics" | "slimming", number>> = {};
  const cockpitWindow: Record<"aesthetics" | "slimming", number> = { aesthetics: 0, slimming: 0 };
  for (const r of aesRows) {
    if (!cockpitByDate[r.date]) cockpitByDate[r.date] = { aesthetics: 0, slimming: 0 };
    cockpitByDate[r.date].aesthetics += r.amount;
    cockpitWindow.aesthetics += r.amount;
  }
  for (const r of slimRows) {
    if (!cockpitByDate[r.date]) cockpitByDate[r.date] = { aesthetics: 0, slimming: 0 };
    cockpitByDate[r.date].slimming += r.amount;
    cockpitWindow.slimming += r.amount;
  }
  const cockpitWindowSum = cockpitWindow.aesthetics + cockpitWindow.slimming;
  const cockpitWindowPct: Record<"aesthetics" | "slimming", number> | null =
    cockpitWindowSum > 0
      ? { aesthetics: cockpitWindow.aesthetics / cockpitWindowSum, slimming: cockpitWindow.slimming / cockpitWindowSum }
      : null;
  if (cockpitWindowPct) {
    log.push(`AES/SLIM Cockpit window revPct: aesthetics=${(cockpitWindowPct.aesthetics * 100).toFixed(1)}% slimming=${(cockpitWindowPct.slimming * 100).toFixed(1)}%`);
  }

  type Classified = {
    line:    TxnLine;
    ebitda:  string;
    rule:    string;
    tagDept: "aesthetics" | "slimming" | null;
  };
  const classified: Classified[] = [];
  let droppedUnmappedIncome = 0, droppedExcluded = 0, droppedUnmappedExpense = 0;

  for (const ln of lines) {
    if (ln.amount === 0) continue;
    let rule: string, ebitda: string;
    const mapped = coaMap[ln.account_code];
    if (mapped) {
      [rule, ebitda] = mapped;
      if (ebitda === "excluded") { droppedExcluded++; continue; }
    } else if (ln.section === "income") {
      // Unmapped income skipped — pattern from dashboard ETL (Aesthetics revenue
      // recorded outside Zoho on aesthetics_sales_daily / slimming_sales_daily).
      droppedUnmappedIncome++;
      continue;
    } else {
      // Unmapped expense — keep with equal split + SGA bucket (better than dropping)
      droppedUnmappedExpense++;
      rule   = "equal";
      ebitda = "sga";
    }
    if (ebitda.startsWith("sga_")) ebitda = "sga";
    if (!VALID_LINES.has(ebitda)) { droppedExcluded++; continue; }
    classified.push({ line: ln, ebitda, rule, tagDept: aesthTagToDept(ln.tags) });
  }
  log.push(`AES/SLIM classified: ${classified.length} kept; dropped ${droppedUnmappedIncome} unmapped-income, ${droppedUnmappedExpense} unmapped-expense kept as SGA-equal, ${droppedExcluded} excluded`);

  // 2. Revenue ratio base. Include tagged revenue — excluding it makes the
  //    base collapse when (as in production) most income is dept-tagged,
  //    which silently degrades every sales_ratio cell to an equal 50/50 split.
  const revBySlug: Record<"aesthetics" | "slimming", number> = { aesthetics: 0, slimming: 0 };
  for (const c of classified) {
    if (c.ebitda !== "revenue") continue;
    let dept: "aesthetics" | "slimming" | null = null;
    if (c.tagDept) {
      dept = c.tagDept;
    } else {
      const nameDept = detectAesthDept(c.line.account_name);
      dept = nameDept ?? (c.rule === "aesthetics" || c.rule === "slimming" ? c.rule : null);
    }
    if (dept) revBySlug[dept] += c.line.amount;
  }
  let totalRev = revBySlug.aesthetics + revBySlug.slimming;
  if (totalRev === 0) { revBySlug.aesthetics = 1; revBySlug.slimming = 1; totalRev = 2; }
  const zohoRevPct: Record<"aesthetics" | "slimming", number> = {
    aesthetics: revBySlug.aesthetics / totalRev,
    slimming:   revBySlug.slimming   / totalRev,
  };
  log.push(`AES/SLIM Zoho-tagged revPct (fallback): aesthetics=${(zohoRevPct.aesthetics * 100).toFixed(1)}% slimming=${(zohoRevPct.slimming * 100).toFixed(1)}%`);

  // sales_ratio precedence: per-day Cockpit POS → window-wide Cockpit POS →
  // Zoho-tagged Zoho revenue → equal 50/50 (baked into zohoRevPct above).
  function dailyRevPctAesth(date: string): Record<"aesthetics" | "slimming", number> {
    const day = cockpitByDate[date];
    if (day) {
      const total = day.aesthetics + day.slimming;
      if (total > 0) return { aesthetics: day.aesthetics / total, slimming: day.slimming / total };
    }
    if (cockpitWindowPct) return cockpitWindowPct;
    return zohoRevPct;
  }

  // 3. Bucket per (account, dept, tag_source, contact)
  type Bucket = {
    brand:           "AES" | "SLIM";
    venue:           string;
    venue_slug:      string;
    account_name:    string;
    account_code:    string;
    ebitda_category: string;
    split_rule:      string;
    tag_source:      "tagged" | "split";
    contact:         string;
    daily:           Record<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  const tagCount = { tagged: 0, split: 0 };

  function addToBucket(
    c: Classified,
    dept: "aesthetics" | "slimming",
    amount: number,
    tagSource: "tagged" | "split",
  ) {
    if (amount === 0) return;
    const contact = c.ebitda === "advertising"
      ? resolveAdvertisingContact(c.line.contact_name, adContactMap)
      : "";
    const meta = AESTH_BRAND_DISPLAY[dept];
    const accountKey = c.line.account_code || c.line.account_name;
    const key = `${accountKey}::${dept}::${tagSource}::${contact}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        brand:           meta.brand,
        venue:           meta.venue,
        venue_slug:      dept,
        account_name:    c.line.account_name,
        account_code:    c.line.account_code,
        ebitda_category: c.ebitda,
        split_rule:      c.rule,
        tag_source:      tagSource,
        contact,
        daily:           {},
      };
      buckets.set(key, b);
    }
    b.daily[c.line.date] = (b.daily[c.line.date] ?? 0) + amount;
  }

  for (const c of classified) {
    if (c.tagDept) {
      addToBucket(c, c.tagDept, c.line.amount, "tagged");
      tagCount.tagged++;
      continue;
    }
    const nameDept = detectAesthDept(c.line.account_name);
    if (nameDept) {
      addToBucket(c, nameDept, c.line.amount, "split");
    } else {
      const shares = aesthDeptShares(c.rule, c.line.amount, dailyRevPctAesth(c.line.date));
      addToBucket(c, "aesthetics", shares.aesthetics, "split");
      addToBucket(c, "slimming",   shares.slimming,   "split");
    }
    tagCount.split++;
  }
  log.push(`AES/SLIM allocation: ${tagCount.tagged} tagged, ${tagCount.split} split-rule`);

  // 4. Cockpit-side revenue (Supabase POS tables) — one bucket per date for
  //    each brand. Layered on top of Zoho-derived revenue. Reuses aesRows /
  //    slimRows already loaded above for the sales_ratio base.
  {
    function upsertCockpitBucket(
      brand:        "AES" | "SLIM",
      venue:        string,
      venue_slug:   string,
      account_name: string,
      account_code: string,
      rows:         Array<{ date: string; amount: number }>,
    ) {
      const key = `${account_code}::${venue_slug}::split::`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          brand,
          venue,
          venue_slug,
          account_name,
          account_code,
          ebitda_category: "revenue",
          split_rule:      "cockpit_pos",
          tag_source:      "split",
          contact:         "",
          daily:           {},
        };
        buckets.set(key, b);
      }
      for (const r of rows) {
        b.daily[r.date] = (b.daily[r.date] ?? 0) + r.amount;
      }
    }

    upsertCockpitBucket(
      "AES", "Aesthetics", "aesthetics",
      "Aesthetics Revenue (Sales)", "POS_AES_REV",
      aesRows,
    );
    upsertCockpitBucket(
      "SLIM", "Slimming", "slimming",
      "Slimming Revenue (Sales)", "POS_SLIM_REV",
      slimRows,
    );
  }

  const result = finalizeRows(buckets, dates, period, log);
  result.reconciliation = await runReconciliation(client, "aesthetics", result.rows, fromDate, toDate, log);
  return result;
}

// ── Common finalisation ─────────────────────────────────────────────────────

type BucketLike = {
  brand:           "SPA" | "AES" | "SLIM";
  venue:           string;
  venue_slug:      string;
  account_name:    string;
  account_code:    string;
  ebitda_category: string;
  split_rule:      string;
  tag_source:      "tagged" | "split";
  contact:         string;
  daily:           Record<string, number>;
};

function finalizeRows(
  buckets: Map<string, BucketLike>,
  dates:   string[],
  period:  { from_date: string; to_date: string },
  log:     string[],
): DailyResult {
  const rows: DailyRow[] = [];
  for (const b of buckets.values()) {
    const cleaned: Record<string, number> = {};
    for (const [d, v] of Object.entries(b.daily)) {
      const r = Math.round(v * 100) / 100;
      if (r !== 0) cleaned[d] = r;
    }
    if (Object.keys(cleaned).length === 0) continue;
    rows.push({
      brand:           b.brand,
      venue:           b.venue,
      venue_slug:      b.venue_slug,
      account_name:    b.account_name,
      account_code:    b.account_code,
      ebitda_category: b.ebitda_category,
      split_rule:      b.split_rule,
      tag_source:      b.tag_source,
      contact:         b.contact,
      daily:           cleaned,
    });
  }
  rows.sort((a, b) =>
    a.ebitda_category.localeCompare(b.ebitda_category) ||
    a.account_name.localeCompare(b.account_name) ||
    a.venue.localeCompare(b.venue) ||
    a.contact.localeCompare(b.contact) ||
    a.tag_source.localeCompare(b.tag_source),
  );
  log.push(`Done: ${rows.length} (account, target, source) row(s)`);
  return { rows, dates, period, log };
}
