import { ZohoBooksClient } from "./zoho-client";
import { fetchPlAccounts } from "./zoho-pl-parser";
import { DailyRow } from "./zoho-transactions-daily";

// ─────────────────────────────────────────────────────────────────────────────
// Zoho Profit & Loss reconciliation
//
// VISIBILITY-ONLY cross-check between the daily-granular transaction layer
// (built from invoices/bills/expenses/creditnotes/vendorcredits/journals +
// supplementary `reports/journal` + Cockpit POS feeds) and Zoho's authoritative
// `reports/profitandloss` for the same window. Any drift surfaces in
// `result.log` and `result.reconciliation` on every pull so we catch it
// immediately instead of debugging downstream.
//
// Design rules:
//   • NEVER block the write. Wrap the whole pass in try/catch upstream;
//     here we just compute deterministically.
//   • Tolerance default: €1.00 ABSOLUTE per-account (not a percentage —
//     tiny accounts would falsely match at any percentage).
//   • Compare absolute amounts. Zoho's P&L report returns positive totals
//     in both income and expense sections; our DailyRow.daily values are
//     already signed-positive (income revenue ≥ 0, expense cost ≥ 0)
//     thanks to the line-extractor's sign-multiplier handling.
//   • Filter zero-amount rows on both sides before comparing.
//   • Skip API-side sentinel codes (COCKPIT_SPA_REV / POS_*_REV) that are
//     intentional Cockpit-only additions with no P&L equivalent.
// ─────────────────────────────────────────────────────────────────────────────

export type PlReconcileResult = {
  matched:    Array<{ account_code: string; account_name: string; api: number; pl: number; diff: number }>;
  mismatches: Array<{ account_code: string; account_name: string; api: number; pl: number; diff: number }>;
  inApiOnly:  Array<{ account_code: string; account_name: string; api: number }>;
  inPlOnly:   Array<{ account_code: string; account_name: string; pl: number; intentionallyExcluded: boolean }>;
  toleranceEur: number;
  summary:    string;       // one-line summary safe for a status cell
};

// API-side sentinel codes that never appear in Zoho's P&L — they are
// authoritative Cockpit additions layered on top of the Zoho data. Listing
// them keeps the "in API only" section uncluttered (it would otherwise
// always report these as drift).
const API_SENTINEL_CODES = new Set<string>([
  "COCKPIT_SPA_REV",      // SPA Cockpit POS revenue
  "POS_AES_REV",    // Aesthetics POS revenue
  "POS_SLIM_REV",   // Slimming POS revenue
  "SUPP_SAL",       // Supplementary salary (Cockpit salary_supplement_monthly)
]);

const DEFAULT_TOLERANCE_EUR = 1.0;

