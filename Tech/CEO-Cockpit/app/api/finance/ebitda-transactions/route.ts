/**
 * GET /api/finance/ebitda-transactions
 *
 * Transaction-level drill-down behind a single "P&L by Venue" cell on the
 * EBITDA dashboard (app/finance/ebitda/page.tsx). Given a venue × category
 * (+ optional channel / sub-bucket) and a date window, returns the individual
 * Zoho GL transactions that comprise that cost item, plus a reconciliation
 * against the dashboard cell value.
 *
 * ── How reconciliation works ────────────────────────────────────────────────
 * The dashboard cell is built from the aggregated route's `line_items` —
 * the post-allocation, post-fallback audit trail (one row per
 * account × venue × contact × allocation). We:
 *   1. Re-fetch those exact line_items for the same window (same source the
 *      cell is built from), and filter to the requested venue × category
 *      (and channel / rent-vs-utilities split when asked). The SUM of their
 *      `period_value` is the `allocated_total` — this MUST equal the cell.
 *   2. For each contributing (zoho_org, account_code) we pull the genuine GL
 *      transactions from Zoho's `chartofaccounts/transactions` endpoint and
 *      scale each by that line_item's allocation factor
 *      (period_value / literal_sum) so the listed amounts sum back to the
 *      cell contribution rather than the org-wide literal.
 *
 * Caveats (surfaced in the response so the UI can show them):
 *   • SPLIT / RATIO costs — one GL line is shared across venues by a ratio.
 *     Each listed transaction is the underlying booked amount × allocation
 *     factor; the literal Zoho amount is also returned for transparency.
 *   • FALLBACK / smoothed cells (TTM-spread, manual-annual, etc. on partial
 *     periods) and HARDWIRED rent rules (Novotel fixed, Excelsior turnover)
 *     have NO 1:1 transaction backing. We flag `reconciles=false` with a note
 *     instead of pretending the transactions add up.
 *   • Revenue from Lapis/Cockpit POS (account_code LAPIS_REV / POS_*_REV) and
 *     Salary Supplement (SUPP_SAL) are non-Zoho synthetic line items — listed
 *     as single summary rows, not Zoho transactions.
 */

import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import {
  fetchTransactionsForAccounts,
  AccountTxn,
} from "@/lib/etl/zoho-account-transactions";

// Matches the aggregated route (which this calls internally) plus headroom for
// the per-account Zoho GL pulls. Apps Script + Zoho can each take tens of seconds.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Mirror of the aggregated-route response shape (only the bits we consume).
type Brand = "SPA" | "AES" | "SLIM" | "HQ";
type ZohoOrg = "spa" | "aesthetics";

interface AggLineItem {
  brand:           Brand;
  zoho_org:        ZohoOrg;
  account_code:    string;
  account_name:    string;
  ebitda_category: string;
  venue:           string;
  contact:         string;
  ad_channel:      string | null;
  allocation:      string;
  literal_sum:     number;
  period_value:    number;
  used_fallback:   boolean;
  rule_type:       string | null;
  method_detail:   string | null;
}
interface AggResponse {
  line_items: AggLineItem[];
  warnings:   string[];
  error?:     string;
}

interface DrillTxn extends AccountTxn {
  venue:            string;        // resolved venue display for this contribution
  allocation_factor: number;       // period_value / literal_sum (1 for direct)
  allocated_amount: number;        // amount × allocation_factor (reconciles to cell)
  is_split:         boolean;       // allocation_factor !== 1 (shared cost)
  used_fallback:    boolean;       // parent line_item was fallback-smoothed
}

interface DrillResponse {
  date_from:        string;
  date_to:          string;
  brand:            string | null;
  venue:            string;        // requested venue (display) or "all"/"group"/"hq"
  category:         string;        // requested ebitda category / "advertising" / "rent" / …
  channel:          string | null; // advertising channel filter, if any
  // The dashboard cell this should equal:
  cell_total:       number;        // Σ period_value over matched line_items (= cell)
  literal_total:    number;        // Σ literal_sum over matched line_items
  txn_count:        number;
  // Sum of allocated_amount across listed Zoho transactions. Equals cell_total
  // when every contributing line is Zoho-backed & non-fallback.
  txn_allocated_total: number;
  reconciles:       boolean;       // |cell_total − txn_allocated_total| < €1
  transactions:     DrillTxn[];
  // Non-Zoho or unreconcilable contributions surfaced as summary rows so the
  // user still sees where the rest of the cell came from.
  synthetic_rows:   Array<{
    account_code: string;
    account_name: string;
    venue:        string;
    period_value: number;
    reason:       string;
  }>;
  notes:            string[];
}

