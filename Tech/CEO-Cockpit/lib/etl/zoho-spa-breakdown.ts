import { ZohoBooksClient } from "./zoho-client";
import { fetchPlAccounts } from "./zoho-pl-parser";
import { loadSpaCoaFromSupabase, COA_MAP, detectLocation, detectLineFromName } from "./spa-ebitda";

// ── Constants ─────────────────────────────────────────────────────────────────

const SPA_VENUE_SLUGS = [
  "intercontinental", "hugos", "hyatt", "ramla",
  "labranda", "sunny_coast", "excelsior", "novotel",
];

export const ZOHO_TAG_TO_SLUG: Record<string, string> = {
  hq:               "hq",
  inter:            "intercontinental",
  intercontinental: "intercontinental",
  hugos:            "hugos",
  "hugo's":         "hugos",
  hyatt:            "hyatt",
  ramla:            "ramla",
  "ramla bay":      "ramla",
  labranda:         "labranda",
  odycy:            "sunny_coast",
  "sunny coast":    "sunny_coast",
  seashell:         "sunny_coast",
  excelsior:        "excelsior",
  novotel:          "novotel",
};

export const SLUG_DISPLAY: Record<string, string> = {
  hq:               "HQ",
  intercontinental: "InterContinental",
  hugos:            "Hugos",
  hyatt:            "Hyatt",
  ramla:            "Ramla",
  labranda:         "Riviera",
  sunny_coast:      "Sunny Coast",
  excelsior:        "Excelsior",
  novotel:          "Novotel",
};

const EBITDA_LINE_ORDER = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"];

export const SALARY_RATIO_CODES: Record<string, string> = {
  "30001":  "intercontinental",
  "30002":  "hugos",
  "30003":  "hyatt",
  "30005":  "ramla",
  "30006":  "labranda",
  "30004":  "sunny_coast",
  "602221": "excelsior",
  "602222": "novotel",
};

