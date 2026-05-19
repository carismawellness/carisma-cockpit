import { ZohoBooksClient } from "./zoho-client";
import {
  COA_MAP,
  detectLocation,
  detectLineFromName,
  loadSpaCoaFromSupabase,
} from "./spa-ebitda";
import {
  discoverTagOptions,
  SLUG_DISPLAY,
  ZOHO_TAG_TO_SLUG,
  SALARY_RATIO_CODES,
  UI_KEY_TO_SLUG,
  TagOption,
} from "./zoho-spa-breakdown";

export type DailyRow = {
  brand: "SPA" | "AES" | "SLIM";
  venue: string;
  venue_slug: string;
  account_name: string;
  account_code: string;
  ebitda_category: string;
  split_rule: string;
  tag_source: "tagged" | "split";
  daily: Record<string, number>;
};

export type DailyResult = {
  rows: DailyRow[];
  dates: string[];
  period: { from_date: string; to_date: string };
  log: string[];
};

const VALID_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);
const SPA_VENUE_SLUGS = [
  "intercontinental", "hugos", "hyatt", "ramla",
  "labranda", "sunny_coast", "excelsior", "novotel",
];
const PAGE_THROTTLE_MS = 750;

type TxnLine = {
  date: string;
  account_id?: string;
  account_name: string;
  account_code: string;
  reporting_tags: Array<{ tag_id?: string; tag_option_id?: string; tag_option_name?: string }>;
  bcy_amount: number;
  debit_or_credit: string;
  section: "income" | "expense";
};

function enumerateDates(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function monthChunks(fromDate: string, toDate: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(y, m, 1));
    const monthEnd = new Date(Date.UTC(y, m + 1, 0));
    const chunkFrom = monthStart.getTime() < start.getTime() ? start : monthStart;
    const chunkTo = monthEnd.getTime() > end.getTime() ? end : monthEnd;
    chunks.push({
      from: chunkFrom.toISOString().slice(0, 10),
      to: chunkTo.toISOString().slice(0, 10),
    });
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return chunks;
}

function classifySection(accountType: string | undefined): "income" | "expense" | null {
  if (!accountType) return null;
  const t = accountType.toLowerCase();
  if (t.includes("income") || t.includes("revenue")) return "income";
  if (
    t.includes("expense") ||
    t.includes("cost_of_goods") ||
    t.includes("cogs") ||
    t === "other_expense"
  ) return "expense";
  return null;
}

function lineFromCoaOrName(
  code: string,
  name: string,
  section: "income" | "expense",
  coaMap: Record<string, [string, string]>,
): { rule: string; line: string } {
  if (code && code in coaMap) {
    const [rule, line] = coaMap[code];
    return { rule, line };
  }
  if (section === "income") return { rule: "sales_ratio", line: "revenue" };
  return { rule: "equal", line: detectLineFromName(name, section) };
}

function venueShares(
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

  if (rule === "salary_cost") {
    for (const s of SPA_VENUE_SLUGS) out[s] = amount * (salPct[s] ?? 0);
    return out;
  }

  if (rule.startsWith("custom:")) {
    const config: Record<string, number> = JSON.parse(rule.slice(7));
    const totalPct = Object.values(config).reduce((a, b) => a + b, 0) || 100;
    for (const [key, pct] of Object.entries(config)) {
      const s = UI_KEY_TO_SLUG[key];
      if (s && s in out) out[s] += amount * (pct / totalPct);
    }
    return out;
  }

  const share = amount / SPA_VENUE_SLUGS.length;
  for (const s of SPA_VENUE_SLUGS) out[s] = share;
  return out;
}