// ── Category matching ────────────────────────────────────────────────────────
// A requested "category" maps to one or more ebitda_category values on the
// line_items, because the dashboard collapses some rows:
//   • "rent_plus" → rent + utilities      (the "Rent Plus" row)
//   • "rent" / "utilities" → the sub-rows
//   • "sga" → "sga" plus every "sga_*" sub-bucket  (parent SG&A row)
//   • "sga_<x>" → just that sub-bucket
//   • "advertising" → advertising (optionally filtered to a channel)
//   • "wages" / "cogs" / "revenue" → themselves
function categoryMatcher(category: string): (liCat: string) => boolean {
  const c = category.toLowerCase();
  if (c === "rent_plus" || c === "rentplus") {
    return (li) => li === "rent" || li === "utilities";
  }
  if (c === "sga") {
    return (li) => li === "sga" || li.startsWith("sga_");
  }
  return (li) => li === c;
}

// Normalise a venue display string for comparison (case / spacing insensitive).
function venueKey(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

// SPA venue display names (column E) — used to decide what the "spa-aggregate"
// collapsed column and the SPA-brand drill should include. Anything under the
// SPA brand counts; we don't need the exact list, but keep it for clarity when
// the request targets the rolled-up Spa column.
const SPA_BRAND: Brand = "SPA";

// ── Build the aggregated-route URL (internal call) ───────────────────────────
// Prefer forwarded proto/host (set by Vercel's proxy) over the raw req.url
// origin so the server-to-server call lands on the same canonical host.
function aggUrl(req: NextRequest, dateFrom: string, dateTo: string, brand: string | null): string {
  const reqUrl = new URL(req.url);
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? reqUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? reqUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  if (brand) qs.set("brand", brand);
  return `${origin}/api/finance/ebitda-aggregated?${qs.toString()}`;
}

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime());
}

