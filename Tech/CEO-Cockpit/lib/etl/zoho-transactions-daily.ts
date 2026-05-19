import { ZohoBooksClient } from "./zoho-client";
import {
  COA_MAP,
  detectLocation,
  loadSpaCoaFromSupabase,
} from "./spa-ebitda";
import {
  SLUG_DISPLAY,
  SALARY_RATIO_CODES,
  UI_KEY_TO_SLUG,
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
const PAGE_THROTTLE_MS = 1500;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

type JournalLine = {
  date: string;
  account_id: string;
  account_code: string;
  account_name: string;
  section: "income" | "expense" | "other";
  amount: number;
};

function parseZohoDate(s: string): string | null {
  // "01 Jan 2025" → "2025-01-01"
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(s.trim());
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

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

type AccountMeta = { code: string; name: string; type: string; section: "income" | "expense" | "other" };

async function loadAccountMeta(client: ZohoBooksClient): Promise<Map<string, AccountMeta>> {
  const result = new Map<string, AccountMeta>();
  let page = 1;
  while (true) {
    const data = await client.get("chartofaccounts", { page: String(page), per_page: "200" }) as Record<string, unknown>;
    const accounts = (data.chartofaccounts ?? []) as Array<Record<string, unknown>>;
    for (const a of accounts) {
      const id = String(a.account_id ?? "");
      if (!id) continue;
      const code = String(a.account_code ?? "").trim();
      const name = String(a.account_name ?? "").trim();
      const type = String(a.account_type ?? "").toLowerCase();
      let section: AccountMeta["section"] = "other";
      if (type.includes("income") || type.includes("revenue")) section = "income";
      else if (type.includes("expense") || type.includes("cost_of_goods") || type.includes("cogs")) section = "expense";
      result.set(id, { code, name, type, section });
    }
    const ctx = data.page_context as Record<string, unknown> | undefined;
    if (!ctx?.has_more_page) break;
    page++;
  }
  return result;
}

async function fetchJournalChunk(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
  accountMeta: Map<string, AccountMeta>,
  log: string[],
): Promise<JournalLine[]> {
  const out: JournalLine[] = [];
  let page = 1;
  let pageCount = 0;
  while (true) {
    if (pageCount > 0) await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
    const data = await client.get("reports/journal", {
      filter_by: "TransactionDate.CustomDate",
      from_date: fromDate,
      to_date: toDate,
      page: String(page),
      per_page: "200",
      report_basis: "Accrual",
    }) as Record<string, unknown>;
    pageCount++;

    const journals = (data.journal ?? []) as Array<Record<string, unknown>>;
    for (const j of journals) {
      const date = parseZohoDate(String(j.date ?? ""));
      if (!date) continue;
      const lines = (j.account_transactions ?? []) as Array<Record<string, unknown>>;
      for (const ln of lines) {
        const accountId = String(ln.account_id ?? "");
        if (!accountId) continue;
        const meta = accountMeta.get(accountId);
        const section = meta?.section ?? "other";
        if (section === "other") continue; // skip balance-sheet movements

        const code = (meta?.code || String(ln.account_code ?? "").trim());
        const name = (meta?.name || String(ln.name ?? "").trim());
        if (!code && !name) continue;

        const debit  = Number(ln.debit_amount  ?? 0);
        const credit = Number(ln.credit_amount ?? 0);
        const net = section === "income" ? credit - debit : debit - credit;
        if (net === 0) continue;

        out.push({
          date,
          account_id: accountId,
          account_code: code,
          account_name: name,
          section,
          amount: net,
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

function lineFromCoaStrict(
  code: string,
  coaMap: Record<string, [string, string]>,
): { rule: string; line: string } | null {
  if (!code || !(code in coaMap)) return null;
  const [rule, line] = coaMap[code];
  return { rule, line };
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

  log.push("Loading chart of accounts…");
  const accountMeta = await loadAccountMeta(client);
  log.push(`Loaded ${accountMeta.size} accounts`);

  log.push("Loading SPA CoA mapping…");
  const coaMap = (await loadSpaCoaFromSupabase()) ?? COA_MAP;

  const chunks = monthChunks(fromDate, toDate);
  log.push(`Fetching journal across ${chunks.length} month chunk(s)…`);
  const allLines: JournalLine[] = [];
  for (const c of chunks) {
    const lines = await fetchJournalChunk(client, c.from, c.to, accountMeta, log);
    allLines.push(...lines);
    await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
  }
  log.push(`Total lines: ${allLines.length}`);

  // Ratio bases (name-detected, since no tag info is available at line level)
  const revBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  const salBySlug: Record<string, number> = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, 0]));
  for (const ln of allLines) {
    if (ln.section === "income") {
      const loc = detectLocation(ln.account_name);
      if (loc && SPA_VENUE_SLUGS.includes(loc)) revBySlug[loc] += ln.amount;
    }
    if (ln.account_code && SALARY_RATIO_CODES[ln.account_code]) {
      const slug = SALARY_RATIO_CODES[ln.account_code];
      if (SPA_VENUE_SLUGS.includes(slug)) salBySlug[slug] += ln.amount;
    }
  }
  let totalRev = Object.values(revBySlug).reduce((a, b) => a + b, 0);
  if (totalRev === 0) { for (const s of SPA_VENUE_SLUGS) revBySlug[s] = 1; totalRev = SPA_VENUE_SLUGS.length; }
  let totalSal = Object.values(salBySlug).reduce((a, b) => a + b, 0);
  if (totalSal === 0) totalSal = 1;
  const revPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, revBySlug[s] / totalRev]));
  const salPct = Object.fromEntries(SPA_VENUE_SLUGS.map(s => [s, salBySlug[s] / totalSal]));
  log.push(`revPct: ${SPA_VENUE_SLUGS.map(s => `${s}=${(revPct[s] * 100).toFixed(1)}%`).join(" ")}`);

  type Bucket = {
    brand: "SPA";
    venue: string;
    venue_slug: string;
    account_name: string;
    account_code: string;
    ebitda_category: string;
    split_rule: string;
    daily: Record<string, number>;
  };
  const buckets = new Map<string, Bucket>();
  const venueDisplay = (slug: string): string => SLUG_DISPLAY[slug] ?? slug;

  let droppedUnmapped = 0;
  let droppedExcluded = 0;
  for (const ln of allLines) {
    const mapped = lineFromCoaStrict(ln.account_code, coaMap);
    if (!mapped) { droppedUnmapped++; continue; }
    const { rule: rawRule, line: rawLine } = mapped;
    let ebitdaLine = rawLine;
    if (ebitdaLine.startsWith("sga_")) ebitdaLine = "sga";
    if (ebitdaLine === "excluded") { droppedExcluded++; continue; }
    if (!VALID_LINES.has(ebitdaLine)) { droppedExcluded++; continue; }

    const nameLoc = detectLocation(ln.account_name);
    const effectiveRule = nameLoc ?? rawRule;

    let allocations: Array<{ slug: string; amount: number }> = [];
    if (effectiveRule === "hq") {
      allocations.push({ slug: "hq", amount: ln.amount });
    } else if (SPA_VENUE_SLUGS.includes(effectiveRule)) {
      allocations.push({ slug: effectiveRule, amount: ln.amount });
    } else {
      const shares = venueShares(effectiveRule, ln.amount, revPct, salPct);
      for (const [slug, amt] of Object.entries(shares)) {
        if (amt !== 0) allocations.push({ slug, amount: amt });
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
          daily: {},
        };
        buckets.set(bucketKey, b);
      }
      b.daily[ln.date] = (b.daily[ln.date] ?? 0) + alloc.amount;
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
      tag_source: "split",
      daily: cleanedDaily,
    });
  }

  rows.sort((a, b) =>
    a.ebitda_category.localeCompare(b.ebitda_category) ||
    a.account_name.localeCompare(b.account_name) ||
    a.venue.localeCompare(b.venue)
  );

  log.push(`Done: ${rows.length} (account, venue) rows  (dropped: ${droppedUnmapped} unmapped, ${droppedExcluded} excluded)`);
  return { rows, dates, period, log };
}