async function fetchTransactionDetailsChunk(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
  log: string[],
): Promise<TxnLine[]> {
  const out: TxnLine[] = [];
  let page = 1;
  let pageCount = 0;
  while (true) {
    if (pageCount > 0) await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
    const data = await client.get("reports/transactiondetails", {
      from_date: fromDate,
      to_date: toDate,
      page: String(page),
      per_page: "200",
      cash_based: "false",
      show_zero_activity_accounts: "false",
    }) as Record<string, unknown>;
    pageCount++;

    const accounts = (data.account_transactions ?? data.transaction_details ?? []) as unknown[];
    for (const acc of accounts) {
      if (!acc || typeof acc !== "object") continue;
      const a = acc as Record<string, unknown>;
      const accountName = String(a.account_name ?? a.name ?? "").trim();
      const accountCode = String(a.account_code ?? "").trim();
      const accountType = String(a.account_type ?? a.account_group ?? "").trim();
      const section = classifySection(accountType);
      const txns = (a.account_transactions ?? a.transactions ?? []) as unknown[];

      for (const txn of txns) {
        if (!txn || typeof txn !== "object") continue;
        const t = txn as Record<string, unknown>;
        const date = String(t.date ?? t.transaction_date ?? "").slice(0, 10);
        if (!date) continue;

        const debit = Number(t.bcy_debit ?? t.debit_amount ?? 0);
        const credit = Number(t.bcy_credit ?? t.credit_amount ?? 0);
        let bcyAmount = Number(t.bcy_amount ?? 0);
        const doc = String(t.debit_or_credit ?? "").toLowerCase();

        const lineSection: "income" | "expense" =
          section ?? (doc === "credit" && credit > 0 ? "income" : "expense");

        if (!Number.isFinite(bcyAmount) || bcyAmount === 0) {
          bcyAmount = lineSection === "income"
            ? Math.max(0, credit - debit)
            : Math.max(0, debit - credit);
        } else {
          const signed = doc === "credit" ? bcyAmount : -bcyAmount;
          bcyAmount = lineSection === "income" ? signed : -signed;
          bcyAmount = Math.max(0, bcyAmount);
        }
        if (bcyAmount === 0) continue;

        const tags = (t.reporting_tags ?? t.tags ?? []) as unknown[];
        const reporting_tags = tags
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .map(x => ({
            tag_id: x.tag_id != null ? String(x.tag_id) : undefined,
            tag_option_id: x.tag_option_id != null ? String(x.tag_option_id) : undefined,
            tag_option_name: x.tag_option_name != null ? String(x.tag_option_name) : undefined,
          }));

        out.push({
          date,
          account_id: a.account_id != null ? String(a.account_id) : undefined,
          account_name: accountName,
          account_code: accountCode,
          reporting_tags,
          bcy_amount: bcyAmount,
          debit_or_credit: doc,
          section: lineSection,
        });
      }
    }

    const ctx = data.page_context as Record<string, unknown> | undefined;
    if (!ctx?.has_more_page) break;
    page++;
  }
  log.push(`  ${fromDate}..${toDate}: ${pageCount} page(s), ${out.length} lines`);
  return out;
}

function resolveTagSlug(
  tags: TxnLine["reporting_tags"],
  optionIdToSlug: Map<string, string>,
): string | null {
  for (const tag of tags) {
    if (tag.tag_option_id && optionIdToSlug.has(tag.tag_option_id)) {
      return optionIdToSlug.get(tag.tag_option_id)!;
    }
    const name = (tag.tag_option_name ?? "").trim().toLowerCase();
    if (name && name in ZOHO_TAG_TO_SLUG) return ZOHO_TAG_TO_SLUG[name];
  }
  return null;
}