export const UI_KEY_TO_SLUG: Record<string, string> = {
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type TagOption = { slug: string; display_name: string; tag_option_id: string };

export type AccountRow = {
  code: string;
  name: string;
  section: string;
  ebitda_line: string;
  split_rule: string;
  total: number;
  tagged_total: number;
  untagged_amount: number;
  venue_amounts: Record<string, number>;
};

export type ZohoSpaBreakdownResult = {
  tag_options: TagOption[];
  venue_slugs: string[];
  accounts: AccountRow[];
  period: { from_date: string; to_date: string };
  log: string[];
};

// ── Tag discovery ─────────────────────────────────────────────────────────────

export async function discoverTagOptions(client: ZohoBooksClient): Promise<TagOption[]> {
  const list = await client.get("settings/tags", {}) as {
    reporting_tags?: Array<{ tag_id: string; tag_options?: string }>;
    tags?:           Array<{ tag_id: string; tag_options?: string }>;
  };
  const groups = list.reporting_tags ?? list.tags ?? [];

  for (const group of groups) {
    const optNames = (group.tag_options ?? "").split(",").map(s => s.trim().toLowerCase());
    if (!optNames.some(n => n in ZOHO_TAG_TO_SLUG)) continue;

    const detail = await client.get(`settings/tags/${group.tag_id}`, {}) as {
      reporting_tag?: { tag_options?: Array<{ tag_option_id: string; tag_option_name: string }> };
    };
    const results: TagOption[] = [];
    for (const opt of detail.reporting_tag?.tag_options ?? []) {
      const slug = ZOHO_TAG_TO_SLUG[opt.tag_option_name.trim().toLowerCase()];
      if (slug) {
        results.push({
          slug,
          display_name: SLUG_DISPLAY[slug] ?? opt.tag_option_name,
          tag_option_id: opt.tag_option_id,
        });
      }
    }
    return results;
  }
  return [];
}

// ── Split rule application ────────────────────────────────────────────────────

function applyRule(
  rule: string,
  amount: number,
  revPct: Record<string, number>,
  salPct: Record<string, number>,
  slugs: string[],
): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(slugs.map(s => [s, 0]));
  if (amount <= 0) return out;

  if (slugs.includes(rule)) { out[rule] = amount; return out; }

  if (rule === "equal") {
    const share = amount / slugs.length;
    for (const s of slugs) out[s] = share;
    return out;
  }

  if (rule === "sales_ratio") {
    for (const s of slugs) out[s] = amount * (revPct[s] ?? 0);
    return out;
  }

  if (rule === "salary_cost") {
    for (const s of slugs) out[s] = amount * (salPct[s] ?? 0);
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

  // Fallback: equal
  const share = amount / slugs.length;
  for (const s of slugs) out[s] = share;
  return out;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

export async function fetchZohoSpaBreakdown(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
): Promise<ZohoSpaBreakdownResult> {
  const log: string[] = [];

  // 1. Discover venue tag options
  log.push("Discovering venue tag options…");
  const tagOptions = await discoverTagOptions(client);
  const allSlugs   = tagOptions.map(t => t.slug);
  const spaSlugs   = tagOptions.filter(t => t.slug !== "hq").map(t => t.slug);
  log.push(`Tag options: ${allSlugs.join(", ")}`);

  // 2. Full P&L (no tag filter)
  log.push("Fetching full SPA P&L…");
  const totalAccounts = await fetchPlAccounts(client, fromDate, toDate);
  log.push(`Full P&L: ${totalAccounts.length} accounts`);

  // 3. Tagged P&L per venue
  const taggedBySlug: Record<string, Map<string, number>> = {};
  for (const opt of tagOptions) {
    log.push(`Fetching P&L for ${opt.display_name}…`);
    try {
      const accs    = await fetchPlAccounts(client, fromDate, toDate, opt.tag_option_id);
      const codeMap = new Map<string, number>();
      for (const acc of accs) {
        const key = acc.code || acc.name;
        if (key) codeMap.set(key, (codeMap.get(key) ?? 0) + acc.amount);
      }
      taggedBySlug[opt.slug] = codeMap;
      log.push(`  ${opt.slug}: ${codeMap.size} accounts, €${Array.from(codeMap.values()).reduce((a, b) => a + b, 0).toFixed(0)}`);
    } catch (e) {
      log.push(`  ${opt.slug}: error — ${e}`);
      taggedBySlug[opt.slug] = new Map();
    }
  }

  // 4. COA map (Supabase with hardcoded fallback)
  const coaMap = await loadSpaCoaFromSupabase() ?? COA_MAP;

  // 5. Revenue ratios (for sales_ratio splits) — from tagged revenue
  const revBySlug: Record<string, number> = Object.fromEntries(spaSlugs.map(s => [s, 0]));
  let totalRev = 0;
  for (const opt of tagOptions.filter(t => t.slug !== "hq")) {
    const codeMap = taggedBySlug[opt.slug] ?? new Map();
    const rev = Array.from(codeMap.entries())
      .filter(([k]) => {
        const acc = totalAccounts.find(a => (a.code || a.name) === k);
        return acc?.section === "income";
      })
      .reduce((s, [, v]) => s + v, 0);
    revBySlug[opt.slug] = rev;
    totalRev += rev;
  }
  // Fallback: equal share if no revenue tagged
  if (totalRev === 0) {
    for (const s of spaSlugs) revBySlug[s] = 1;
    totalRev = spaSlugs.length;
  }
  const revPct: Record<string, number> = Object.fromEntries(
    spaSlugs.map(s => [s, (revBySlug[s] ?? 0) / totalRev])
  );

  // 6. Salary ratios (for salary_cost splits)
  const salBySlug: Record<string, number> = Object.fromEntries(spaSlugs.map(s => [s, 0]));
  let totalSal = 0;
  for (const acc of totalAccounts) {
    const slug = SALARY_RATIO_CODES[acc.code];
    if (slug) { salBySlug[slug] = (salBySlug[slug] ?? 0) + acc.amount; totalSal += acc.amount; }
  }
  if (totalSal === 0) totalSal = 1;
  const salPct: Record<string, number> = Object.fromEntries(
    spaSlugs.map(s => [s, (salBySlug[s] ?? 0) / totalSal])
  );

  // 7. Build account rows — non-excluded accounts only
  const VALID_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);

  const accountRows: AccountRow[] = [];

  for (const acc of totalAccounts) {
    if (acc.amount === 0) continue;

    let rule: string, line: string;
    if (acc.code && acc.code in coaMap) {
      [rule, line] = coaMap[acc.code];
    } else if (acc.section === "income") {
      rule = "sales_ratio"; line = "revenue";
    } else {
      rule = "equal"; line = detectLineFromName(acc.name, acc.section);
    }

    // Skip excluded and unmapped accounts
    if (line === "excluded" || !VALID_LINES.has(line.replace(/^sga_.*/, "sga"))) continue;
    if (line.startsWith("sga_")) line = "sga";

    const key = acc.code || acc.name;

    // Tagged amounts per venue
    const venueAmounts: Record<string, number> = Object.fromEntries(allSlugs.map(s => [s, 0]));
    let taggedTotal = 0;
    for (const [slug, codeMap] of Object.entries(taggedBySlug)) {
      const amt = codeMap.get(key) ?? 0;
      venueAmounts[slug] = amt;
      taggedTotal += amt;
    }

    // Untagged → split rules
    const untaggedAmount = Math.max(0, acc.amount - taggedTotal);
    if (untaggedAmount > 0) {
      if (rule === "hq") {
        venueAmounts["hq"] = (venueAmounts["hq"] ?? 0) + untaggedAmount;
      } else {
        const loc           = detectLocation(acc.name);
        const effectiveRule = loc ?? rule;
        const dist          = applyRule(effectiveRule, untaggedAmount, revPct, salPct, spaSlugs);
        for (const [s, share] of Object.entries(dist)) {
          venueAmounts[s] = (venueAmounts[s] ?? 0) + share;
        }
      }
    }

    accountRows.push({
      code:           acc.code,
      name:           acc.name,
      section:        acc.section,
      ebitda_line:    line,
      split_rule:     rule,
      total:          acc.amount,
      tagged_total:   taggedTotal,
      untagged_amount: untaggedAmount,
      venue_amounts:  venueAmounts,
    });
  }

  // Sort by EBITDA line order, then name
  accountRows.sort((a, b) => {
    const ai = EBITDA_LINE_ORDER.indexOf(a.ebitda_line);
    const bi = EBITDA_LINE_ORDER.indexOf(b.ebitda_line);
    if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });

  log.push(`Done: ${accountRows.length} non-excluded account rows`);
  return { tag_options: tagOptions, venue_slugs: allSlugs, accounts: accountRows, period: { from_date: fromDate, to_date: toDate }, log };
}
