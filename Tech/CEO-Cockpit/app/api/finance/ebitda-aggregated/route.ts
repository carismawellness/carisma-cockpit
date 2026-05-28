/**
 * /api/finance/ebitda-aggregated
 *
 * Aggregates EBITDA data for the new EBITDA dashboard (Phase 4 rebuild).
 * Reads per-row per-date data from the "Aggregated Data" tab in the
 * Accounting Master Google Sheet via the existing Apps Script Web App,
 * then applies TTM-spread / manual-annual / disabled fallback rules from
 * the `ebitda_fallback_rules` Supabase table.
 *
 * Query params:
 *   • date_from  (required, YYYY-MM-DD)
 *   • date_to    (required, YYYY-MM-DD, inclusive)
 *   • brand      (optional, "SPA" | "AES" | "SLIM" | "HQ" — case-insensitive;
 *                 omit for all brands)
 *
 * Response: see `EbitdaAggregatedResponse` below.
 *
 * NOTE: this route does NOT touch the EBIDA Layer merge path, the parser,
 * or the existing EBITDA page. It is a pure read-side aggregator.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
// Force dynamic — query params + external fetch make caching unsafe.
export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────────

type Brand    = "SPA" | "AES" | "SLIM" | "HQ";
type ZohoOrg  = "spa" | "aesthetics";
type RuleType =
  | "ttm_spread"
  | "manual_annual"
  | "previous_month"
  | "quarterly_average"
  | "disabled";

interface FallbackRuleRow {
  account_code: string;
  account_name: string;
  zoho_org:     ZohoOrg;
  rule_type:    RuleType;
  active:       boolean;
  params:       { annual_amount?: number } | null;
}

/** One row coming back from the Apps Script aggregated-period endpoint. */
interface AggregatedSheetRow {
  brand:           string;          // "SPA" | "Aesthetics" | "Slimming" | "HQ"
  line_item:       string;
  account_code:    string;
  ebitda_category: string;
  venue:           string;
  contact:         string;
  allocation:      string;
  daily:           Record<string, number>;   // ISO date → signed value
}

interface AggregatedSheetResponse {
  org:        string;
  date_from:  string;
  date_to:    string;
  rows:       AggregatedSheetRow[];
  dates:      string[];
  error?:     string;
}

interface CellTotal {
  value:                  number;
  has_fallback:           boolean;
  fallback_account_count: number;
}

interface FallbackApplied {
  brand:           Brand;
  account_code:    string;
  account_name:    string;
  ebitda_category: string;
  rule_type:       RuleType;
  period_value:    number;
  method_detail:   string;
}

// One row in the detailed breakdown — every account that contributed to a
// brand × category total, with the literal Zoho sum and the post-fallback
// period value. Consumed by the export tab to render an audit trail.
interface LineItem {
  brand:           Brand;          // post-HQ-venue override
  zoho_org:        ZohoOrg;        // source spreadsheet (spa | aesthetics)
  account_code:    string;
  account_name:    string;
  ebitda_category: string;
  venue:           string;
  contact:         string;
  // Canonical advertising channel bucket resolved from `contact` via the
  // advertising_contact_mapping table. Set only when ebitda_category =
  // "advertising". null otherwise OR when no pattern matches (caller renders
  // null-channel ad rows under "Misc").
  ad_channel:      string | null;
  allocation:      string;
  literal_sum:     number;
  period_value:    number;          // value used in totals (after fallback)
  used_fallback:   boolean;
  rule_type:       RuleType | null;
  method_detail:   string | null;
}

interface AdContactPattern {
  pattern:   string;   // lowercased substring
  canonical: string;   // "Meta" | "Google" | "Klaviyo" | "GHL" | …
  priority:  number;
}