// ─────────────────────────────────────────────────────────────────────────────
// P&L fetch — returns Map<account_code, { account_name, amount }>
//
// Flattens the hierarchical `reports/profitandloss` response. The shared
// `fetchPlAccounts` helper in zoho-pl-parser.ts already walks the recursive
// `account_transactions` structure across all sections (income / cogs /
// expense / other_income / other_expense) and returns absolute-value totals
// per account. We sum across all sections by account_code (codes are
// already unique across sections in Zoho).
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchZohoProfitAndLoss(
  client:   ZohoBooksClient,
  fromDate: string,
  toDate:   string,
): Promise<Map<string, { account_name: string; amount: number }>> {
  const accounts = await fetchPlAccounts(client, fromDate, toDate);
  const out = new Map<string, { account_name: string; amount: number }>();
  for (const a of accounts) {
    const code = String(a.code ?? "").trim();
    // P&L sometimes returns a parent grouping row (e.g. plain "Sales")
    // with no account_code — skip; only per-account leaves can be matched.
    if (!code) continue;
    const amount = Number(a.amount ?? 0);
    if (!amount) continue;
    const existing = out.get(code);
    if (existing) {
      existing.amount += amount;
    } else {
      out.set(code, { account_name: a.name, amount });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reconcileApiVsPl(
  apiRows:                   DailyRow[],
  pl:                        Map<string, { account_name: string; amount: number }>,
  intentionallyExcludedCodes: Set<string>,
  toleranceEur:              number = DEFAULT_TOLERANCE_EUR,
): PlReconcileResult {
  // 1. Aggregate API totals by account_code, summing across venues + days.
  //    Sum SIGNED values first so positive expenses and negative refund/credit
  //    lines net correctly per account; only then take absolute value once at
  //    the end to match P&L's section-positive convention. Taking abs per row
  //    would stack positives and negatives instead of netting them (e.g. a
  //    +€34.72 expense + a -€114.95 expense_refund would sum to €149.68
  //    instead of the correct net €80.23).
  const apiByCode = new Map<string, { account_name: string; amount: number }>();
  for (const row of apiRows) {
    const code = String(row.account_code ?? "").trim();
    if (!code) continue;
    if (API_SENTINEL_CODES.has(code)) continue;   // skip Cockpit-only injection rows
    let dailySum = 0;
    for (const v of Object.values(row.daily)) dailySum += v;
    if (!dailySum) continue;
    const existing = apiByCode.get(code);
    if (existing) {
      existing.amount += dailySum;
    } else {
      apiByCode.set(code, { account_name: row.account_name, amount: dailySum });
    }
  }
  // Net first, abs once.
  for (const [, e] of apiByCode) e.amount = Math.abs(e.amount);

  const matched:    PlReconcileResult["matched"]    = [];
  const mismatches: PlReconcileResult["mismatches"] = [];
  const inApiOnly:  PlReconcileResult["inApiOnly"]  = [];
  const inPlOnly:   PlReconcileResult["inPlOnly"]   = [];

  // 2. Walk API codes — match against P&L, classify match vs mismatch vs api-only.
  const seenInPl = new Set<string>();
  for (const [code, apiEntry] of apiByCode) {
    const plEntry = pl.get(code);
    const apiAmt  = roundTo2(apiEntry.amount);
    if (!plEntry) {
      if (apiAmt === 0) continue;
      inApiOnly.push({ account_code: code, account_name: apiEntry.account_name, api: apiAmt });
      continue;
    }
    seenInPl.add(code);
    const plAmt = roundTo2(plEntry.amount);
    const diff  = roundTo2(apiAmt - plAmt);
    if (Math.abs(diff) <= toleranceEur) {
      matched.push({ account_code: code, account_name: apiEntry.account_name, api: apiAmt, pl: plAmt, diff });
    } else {
      mismatches.push({ account_code: code, account_name: apiEntry.account_name, api: apiAmt, pl: plAmt, diff });
    }
  }

  // 3. Walk remaining P&L codes — anything left is "P&L only" (i.e. Zoho posted
  //    something to this account but our API pipeline didn't surface it).
  for (const [code, plEntry] of pl) {
    if (seenInPl.has(code)) continue;
    const plAmt = roundTo2(plEntry.amount);
    if (plAmt === 0) continue;
    inPlOnly.push({
      account_code:           code,
      account_name:           plEntry.account_name,
      pl:                     plAmt,
      intentionallyExcluded:  intentionallyExcludedCodes.has(code),
    });
  }

  // 4. Stable sort sections — largest diff/amount first so the most material
  //    drift shows at the top of the log.
  matched.sort((a, b) => a.account_code.localeCompare(b.account_code));
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  inApiOnly.sort((a, b)  => b.api - a.api);
  inPlOnly.sort((a, b)   => Number(a.intentionallyExcluded) - Number(b.intentionallyExcluded) || b.pl - a.pl);

  const unexpectedInPl = inPlOnly.filter(x => !x.intentionallyExcluded).length;
  const intendedInPl   = inPlOnly.length - unexpectedInPl;
  const summary =
    `${matched.length} matched, ${mismatches.length} mismatch(es), ` +
    `${inApiOnly.length} API-only, ${unexpectedInPl} P&L-only-unexpected, ` +
    `${intendedInPl} P&L-only-intended` +
    ` (tolerance €${toleranceEur.toFixed(2)})`;

  return { matched, mismatches, inApiOnly, inPlOnly, toleranceEur, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pretty-printer for the log
// ─────────────────────────────────────────────────────────────────────────────

function fmtEur(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${sign}€${abs}`;
}

function fmtSignedEur(n: number): string {
  const sign = n < 0 ? "-" : "+";
  return `${sign}${fmtEur(Math.abs(n))}`;
}

export function formatReconcileLog(
  recon:    PlReconcileResult,
  org:      "spa" | "aesthetics",
  fromDate: string,
  toDate:   string,
): string[] {
  const orgLabel = org === "spa" ? "SPA" : "AES";
  const lines: string[] = [];
  lines.push(`=== P&L Reconciliation (${orgLabel} ${fromDate} → ${toDate}) ===`);
  lines.push(`  Matched: ${recon.matched.length} accounts (within ${fmtEur(recon.toleranceEur)} tolerance)`);

  if (recon.mismatches.length > 0) {
    lines.push(`  Mismatches: ${recon.mismatches.length}`);
    for (const m of recon.mismatches) {
      const codeName = `${m.account_code} ${m.account_name}`.padEnd(40).slice(0, 40);
      lines.push(
        `    ${codeName} | API ${fmtEur(m.api).padStart(12)} ` +
        `| P&L ${fmtEur(m.pl).padStart(12)} | diff ${fmtSignedEur(m.diff)}`,
      );
    }
  } else {
    lines.push(`  Mismatches: 0`);
  }

  if (recon.inApiOnly.length > 0) {
    const total = recon.inApiOnly.reduce((s, x) => s + x.api, 0);
    lines.push(`  In API only: ${recon.inApiOnly.length} accounts (${fmtEur(total)})`);
    for (const m of recon.inApiOnly) {
      const codeName = `${m.account_code} ${m.account_name}`.padEnd(40).slice(0, 40);
      lines.push(`    ${codeName} | API ${fmtEur(m.api).padStart(12)}`);
    }
  } else {
    lines.push(`  In API only: 0 accounts`);
  }

  const unexpected = recon.inPlOnly.filter(x => !x.intentionallyExcluded);
  const intended   = recon.inPlOnly.filter(x =>  x.intentionallyExcluded);
  if (unexpected.length > 0) {
    const total = unexpected.reduce((s, x) => s + x.pl, 0);
    lines.push(`  In P&L only (NOT intentionally excluded): ${unexpected.length} accounts (${fmtEur(total)})`);
    for (const m of unexpected) {
      const codeName = `${m.account_code} ${m.account_name}`.padEnd(40).slice(0, 40);
      lines.push(`    ${codeName} | P&L ${fmtEur(m.pl).padStart(12)}`);
    }
  } else {
    lines.push(`  In P&L only (NOT intentionally excluded): 0 accounts OK`);
  }
  if (intended.length > 0) {
    const total = intended.reduce((s, x) => s + x.pl, 0);
    lines.push(`  In P&L only (intentionally excluded by design): ${intended.length} accounts (${fmtEur(total)})`);
  }

  lines.push(`  Summary: ${recon.summary}`);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Excluded-code loader — pulled separately from loadSpaCoaFromSupabase /
// loadAestheticsCoaMap because both helpers drop `excluded` rows on load.
// ─────────────────────────────────────────────────────────────────────────────

export async function loadExcludedCodes(zohoOrg: "spa" | "aesthetics"): Promise<Set<string>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return new Set();
  try {
    const qs = new URLSearchParams({
      select:       "account_code",
      zoho_org:     `eq.${zohoOrg}`,
      ebitda_line:  "eq.excluded",
    });
    const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return new Set();
    const rows = (await resp.json()) as Array<Record<string, unknown>>;
    const out = new Set<string>();
    for (const r of rows) {
      const code = String(r.account_code ?? "").trim();
      if (code) out.add(code);
    }
    return out;
  } catch {
    return new Set();
  }
}