export async function fetchZohoTransactionsDaily(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
  org: "spa" | "aesthetics",
): Promise<DailyResult> {
  const period = { from_date: fromDate, to_date: toDate };
  const dates = enumerateDates(fromDate, toDate);
  const log: string[] = [];

  if (org === "aesthetics") {
    log.push("aesthetics not yet implemented");
    return { rows: [], dates, period, log };
  }

  log.push("Discovering venue tag options…");
  const tagOptions = await discoverTagOptions(client);
  const optionIdToSlug = new Map<string, string>();
  for (const t of tagOptions) optionIdToSlug.set(t.tag_option_id, t.slug);
  log.push(`Tag options: ${tagOptions.map(t => t.slug).join(", ") || "(none)"}`);

  log.push("Loading SPA CoA…");
  const coaMap = (await loadSpaCoaFromSupabase()) ?? COA_MAP;

  log.push(`Fetching transaction details across ${monthChunks(fromDate, toDate).length} month chunk(s)…`);
  const allLines: TxnLine[] = [];
  for (const chunk of monthChunks(fromDate, toDate)) {
    const lines = await fetchTransactionDetailsChunk(client, chunk.from, chunk.to, log);
    allLines.push(...lines);
  }
  log.push(`Total lines: ${allLines.length}`);

  const revBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  const salBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  for (const ln of allLines) {
    const tagSlug = resolveTagSlug(ln.reporting_tags, optionIdToSlug);
    if (ln.section === "income" && tagSlug && tagSlug !== "hq" && SPA_VENUE_SLUGS.includes(tagSlug)) {
      revBySlug[tagSlug] += ln.bcy_amount;
    }
    if (ln.account_code && SALARY_RATIO_CODES[ln.account_code]) {
      const slug = SALARY_RATIO_CODES[ln.account_code];
      if (SPA_VENUE_SLUGS.includes(slug)) salBySlug[slug] += ln.bcy_amount;
    }
  }
  let totalRev = Object.values(revBySlug).reduce((a, b) => a + b, 0);
  if (totalRev === 0) { for (const s of SPA_VENUE_SLUGS) revBySlug[s] = 1; totalRev = SPA_VENUE_SLUGS.length; }
  let totalSal = Object.values(salBySlug).reduce((a, b) => a + b, 0);
  if (totalSal === 0) totalSal = 1;
  const revPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, revBySlug[s] / totalRev]));
  const salPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, salBySlug[s] / totalSal]));

  type Bucket = {
    brand: "SPA";
    venue: string;
    venue_slug: string;
    account_name: string;
    account_code: string;
    ebitda_category: string;
    split_rule: string;
    has_tagged: boolean;
    has_split: boolean;
    daily: Record<string, number>;
  };
  const buckets = new Map<string, Bucket>();

  const venueDisplay = (slug: string): string => SLUG_DISPLAY[slug] ?? slug;

  const allValidSlugs = new Set<string>([...SPA_VENUE_SLUGS, "hq"]);

  for (const ln of allLines) {
    const { rule: rawRule, line: rawLine } = lineFromCoaOrName(ln.account_code, ln.account_name, ln.section, coaMap);
    let ebitdaLine = rawLine;
    if (ebitdaLine.startsWith("sga_")) ebitdaLine = "sga";
    if (ebitdaLine === "excluded" || !VALID_LINES.has(ebitdaLine)) continue;

    const tagSlug = resolveTagSlug(ln.reporting_tags, optionIdToSlug);

    let allocations: Array<{ slug: string; amount: number; fromTag: boolean }> = [];
    if (tagSlug && allValidSlugs.has(tagSlug)) {
      allocations.push({ slug: tagSlug, amount: ln.bcy_amount, fromTag: true });
    } else {
      const nameLoc = detectLocation(ln.account_name);
      const effectiveRule = nameLoc ?? rawRule;
      if (effectiveRule === "hq") {
        allocations.push({ slug: "hq", amount: ln.bcy_amount, fromTag: false });
      } else if (SPA_VENUE_SLUGS.includes(effectiveRule)) {
        allocations.push({ slug: effectiveRule, amount: ln.bcy_amount, fromTag: false });
      } else {
        const shares = venueShares(effectiveRule, ln.bcy_amount, revPct, salPct);
        for (const [slug, amt] of Object.entries(shares)) {
          if (amt !== 0) allocations.push({ slug, amount: amt, fromTag: false });
        }
      }
    }

    const accountKey = ln.account_code || ln.account_name;
    for (const alloc of allocations) {
      if (alloc.amount === 0) continue;
      const bucketKey = `${accountKey}::${alloc.slug}`;
      let b = buckets.get(bucketKey);
      if (!b) {
        b = {
          brand: "SPA",
          venue: venueDisplay(alloc.slug),
          venue_slug: alloc.slug,
          account_name: ln.account_name,
          account_code: ln.account_code,
          ebitda_category: ebitdaLine,
          split_rule: rawRule,
          has_tagged: false,
          has_split: false,
          daily: {},
        };
        buckets.set(bucketKey, b);
      }
      b.daily[ln.date] = (b.daily[ln.date] ?? 0) + alloc.amount;
      if (alloc.fromTag) b.has_tagged = true; else b.has_split = true;
    }
  }

  const rows: DailyRow[] = [];
  for (const b of buckets.values()) {
    const cleanedDaily: Record<string, number> = {};
    for (const [d, v] of Object.entries(b.daily)) {
      const r = Math.round(v * 100) / 100;
      if (r !== 0) cleanedDaily[d] = r;
    }
    if (Object.keys(cleanedDaily).length === 0) continue;
    rows.push({
      brand: b.brand,
      venue: b.venue,
      venue_slug: b.venue_slug,
      account_name: b.account_name,
      account_code: b.account_code,
      ebitda_category: b.ebitda_category,
      split_rule: b.split_rule,
      tag_source: b.has_tagged ? "tagged" : "split",
      daily: cleanedDaily,
    });
  }

  rows.sort((a, b) =>
    a.ebitda_category.localeCompare(b.ebitda_category) ||
    a.account_name.localeCompare(b.account_name) ||
    a.venue.localeCompare(b.venue)
  );

  log.push(`Done: ${rows.length} (account, venue) rows`);
  return { rows, dates, period, log };
}