export interface EbitdaAggregatedResponse {
  date_from:        string;
  date_to:          string;
  days_in_period:   number;
  brands:           Brand[];
  categories:       string[];
  totals:           Record<Brand, Record<string, CellTotal>>;
  // Per-venue breakdown keyed by brand → venue display name (column E) →
  // category. AES/SLIM rows usually carry an empty / dept-specific venue
  // value; consumers can collapse all venues under those brands into a
  // single row if they want a dept-level view.
  venue_totals:     Record<Brand, Record<string, Record<string, CellTotal>>>;
  fallback_applied: FallbackApplied[];
  // Full per-account detail — every row that flowed into totals.
  line_items:       LineItem[];
  warnings:         string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwU345ph3xkGH7cHQWze7wm1Bepyr-2ATFYpFnusRbGgjIGtVLIDBC_jL6NT1McJksN/exec";
const APPS_SCRIPT_TOKEN = "cbk-ebida-a7f3e91c2d";

// Brand display ↔ Brand code ↔ Zoho org mappings.
const BRAND_DISPLAY_TO_CODE: Record<string, Brand> = {
  spa:        "SPA",
  aesthetics: "AES",
  aes:        "AES",
  slimming:   "SLIM",
  slim:       "SLIM",
  hq:         "HQ",
};

// Which Apps-Script org param feeds each brand. Aesthetics + Slimming + HQ
// all live inside the Aesthetics org's Aggregated Data tab; SPA stands alone.
const BRAND_TO_ORG_PARAM: Record<Brand, "SPA" | "Aesthetics"> = {
  SPA:  "SPA",
  AES:  "Aesthetics",
  SLIM: "Aesthetics",
  HQ:   "Aesthetics",
};

const ALL_BRANDS: readonly Brand[] = ["SPA", "AES", "SLIM", "HQ"] as const;

// ── Utility helpers ──────────────────────────────────────────────────────────

function isoToDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function daysBetweenInclusive(fromIso: string, toIso: string): number {
  const ms = isoToDate(toIso).getTime() - isoToDate(fromIso).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function shiftIso(iso: string, deltaDays: number): string {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Last day of the month containing `iso` (yyyy-mm-dd). */
function endOfMonth(iso: string): string {
  const d = isoToDate(iso);
  // Day 0 of next month = last day of this month.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}

/** First day of the month containing `iso`. */
function startOfMonth(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

/** Number of days in the calendar month of `iso`. */
function daysInMonthOf(iso: string): number {
  const last = endOfMonth(iso);
  return Number(last.slice(8, 10));
}

/**
 * Previous full calendar month before `dateFrom`. E.g., dateFrom=2026-01-15 →
 * {from: "2025-12-01", to: "2025-12-31", days: 31}.
 */
function previousCalendarMonth(dateFrom: string): { from: string; to: string; days: number } {
  // Walk to first day of dateFrom's month, then subtract one day to land in
  // the previous month, then take that month's start + end.
  const firstOfThis = startOfMonth(dateFrom);
  const lastOfPrev  = shiftIso(firstOfThis, -1);
  return {
    from: startOfMonth(lastOfPrev),
    to:   lastOfPrev,
    days: daysInMonthOf(lastOfPrev),
  };
}

/**
 * Last N full calendar months before `dateFrom`. Returns the inclusive ISO
 * bounds [from, to] and the total day count across those N months.
 */
function lastNCalendarMonths(dateFrom: string, n: number): { from: string; to: string; days: number } {
  const firstOfThis = startOfMonth(dateFrom);
  // Walk back N months from the first of dateFrom's month.
  const d = isoToDate(firstOfThis);
  d.setUTCMonth(d.getUTCMonth() - n);
  const from = d.toISOString().slice(0, 10);
  const to   = shiftIso(firstOfThis, -1);
  return {
    from,
    to,
    days: daysBetweenInclusive(from, to),
  };
}

function normalizeBrand(raw: string | null | undefined): Brand | null {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  return BRAND_DISPLAY_TO_CODE[k] ?? null;
}

function brandDisplayToCode(brand: string): Brand | null {
  const k = String(brand).trim().toLowerCase();
  return BRAND_DISPLAY_TO_CODE[k] ?? null;
}

function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = isoToDate(s);
  return !isNaN(d.getTime());
}

// ── Apps Script fetch with retry/backoff ─────────────────────────────────────

const FETCH_TIMEOUT_MS = 90_000;     // per attempt; Apps Script can be slow
const FETCH_MAX_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = [0, 2_000, 5_000];

async function fetchAggregatedSheet(
  orgParam: "SPA" | "Aesthetics",
  fromIso:  string,
  toIso:    string,
): Promise<AggregatedSheetResponse> {
  const url =
    `${APPS_SCRIPT_URL}?token=${encodeURIComponent(APPS_SCRIPT_TOKEN)}` +
    `&action=aggregated_period&org=${encodeURIComponent(orgParam)}` +
    `&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < FETCH_MAX_ATTEMPTS; attempt++) {
    if (FETCH_BACKOFF_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, FETCH_BACKOFF_MS[attempt]));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method:  "GET",
        signal:  controller.signal,
        headers: { Accept: "application/json" },
        cache:   "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`Apps Script HTTP ${res.status}`);
      }
      const text = await res.text();
      // Apps Script may return the legacy text response if the action param
      // is not yet deployed — guard the parse.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `Apps Script non-JSON response (action=aggregated_period not deployed?) — ${text.slice(0, 200)}`,
        );
      }
      const obj = parsed as Partial<AggregatedSheetResponse>;
      if (obj && typeof obj === "object" && obj.error) {
        throw new Error(`Apps Script error: ${obj.error}`);
      }
      if (!obj || !Array.isArray(obj.rows) || !Array.isArray(obj.dates)) {
        throw new Error(
          `Apps Script returned unexpected shape — ${text.slice(0, 200)}`,
        );
      }
      return obj as AggregatedSheetResponse;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
    }
  }
  throw new Error(
    `fetchAggregatedSheet(${orgParam}, ${fromIso} → ${toIso}) failed after ` +
    `${FETCH_MAX_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// ── Fallback rule loader ─────────────────────────────────────────────────────

async function loadFallbackRules(): Promise<Map<string, FallbackRuleRow>> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("ebitda_fallback_rules")
    .select("zoho_org, account_code, account_name, rule_type, active, params");
  if (error) {
    throw new Error(`ebitda_fallback_rules load failed: ${error.message}`);
  }
  const map = new Map<string, FallbackRuleRow>();
  for (const r of (data ?? []) as FallbackRuleRow[]) {
    map.set(`${r.zoho_org}|${r.account_code}`, r);
  }
  return map;
}

// Loads contact-name patterns sorted by priority ASC (more specific wins).
// Failure is non-fatal — the dashboard just shows every ad row under "Misc".
async function loadAdContactPatterns(): Promise<AdContactPattern[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("advertising_contact_mapping")
    .select("pattern, canonical, priority")
    .order("priority", { ascending: true });
  if (error) return [];
  return (data ?? []).map(r => ({
    pattern:   String(r.pattern || "").toLowerCase(),
    canonical: String(r.canonical || ""),
    priority:  Number(r.priority ?? 100),
  })).filter(p => p.pattern && p.canonical);
}

function resolveAdChannel(contact: string, patterns: AdContactPattern[]): string | null {
  if (!contact) return null;
  const c = contact.toLowerCase();
  for (const p of patterns) {            // patterns already sorted by priority ASC
    if (c.includes(p.pattern)) return p.canonical;
  }
  return null;
}

// ── Row-summation helpers ────────────────────────────────────────────────────

function sumDailyInRange(daily: Record<string, number>, fromIso: string, toIso: string): number {
  let total = 0;
  for (const iso in daily) {
    if (iso < fromIso || iso > toIso) continue;
    const v = daily[iso];
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

/** Sum of daily values + count of distinct months touched (for annualization). */
function sumAndMonthsTouched(
  daily: Record<string, number>,
  fromIso: string,
  toIso: string,
): { total: number; monthsTouched: number } {
  const months = new Set<string>();
  let total = 0;
  for (const iso in daily) {
    if (iso < fromIso || iso > toIso) continue;
    const v = daily[iso];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
      months.add(iso.slice(0, 7));
      total += v;
    }
  }
  return { total, monthsTouched: months.size };
}

// ── Core handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom   = searchParams.get("date_from");
  const dateTo     = searchParams.get("date_to");
  const brandParam = searchParams.get("brand");

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "date_from and date_to are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    return NextResponse.json(
      { error: "date_from and date_to must be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (dateFrom > dateTo) {
    return NextResponse.json(
      { error: "date_from must be on or before date_to" },
      { status: 400 },
    );
  }

  const brandFilter: Brand | null = brandParam ? normalizeBrand(brandParam) : null;
  if (brandParam && !brandFilter) {
    return NextResponse.json(
      { error: `Unknown brand "${brandParam}". Allowed: SPA, AES, SLIM, HQ.` },
      { status: 400 },
    );
  }

  const warnings: string[] = [];
  const daysInPeriod = daysBetweenInclusive(dateFrom, dateTo);

  // Which Apps-Script orgs to query (deduplicated). SPA brand → SPA org;
  // AES/SLIM/HQ → Aesthetics org. No brand filter → both.
  const orgsToFetch = new Set<"SPA" | "Aesthetics">();
  if (brandFilter) {
    orgsToFetch.add(BRAND_TO_ORG_PARAM[brandFilter]);
  } else {
    orgsToFetch.add("SPA");
    orgsToFetch.add("Aesthetics");
  }

  // Compute the TTM window. Capped at 2024-01-01 since we have no prior history.
  const ttmFromRequested = shiftIso(dateFrom, -365);
  const ttmFrom = ttmFromRequested < "2024-01-01" ? "2024-01-01" : ttmFromRequested;
  const ttmTo   = shiftIso(dateFrom, -1);  // day before period start

  // 1) Period rows + TTM rows from Apps Script, in parallel per org.
  type OrgFetchResult = {
    orgParam: "SPA" | "Aesthetics";
    period:   AggregatedSheetResponse;
    ttm:      AggregatedSheetResponse | null;
  };
  let orgResults: OrgFetchResult[];
  try {
    orgResults = await Promise.all(
      Array.from(orgsToFetch).map(async (orgParam) => {
        const periodP = fetchAggregatedSheet(orgParam, dateFrom, dateTo);
        // Skip TTM fetch if the period start IS the TTM start (zero-width window).
        const ttmP = ttmTo >= ttmFrom
          ? fetchAggregatedSheet(orgParam, ttmFrom, ttmTo).catch((e: unknown) => {
              warnings.push(
                `TTM fetch failed for ${orgParam} (${ttmFrom} → ${ttmTo}): ${e instanceof Error ? e.message : String(e)} — TTM-spread rules will fall back to literal sums.`,
              );
              return null;
            })
          : Promise.resolve(null);
        const [period, ttm] = await Promise.all([periodP, ttmP]);
        return { orgParam, period, ttm };
      }),
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Apps Script fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // 2) Load fallback rules + advertising contact patterns from Supabase
  //    in parallel. Contact-pattern load failures degrade gracefully:
  //    advertising rows just won't carry a channel (UI shows Misc).
  let rules: Map<string, FallbackRuleRow>;
  let adPatterns: AdContactPattern[];
  try {
    [rules, adPatterns] = await Promise.all([
      loadFallbackRules(),
      loadAdContactPatterns(),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Determine whether this is a "whole calendar months" period. If both
  // endpoints align to month boundaries, every line item already has its
  // real booked total inside the window — fallback smoothing would
  // OVERWRITE that with TTM / previous-month estimates (which can be zero
  // when there's no prior history, e.g. running 2025 with no 2024 in the
  // data). For full-period runs we want the literal sum; fallback rules
  // only fire on partial periods, matching the original product intent.
  const periodIsFullCalendarMonths =
    dateFrom === startOfMonth(dateFrom) && dateTo === endOfMonth(dateTo);

  // 3) Aggregate per (brand, ebitda_category) with fallback rules applied.
  const totals: Record<Brand, Record<string, CellTotal>> = {
    SPA: {}, AES: {}, SLIM: {}, HQ: {},
  };
  // Per-venue accumulator: brand → venue display name → category → cell.
  const venueTotals: Record<Brand, Record<string, Record<string, CellTotal>>> = {
    SPA: {}, AES: {}, SLIM: {}, HQ: {},
  };
  const fallbackApplied: FallbackApplied[] = [];
  // Audit-trail: every row that fed into totals. Used to render the
  // "Detailed Line Items" section of the EBITDA Export tab.
  const lineItems: LineItem[] = [];
  const seenCategories = new Set<string>();
  const seenBrands = new Set<Brand>();

  for (const { orgParam, period, ttm } of orgResults) {
    // Build a TTM index keyed by (account_code, brand-code, venue, contact, allocation, line_item)
    // → daily map, so we can look up the same row's TTM history.
    const ttmIndex = new Map<string, Record<string, number>>();
    if (ttm) {
      for (const row of ttm.rows) {
        const raw = brandDisplayToCode(row.brand);
        if (!raw) continue;
        // Mirror the venue=HQ override used during period aggregation, so
        // TTM keys match on both sides for HQ-venue rows that physically
        // live in the SPA org.
        const code: Brand = (row.venue || "").trim().toLowerCase() === "hq" ? "HQ" : raw;
        const key = `${code}|${row.account_code}|${row.line_item}|${row.venue}|${row.contact}|${row.allocation}`;
        // Merge in case multiple TTM rows collapse to the same key.
        const existing = ttmIndex.get(key);
        if (existing) {
          for (const iso in row.daily) {
            existing[iso] = (existing[iso] ?? 0) + row.daily[iso];
          }
        } else {
          ttmIndex.set(key, { ...row.daily });
        }
      }
    }

    for (const row of period.rows) {
      const rawBrand = brandDisplayToCode(row.brand);
      if (!rawBrand) continue;

      // Column E (venue) = "HQ" is the user's corporate-cost marker.
      // Re-route such rows to the HQ brand regardless of column A. This is
      // how Director Salaries, Professional Services, Bank Fees etc.
      // booked inside the SPA org end up under HQ in the dashboard.
      const isHqVenue = (row.venue || "").trim().toLowerCase() === "hq";
      const brand: Brand = isHqVenue ? "HQ" : rawBrand;

      if (brandFilter && brand !== brandFilter) continue;

      const category = (row.ebitda_category || "uncategorized").toLowerCase();
      const literalSum = sumDailyInRange(row.daily, dateFrom, dateTo);

      // Fallback rule lookup uses the ORG the row came from (orgParam),
      // not the post-override brand, so the rules table key stays correct
      // for HQ-venue rows that physically live in the SPA org.
      const zohoOrg: ZohoOrg = orgParam === "SPA" ? "spa" : "aesthetics";
      const rule = row.account_code
        ? rules.get(`${zohoOrg}|${row.account_code}`)
        : undefined;

      let periodValue = literalSum;
      let usedFallback = false;
      let appliedRuleType: RuleType | null = null;
      let appliedMethodDetail: string | null = null;

      // Fallback rules only apply on partial periods. On a full
      // calendar-months range, the literal sum is the ground truth and we
      // must not overwrite it with an estimate.
      if (!periodIsFullCalendarMonths && rule && rule.active && rule.rule_type !== "disabled") {
        if (rule.rule_type === "manual_annual") {
          const annual = rule.params?.annual_amount;
          if (typeof annual === "number" && Number.isFinite(annual)) {
            periodValue = annual * (daysInPeriod / 365);
            usedFallback = true;
            appliedRuleType = "manual_annual";
            appliedMethodDetail = `Manual annual €${annual.toFixed(2)} × ${daysInPeriod}/365`;
            fallbackApplied.push({
              brand,
              account_code:    row.account_code,
              account_name:    row.line_item,
              ebitda_category: category,
              rule_type:       "manual_annual",
              period_value:    periodValue,
              method_detail:   appliedMethodDetail,
            });
          } else {
            // Rule says manual_annual but no amount — keep literal, flag warning.
            warnings.push(
              `Account ${row.account_code} (${brand}) has rule_type=manual_annual but no params.annual_amount — used literal sum.`,
            );
          }
        } else if (rule.rule_type === "ttm_spread") {
          if (ttm) {
            const ttmKey = `${brand}|${row.account_code}|${row.line_item}|${row.venue}|${row.contact}|${row.allocation}`;
            const ttmDaily = ttmIndex.get(ttmKey);
            if (ttmDaily) {
              const { total, monthsTouched } = sumAndMonthsTouched(ttmDaily, ttmFrom, ttmTo);
              // Annualize: scale total to 12 months when we have <12 months of history.
              const annualEstimate = monthsTouched > 0
                ? total * (12 / Math.min(12, monthsTouched))
                : 0;
              periodValue = annualEstimate * (daysInPeriod / 365);
              usedFallback = true;
              appliedRuleType = "ttm_spread";
              appliedMethodDetail =
                `TTM €${total.toFixed(2)} over ${monthsTouched} mo` +
                ` → annualized €${annualEstimate.toFixed(2)} × ${daysInPeriod}/365`;
              fallbackApplied.push({
                brand,
                account_code:    row.account_code,
                account_name:    row.line_item,
                ebitda_category: category,
                rule_type:       "ttm_spread",
                period_value:    periodValue,
                method_detail:   appliedMethodDetail,
              });
            }
            // No TTM history for this row key → keep literal, no fallback flag.
          }
          // If ttm fetch failed entirely, we already warned above.
        } else if (rule.rule_type === "previous_month") {
          if (ttm) {
            const ttmKey = `${brand}|${row.account_code}|${row.line_item}|${row.venue}|${row.contact}|${row.allocation}`;
            const ttmDaily = ttmIndex.get(ttmKey);
            if (ttmDaily) {
              const pm = previousCalendarMonth(dateFrom);
              const pmSum = sumDailyInRange(ttmDaily, pm.from, pm.to);
              periodValue = pmSum * (daysInPeriod / pm.days);
              usedFallback = true;
              appliedRuleType = "previous_month";
              appliedMethodDetail =
                `Prev-month (${pm.from}…${pm.to}) €${pmSum.toFixed(2)}` +
                ` × ${daysInPeriod}/${pm.days}`;
              fallbackApplied.push({
                brand,
                account_code:    row.account_code,
                account_name:    row.line_item,
                ebitda_category: category,
                rule_type:       "previous_month",
                period_value:    periodValue,
                method_detail:   appliedMethodDetail,
              });
            }
          }
        } else if (rule.rule_type === "quarterly_average") {
          if (ttm) {
            const ttmKey = `${brand}|${row.account_code}|${row.line_item}|${row.venue}|${row.contact}|${row.allocation}`;
            const ttmDaily = ttmIndex.get(ttmKey);
            if (ttmDaily) {
              const q = lastNCalendarMonths(dateFrom, 3);
              const qSum = sumDailyInRange(ttmDaily, q.from, q.to);
              // User spec: literal "/ 90 × days_in_period". We use the actual
              // day count of those 3 months (88-92) so leap months don't bias.
              periodValue = qSum / q.days * daysInPeriod;
              usedFallback = true;
              appliedRuleType = "quarterly_average";
              appliedMethodDetail =
                `Last 3 mo (${q.from}…${q.to}) €${qSum.toFixed(2)}` +
                ` / ${q.days} × ${daysInPeriod}`;
              fallbackApplied.push({
                brand,
                account_code:    row.account_code,
                account_name:    row.line_item,
                ebitda_category: category,
                rule_type:       "quarterly_average",
                period_value:    periodValue,
                method_detail:   appliedMethodDetail,
              });
            }
          }
        }
      }

      // Accumulate into totals[brand][category].
      seenBrands.add(brand);
      seenCategories.add(category);
      const cell = totals[brand][category] ?? {
        value:                  0,
        has_fallback:           false,
        fallback_account_count: 0,
      };
      cell.value += periodValue;
      if (usedFallback) {
        cell.has_fallback = true;
        cell.fallback_account_count += 1;
      }
      totals[brand][category] = cell;

      // Also accumulate into venueTotals[brand][venue][category]. Empty
      // venue strings are bucketed under "" so consumers can detect rows
      // that lack a venue tag without inventing a sentinel string.
      const venueKey = (row.venue || "").trim();
      const venueBucket = venueTotals[brand][venueKey] ?? {};
      const venueCell = venueBucket[category] ?? {
        value:                  0,
        has_fallback:           false,
        fallback_account_count: 0,
      };
      venueCell.value += periodValue;
      if (usedFallback) {
        venueCell.has_fallback = true;
        venueCell.fallback_account_count += 1;
      }
      venueBucket[category] = venueCell;
      venueTotals[brand][venueKey] = venueBucket;

      // Audit-trail entry. Skip rows that contributed exactly zero on
      // BOTH the literal and post-fallback sides; they only clutter the
      // export tab.
      if (literalSum !== 0 || periodValue !== 0) {
        const adChannel = category === "advertising"
          ? resolveAdChannel(row.contact || "", adPatterns)
          : null;
        lineItems.push({
          brand,
          zoho_org:        zohoOrg,
          account_code:    row.account_code,
          account_name:    row.line_item,
          ebitda_category: category,
          venue:           row.venue || "",
          contact:         row.contact || "",
          ad_channel:      adChannel,
          allocation:      row.allocation || "",
          literal_sum:     literalSum,
          period_value:    periodValue,
          used_fallback:   usedFallback,
          rule_type:       appliedRuleType,
          method_detail:   appliedMethodDetail,
        });
      }
    }

    // Reference orgParam so TS doesn't flag it as unused even when we don't
    // branch on it (logic above already handles per-row brand routing).
    void orgParam;
  }

  // Sort brands and categories for stable response shape.
  const responseBrands = ALL_BRANDS.filter(b => seenBrands.has(b));
  const responseCategories = Array.from(seenCategories).sort();

  const response: EbitdaAggregatedResponse = {
    date_from:        dateFrom,
    date_to:          dateTo,
    days_in_period:   daysInPeriod,
    brands:           responseBrands,
    categories:       responseCategories,
    totals,
    venue_totals:     venueTotals,
    fallback_applied: fallbackApplied,
    line_items:       lineItems,
    warnings,
  };
  return NextResponse.json(response);
}