export async function GET(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    return NextResponse.json(
      { error: `ebitda-transactions failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo   = searchParams.get("date_to")   ?? "";
  const brandRaw = searchParams.get("brand");           // "SPA" | "AES" | "SLIM" | "HQ" | null
  const venueRaw = searchParams.get("venue") ?? "";      // display name, or "all"/"group"/"spa-aggregate"
  const category = (searchParams.get("category") ?? "").trim();
  const channel  = searchParams.get("channel");          // advertising channel filter (Meta/Google/…)

  if (!isValidIso(dateFrom) || !isValidIso(dateTo)) {
    return NextResponse.json({ error: "date_from and date_to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "date_from must be on or before date_to" }, { status: 400 });
  }
  if (!category) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }

  const brand = brandRaw ? (brandRaw.toUpperCase() as Brand) : null;
  const notes: string[] = [];

  // 1. Pull the aggregated route's line_items (the cell's own source). Don't
  //    pass a brand filter when the drill targets the Group column — we need
  //    every brand. Otherwise filter server-side to cut payload.
  const isGroup = venueKey(venueRaw) === "group" || venueKey(venueRaw) === "all";
  const aggBrandParam = isGroup ? null : (brand ?? null);

  let agg: AggResponse;
  try {
    const res = await fetch(aggUrl(req, dateFrom, dateTo, aggBrandParam), { cache: "no-store" });
    const json = (await res.json()) as AggResponse;
    if (!res.ok || json.error) {
      throw new Error(json.error || `aggregated route HTTP ${res.status}`);
    }
    agg = json;
  } catch (e) {
    return NextResponse.json(
      { error: `Could not load aggregated line items: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // 2. Filter line_items down to the requested venue × category (+ channel).
  const matchesCat = categoryMatcher(category);
  const wantVenue  = venueKey(venueRaw);
  const drillSpaAggregate = wantVenue === "spa-aggregate" || wantVenue === "spa";

  const matched = agg.line_items.filter((li) => {
    if (!matchesCat(li.ebitda_category)) return false;

    // Brand / venue scoping
    if (isGroup) {
      // Group column = every brand + HQ for this category. No venue filter.
    } else if (brand === "HQ" || wantVenue === "hq") {
      if (li.brand !== "HQ") return false;
    } else if (drillSpaAggregate) {
      if (li.brand !== SPA_BRAND) return false;          // all SPA venues
    } else if (brand === "AES") {
      if (li.brand !== "AES") return false;
    } else if (brand === "SLIM") {
      if (li.brand !== "SLIM") return false;
    } else {
      // A specific SPA venue display name (column E).
      if (li.brand !== SPA_BRAND) return false;
      if (venueKey(li.venue) !== wantVenue) return false;
    }

    // Advertising channel sub-row filter.
    if (channel) {
      const liChannel = li.ad_channel ?? "Misc";
      if (liChannel.toLowerCase() !== channel.toLowerCase()) return false;
    }
    return true;
  });

  const cellTotal    = round2(matched.reduce((s, li) => s + li.period_value, 0));
  const literalTotal = round2(matched.reduce((s, li) => s + li.literal_sum, 0));

  if (matched.length === 0) {
    return NextResponse.json(emptyResponse(dateFrom, dateTo, brandRaw, venueRaw, category, channel,
      ["No line items contribute to this cell for the selected period."]));
  }

  // 3. Group contributing accounts by org. Skip synthetic (non-Zoho) accounts
  //    and fallback-smoothed lines — those can't be backed 1:1 by transactions.
  const SYNTHETIC_PREFIXES = ["LAPIS_REV", "POS_AES_REV", "POS_SLIM_REV", "SUPP_SAL"];
  const isSynthetic = (code: string) => SYNTHETIC_PREFIXES.some((p) => code === p);

  // Per (org, account_code) → list of matched line_items (one per venue/contact).
  // We pull transactions ONCE per (org, code) and then attribute to each
  // matched line_item's venue using its allocation factor.
  const syntheticRows: DrillResponse["synthetic_rows"] = [];
  const codesByOrg: Record<ZohoOrg, Set<string>> = { spa: new Set(), aesthetics: new Set() };
  // (org, code) → matched line items needing transactions
  const liByOrgCode = new Map<string, AggLineItem[]>();

  let hasFallbackContribution = false;

  for (const li of matched) {
    if (isSynthetic(li.account_code)) {
      syntheticRows.push({
        account_code: li.account_code,
        account_name: li.account_name,
        venue:        li.venue || (li.brand === "HQ" ? "HQ" : li.brand),
        period_value: round2(li.period_value),
        reason:       li.account_code.includes("REV")
          ? "Revenue sourced from POS (Lapis/Cockpit), not Zoho GL"
          : "Salary Supplement (Cockpit), not a Zoho posting",
      });
      continue;
    }
    if (li.used_fallback) {
      hasFallbackContribution = true;
      syntheticRows.push({
        account_code: li.account_code,
        account_name: li.account_name,
        venue:        li.venue || (li.brand === "HQ" ? "HQ" : li.brand),
        period_value: round2(li.period_value),
        reason:       `Estimated (${li.rule_type ?? "fallback"}): ${li.method_detail ?? "smoothed value, no 1:1 transactions"}`,
      });
      continue;
    }
    if (!li.account_code) continue;
    const key = `${li.zoho_org}::${li.account_code}`;
    codesByOrg[li.zoho_org].add(li.account_code);
    const arr = liByOrgCode.get(key) ?? [];
    arr.push(li);
    liByOrgCode.set(key, arr);
  }

  // 4. Pull transactions per org for the needed account codes.
  const transactions: DrillTxn[] = [];
  for (const org of ["spa", "aesthetics"] as ZohoOrg[]) {
    const codes = Array.from(codesByOrg[org]);
    if (codes.length === 0) continue;
    let pulled: { txns: AccountTxn[]; unknownCodes: string[] };
    try {
      const client = new ZohoBooksClient(org);
      pulled = await fetchTransactionsForAccounts(client, codes, dateFrom, dateTo);
    } catch (e) {
      notes.push(`Zoho pull failed for org=${org}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (pulled.unknownCodes.length) {
      notes.push(`Accounts not found in ${org} COA (no transactions listed): ${pulled.unknownCodes.join(", ")}`);
    }

    // Index raw transactions by account_code for attribution.
    const txnsByCode = new Map<string, AccountTxn[]>();
    for (const t of pulled.txns) {
      const arr = txnsByCode.get(t.account_code) ?? [];
      arr.push(t);
      txnsByCode.set(t.account_code, arr);
    }

    // For each account on this org, list its raw GL transactions ONCE, scaled
    // by an allocation factor so the listed amounts reconcile to the cell.
    //
    // factor = (Σ matched period_value for this account) / (Σ raw GL amount).
    //   • Direct / 100%-venue account → period_value ≈ raw total → factor ≈ 1.
    //   • Split / ratio account, single venue → factor = that venue's share.
    //   • spa-aggregate / Group drill → matched line_items for ALL relevant
    //     venues are summed, so factor recovers the full (un-split) amount and
    //     each transaction lists at ~100%.
    // The venue label shows the line_item's venue when unambiguous, else the
    // brand-level scope of the drill.
    for (const code of codes) {
      const lis = liByOrgCode.get(`${org}::${code}`) ?? [];
      if (lis.length === 0) continue;
      const rawTxns = txnsByCode.get(code) ?? [];
      const matchedPeriodValue = lis.reduce((s, li) => s + li.period_value, 0);
      const rawTotal = rawTxns.reduce((s, t) => s + t.amount, 0);
      const distinctVenues = new Set(lis.map(li => li.venue || lis[0].brand));
      const venueLabel = distinctVenues.size === 1
        ? (lis[0].venue || (lis[0].brand === "HQ" ? "HQ" : lis[0].brand))
        : "(multiple venues)";

      if (rawTxns.length === 0 || rawTotal === 0) {
        // Mapped & contributing but the GL endpoint returned no usable lines
        // (e.g. an invoice→COGS auto-posting that only appears in the journal
        // report, not chartofaccounts/transactions). Surface as a summary row.
        syntheticRows.push({
          account_code: code,
          account_name: lis[0].account_name,
          venue:        venueLabel,
          period_value: round2(matchedPeriodValue),
          reason:       "No individual GL lines on this account for the window (likely an auto-posting / off-ledger entry).",
        });
        continue;
      }

      const factor = matchedPeriodValue / rawTotal;
      const isSplit = Math.abs(factor - 1) > 0.005;
      for (const t of rawTxns) {
        transactions.push({
          ...t,
          venue:             venueLabel,
          allocation_factor: round4(factor),
          allocated_amount:  round2(t.amount * factor),
          is_split:          isSplit,
          used_fallback:     false,
        });
      }
    }
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date) || b.allocated_amount - a.allocated_amount);

  const txnAllocatedTotal = round2(transactions.reduce((s, t) => s + t.allocated_amount, 0));
  const syntheticTotal    = round2(syntheticRows.reduce((s, r) => s + r.period_value, 0));
  const accountedTotal    = round2(txnAllocatedTotal + syntheticTotal);
  const reconciles        = Math.abs(accountedTotal - cellTotal) < 1;

  if (hasFallbackContribution) {
    notes.push("Some contributions are fallback-estimated (partial period) and have no 1:1 transactions — shown as summary rows.");
  }
  if (transactions.some((t) => t.is_split)) {
    notes.push("Split/ratio-allocated costs: listed amounts are the booked GL value × the venue allocation factor. The raw Zoho amount is shown alongside.");
  }
  if (!reconciles) {
    notes.push(`Listed transactions (€${accountedTotal.toFixed(2)}) do not fully reconcile to the cell (€${cellTotal.toFixed(2)}). Difference may be auto-postings, hardwired rent rules, or fallback smoothing.`);
  }

  const response: DrillResponse = {
    date_from:           dateFrom,
    date_to:             dateTo,
    brand:               brandRaw,
    venue:               venueRaw || "all",
    category,
    channel:             channel ?? null,
    cell_total:          cellTotal,
    literal_total:       literalTotal,
    txn_count:           transactions.length,
    txn_allocated_total: txnAllocatedTotal,
    reconciles,
    transactions,
    synthetic_rows:      syntheticRows,
    notes,
  };
  return NextResponse.json(response);
}

function emptyResponse(
  dateFrom: string, dateTo: string, brand: string | null,
  venue: string, category: string, channel: string | null, notes: string[],
): DrillResponse {
  return {
    date_from: dateFrom, date_to: dateTo, brand, venue: venue || "all", category,
    channel: channel ?? null, cell_total: 0, literal_total: 0, txn_count: 0,
    txn_allocated_total: 0, reconciles: true, transactions: [], synthetic_rows: [], notes,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
