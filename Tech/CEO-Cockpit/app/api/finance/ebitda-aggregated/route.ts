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
  canonical: string;   // "Meta" | "Google" | "Klaviyo" | …
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

// Hardwired SPA rent rules that never come from Zoho and cannot be expressed
// as ebitda_fallback_rules. Applied as a read-side adjustment AFTER aggregation,
// on both full and partial periods (unlike fallback rules). Keyed by lowercased
// venue display name (column E).
//   • Novotel  — fixed €2,750/month lease, effective Nov 2025 onward (zero rent
//                before that). Overrides any Zoho rent, pro-rated per calendar
//                month for partial periods.
//   • Excelsior — turnover rent: base rent + 5% of the period's net revenue.
const SPA_FIXED_RENT_MONTHLY: Record<string, { monthly: number; effectiveFrom: string }> = {
  novotel: { monthly: 2750, effectiveFrom: "2025-11-01" },
};
const SPA_REVENUE_RENT_SURCHARGE: Record<string, number> = { excelsior: 0.05 };

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

/**
 * A fixed monthly amount pro-rated across the calendar months overlapped by
 * [fromIso, toIso]. A full calendar month contributes exactly `monthly`; a
 * partial month contributes `monthly × overlapDays / daysInThatMonth`. So a
 * full-month query returns the exact monthly figure and a 3-month query
 * returns 3× it, while a mid-month range is pro-rated.
 */
function proratedMonthlyAmount(monthly: number, fromIso: string, toIso: string): number {
  let total = 0;
  let cursor = startOfMonth(fromIso);
  while (cursor <= toIso) {
    const mStart = cursor;
    const mEnd   = endOfMonth(cursor);
    const overlapStart = mStart > fromIso ? mStart : fromIso;
    const overlapEnd   = mEnd   < toIso   ? mEnd   : toIso;
    const overlapDays  = daysBetweenInclusive(overlapStart, overlapEnd);
    total += monthly * (overlapDays / daysInMonthOf(mStart));
    cursor = shiftIso(mEnd, 1);   // first day of the next month
  }
  return total;
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
// KEPT FOR REFERENCE — no longer called. Replaced by fetchFromSupabase below.

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

// ── Supabase REST helper ──────────────────────────────────────────────────────

/**
 * Low-level GET against the Supabase REST API using the service-role key.
 * `params` is an array of [key, value] pairs so that repeated filter keys
 * (e.g. `date=gte.X` and `date=lte.Y`) are both sent correctly.
 * Supabase PostgREST requires the Prefer header to get JSON objects back.
 */
async function sbFetch<T>(path: string, params: Array<[string, string]> = []): Promise<T[]> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars are not set");
  }
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    method:  "GET",
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Accept":        "application/json",
      // PostgREST defaults to 1,000 rows. The TTM window spans ~2,880 rows
      // (8 venues × 365 days) — without a range header April data is cut off
      // and the previous_month fallback finds nothing. 50,000 covers years.
      "Range":         "0-49999",
      "Prefer":        "return=representation",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase REST ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T[]>;
}

// ── ebitda_line → human label ─────────────────────────────────────────────────

const EBITDA_LINE_LABEL: Record<string, string> = {
  wages:       "Wages & Salaries",
  advertising: "Advertising",
  sga:         "SG&A",
  cogs:        "COGS",
  rent:        "Rent",
  utilities:   "Utilities",
  revenue:     "Net Revenue",
};

// ── Supabase-backed replacement for fetchAggregatedSheet ─────────────────────

/**
 * Fetches all EBITDA cost + revenue data directly from Supabase for [dateFrom,
 * dateTo] and converts it to the same AggregatedSheetRow[] format that the Apps
 * Script aggregated-period endpoint previously returned.
 *
 * The `org` parameter mirrors the old Apps Script org routing:
 *   "SPA"        → only SPA + HQ rows
 *   "Aesthetics" → only Aesthetics + Slimming + HQ rows
 *   "both"       → all brands (used by the main route to replace two separate calls)
 *
 * Each returned row covers ONE ebitda_line (wages / rent / …) for ONE
 * brand × venue combination, with per-ISO-date values in `daily`.
 *
 * The function uses:
 *  1. spa_ebitda_daily         — SPA costs (join locations for slug/name)
 *  2. spa_revenue_monthly      — SPA revenue spread across days in the window
 *  3. aesthetics_ebitda_daily  — Aesthetics & Slimming costs
 *  4. aesthetics_sales_daily   — Aesthetics revenue
 *  5. slimming_sales_daily     — Slimming revenue
 *  6. hq_ebitda_daily          — HQ costs
 *  7. salary_supplement_monthly — Extra wages spread across days in the window
 */
async function fetchFromSupabase(
  org: "SPA" | "Aesthetics" | "both",
  dateFrom: string,
  dateTo:   string,
): Promise<AggregatedSheetRow[]> {

  // ── Raw DB row types ──────────────────────────────────────────────────────

  type SpaEbitdaRow = {
    date: string; location_id: number;
    cogs: string; wages: string; advertising: string;
    rent: string; utilities: string; sga: string; laundry: string;
    locations: { slug: string; name: string } | null;
  };
  type SpaRevenueRow = {
    month: string; location_id: number;
    services: string; product_phytomer: string; product_purest: string;
    product_other: string; wholesale: string; sales_discount: string; sales_refund: string;
    locations: { slug: string; name: string } | null;
  };
  type AesthEbitdaRow = {
    date: string; department: string;
    cogs: string; wages: string; advertising: string;
    rent: string; utilities: string; sga: string;
  };
  type AesthSalesRow = { date_of_service: string | null; price_ex_vat: string | null };
  type SlimmingSalesRow = { date_of_service: string | null; price_ex_vat: string | null };
  type HqEbitdaRow = {
    date: string; source: string;
    cogs: string; wages: string; advertising: string;
    rent: string; utilities: string; sga: string;
  };
  type SalarySupplementRow = {
    month: string; spa_slug: string | null; amount: string;
  };

  // ── Determine which tables to query ──────────────────────────────────────

  const wantSpa  = org === "SPA"  || org === "both";
  const wantAes  = org === "Aesthetics" || org === "both";

  // Expand the query window for monthly tables: we may need the month that
  // straddles dateFrom, so fetch from the 1st of dateFrom's month.
  const monthFrom = startOfMonth(dateFrom);
  const monthTo   = dateTo;   // endOfMonth(dateTo) would include the next month's start

  // ── Parallel fetches ──────────────────────────────────────────────────────

  const [
    spaEbitdaRaw,
    spaRevenueRaw,
    aesthEbitdaRaw,
    aesthSalesRaw,
    slimmingSalesRaw,
    hqEbitdaRaw,
    salarySupplRaw,
  ] = await Promise.all([
    wantSpa
      ? sbFetch<SpaEbitdaRow>(
          "spa_ebitda_daily",
          [
            ["select", "date,location_id,cogs,wages,advertising,rent,utilities,sga,laundry,locations(slug,name)"],
            ["date",   `gte.${dateFrom}`],
            ["date",   `lte.${dateTo}`],
          ],
        ).catch(() => [] as SpaEbitdaRow[])
      : Promise.resolve([] as SpaEbitdaRow[]),

    wantSpa
      ? sbFetch<SpaRevenueRow>(
          "spa_revenue_monthly",
          [
            ["select", "month,location_id,services,product_phytomer,product_purest,product_other,wholesale,sales_discount,sales_refund,locations(slug,name)"],
            ["month",  `gte.${monthFrom}`],
            ["month",  `lte.${monthTo}`],
          ],
        ).catch(() => [] as SpaRevenueRow[])
      : Promise.resolve([] as SpaRevenueRow[]),

    wantAes
      ? sbFetch<AesthEbitdaRow>(
          "aesthetics_ebitda_daily",
          [
            ["select", "date,department,cogs,wages,advertising,rent,utilities,sga"],
            ["date",   `gte.${dateFrom}`],
            ["date",   `lte.${dateTo}`],
          ],
        ).catch(() => [] as AesthEbitdaRow[])
      : Promise.resolve([] as AesthEbitdaRow[]),

    wantAes
      ? sbFetch<AesthSalesRow>(
          "aesthetics_sales_daily",
          [
            ["select",           "date_of_service,price_ex_vat"],
            ["date_of_service",  `gte.${dateFrom}`],
            ["date_of_service",  `lte.${dateTo}`],
          ],
        ).catch(() => [] as AesthSalesRow[])
      : Promise.resolve([] as AesthSalesRow[]),

    wantAes
      ? sbFetch<SlimmingSalesRow>(
          "slimming_sales_daily",
          [
            ["select",           "date_of_service,price_ex_vat"],
            ["date_of_service",  `gte.${dateFrom}`],
            ["date_of_service",  `lte.${dateTo}`],
          ],
        ).catch(() => [] as SlimmingSalesRow[])
      : Promise.resolve([] as SlimmingSalesRow[]),

    // HQ is queried for both orgs since it belongs to neither SPA nor Aes
    // exclusively — always fetch it.
    sbFetch<HqEbitdaRow>(
      "hq_ebitda_daily",
      [
        ["select", "date,source,cogs,wages,advertising,rent,utilities,sga"],
        ["date",   `gte.${dateFrom}`],
        ["date",   `lte.${dateTo}`],
      ],
    ).catch(() => [] as HqEbitdaRow[]),

    sbFetch<SalarySupplementRow>(
      "salary_supplement_monthly",
      [
        ["select",    "month,spa_slug,amount"],
        ["is_frozen", "eq.true"],
        ["month",     `gte.${monthFrom}`],
        ["month",     `lte.${monthTo}`],
      ],
    ).catch(() => [] as SalarySupplementRow[]),
  ]);

  // ── Builder helpers ───────────────────────────────────────────────────────

  /**
   * Groups by a composite key, merging `daily` maps additively.
   * Key: `${brand}|${ebitda_line}|${venue}`
   */
  const rowMap = new Map<string, AggregatedSheetRow>();

  function upsertRow(
    brand:           string,
    ebitdaLine:      string,
    venue:           string,
    date:            string,
    value:           number,
  ) {
    if (!date || value === 0) return;
    const key = `${brand}|${ebitdaLine}|${venue}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        brand,
        line_item:       EBITDA_LINE_LABEL[ebitdaLine] ?? ebitdaLine,
        account_code:    ebitdaLine,   // pseudo account_code = ebitda_line slug
        ebitda_category: ebitdaLine,
        venue,
        contact:    "",
        allocation: "",
        daily: {},
      };
      rowMap.set(key, row);
    }
    row.daily[date] = (row.daily[date] ?? 0) + value;
  }

  /**
   * Spreads a monthly amount proportionally across days within the overlap of
   * [mStart, mEnd] ∩ [dateFrom, dateTo], emitting one call to upsertRow per day.
   */
  function spreadMonthlyAcrossDays(
    monthIso: string,    // YYYY-MM-01
    amount:   number,
    brand:    string,
    line:     string,
    venue:    string,
  ) {
    if (!amount) return;
    const mStart = startOfMonth(monthIso);
    const mEnd   = endOfMonth(monthIso);
    const winStart = mStart < dateFrom ? dateFrom : mStart;
    const winEnd   = mEnd   > dateTo   ? dateTo   : mEnd;
    if (winStart > winEnd) return;
    const daysInMonth  = daysInMonthOf(monthIso);
    const dailyAmount  = amount / daysInMonth;
    // Iterate day by day inside [winStart, winEnd]
    let cursor = winStart;
    while (cursor <= winEnd) {
      upsertRow(brand, line, venue, cursor, dailyAmount);
      // advance one day
      const d = isoToDate(cursor);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
    }
  }

  // ── 1. SPA costs (spa_ebitda_daily) ──────────────────────────────────────
  // Supabase returns the embedded join under the "locations" key as an object
  // (not array) when using ?select=...,locations(slug,name).

  // Build a fallback slug map from location_id → slug for safety
  const locationSlugById = new Map<number, string>();

  for (const r of spaEbitdaRaw) {
    // Resolve venue slug: prefer join data, fall back to hardwired map
    let slug: string;
    if (r.locations && r.locations.slug) {
      slug = r.locations.slug;
      locationSlugById.set(r.location_id, slug);
    } else {
      // Hardwired fallback: ids 1-8
      const SLUG_BY_ID: Record<number, string> = {
        1: "inter", 2: "hugos", 3: "hyatt", 4: "ramla",
        5: "labranda", 6: "odycy", 7: "excelsior", 8: "novotel",
      };
      slug = locationSlugById.get(r.location_id)
          ?? SLUG_BY_ID[r.location_id]
          ?? String(r.location_id);
    }

    const ebitdaLines: Array<[string, string]> = [
      ["cogs",        r.cogs],
      ["wages",       r.wages],
      ["advertising", r.advertising],
      ["rent",        r.rent],
      ["utilities",   r.utilities],
      // sga + laundry both go into sga bucket
      ["sga",         String((parseFloat(r.sga || "0") + parseFloat(r.laundry || "0")).toFixed(2))],
    ];
    for (const [line, raw] of ebitdaLines) {
      const val = parseFloat(raw || "0");
      if (val !== 0) upsertRow("SPA", line, slug, r.date, val);
    }
  }

  // Guarantee a row exists for wages + utilities for every SPA venue even when
  // the literal sum is zero (salary not yet posted, or no utility bills in window).
  // Without this, the fallback loop has no row to operate on and produces nothing.
  // Collect venues seen in this period from any non-zero line, then ensure wages/utilities.
  {
    const seenVenues = new Set<string>();
    for (const key of rowMap.keys()) {
      if (key.startsWith("SPA|")) {
        const venueSlug = key.split("|")[2];
        if (venueSlug && venueSlug !== "hq") seenVenues.add(venueSlug);
      }
    }
    // Also include hardwired venues in case ALL lines were zero for a venue.
    for (const s of ["inter","hugos","hyatt","ramla","labranda","odycy","excelsior","novotel"]) seenVenues.add(s);
    for (const slug of seenVenues) {
      for (const line of ["wages", "utilities"] as const) {
        const key = `SPA|${line}|${slug}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            brand: "SPA",
            line_item: EBITDA_LINE_LABEL[line] ?? line,
            account_code: line,
            ebitda_category: line,
            venue: slug,
            contact: "",
            allocation: "",
            daily: {},
          });
        }
      }
    }
  }

  // ── 2. SPA revenue (spa_revenue_monthly) — spread per day ─────────────────

  for (const r of spaRevenueRaw) {
    let slug: string;
    if (r.locations && r.locations.slug) {
      slug = r.locations.slug;
    } else {
      const SLUG_BY_ID: Record<number, string> = {
        1: "inter", 2: "hugos", 3: "hyatt", 4: "ramla",
        5: "labranda", 6: "odycy", 7: "excelsior", 8: "novotel",
      };
      slug = locationSlugById.get(r.location_id)
          ?? SLUG_BY_ID[r.location_id]
          ?? String(r.location_id);
    }
    const net =
      parseFloat(r.services          || "0") +
      parseFloat(r.product_phytomer  || "0") +
      parseFloat(r.product_purest    || "0") +
      parseFloat(r.product_other     || "0") +
      parseFloat(r.wholesale         || "0") -
      parseFloat(r.sales_discount    || "0") -
      parseFloat(r.sales_refund      || "0");
    if (net !== 0) spreadMonthlyAcrossDays(r.month, net, "SPA", "revenue", slug);
  }

  // ── 3. Aesthetics / Slimming costs (aesthetics_ebitda_daily) ──────────────

  for (const r of aesthEbitdaRaw) {
    const dept = (r.department || "").toLowerCase();
    const brand = dept === "slimming" ? "Slimming" : "Aesthetics";
    const venue = brand;  // venue mirrors brand for non-SPA departments

    const lines: Array<[string, string]> = [
      ["cogs",        r.cogs],
      ["wages",       r.wages],
      ["advertising", r.advertising],
      ["rent",        r.rent],
      ["utilities",   r.utilities],
      ["sga",         r.sga],
    ];
    for (const [line, raw] of lines) {
      const val = parseFloat(raw || "0");
      if (val !== 0) upsertRow(brand, line, venue, r.date, val);
    }
  }

  // ── 4. Aesthetics revenue (aesthetics_sales_daily) ─────────────────────────

  for (const r of aesthSalesRaw) {
    if (!r.date_of_service) continue;
    const val = parseFloat(r.price_ex_vat || "0");
    if (val !== 0) upsertRow("Aesthetics", "revenue", "Aesthetics", r.date_of_service, val);
  }

  // ── 5. Slimming revenue (slimming_sales_daily) ─────────────────────────────

  for (const r of slimmingSalesRaw) {
    if (!r.date_of_service) continue;
    const val = parseFloat(r.price_ex_vat || "0");
    if (val !== 0) upsertRow("Slimming", "revenue", "Slimming", r.date_of_service, val);
  }

  // ── 6. HQ costs (hq_ebitda_daily) ─────────────────────────────────────────
  // Both sources ("spa" and "aesthetics") collapse into brand="HQ", venue="HQ".
  // The existing route logic re-routes rows to HQ when venue="HQ" — here we
  // set brand directly to "HQ" and use account_code as the ebitda_line, which
  // correctly bypasses the venue re-routing logic (isHqVenue check uses column E
  // of the old sheet, i.e. row.venue === "HQ"). We set venue="HQ" to match.

  for (const r of hqEbitdaRaw) {
    const lines: Array<[string, string]> = [
      ["cogs",        r.cogs],
      ["wages",       r.wages],
      ["advertising", r.advertising],
      ["rent",        r.rent],
      ["utilities",   r.utilities],
      ["sga",         r.sga],
    ];
    for (const [line, raw] of lines) {
      const val = parseFloat(raw || "0");
      if (val !== 0) upsertRow("HQ", line, "HQ", r.date, val);
    }
  }

  // ── 7. Salary supplements (salary_supplement_monthly, is_frozen=true) ──────
  // spa_slug determines brand + venue.

  for (const r of salarySupplRaw) {
    const slug = (r.spa_slug || "").trim().toLowerCase();
    if (!slug) continue;   // unassigned supplements skipped
    const amount = parseFloat(r.amount || "0");
    if (!amount) continue;

    let brand: string;
    let venue: string;
    if (slug === "aesthetics") {
      brand = "Aesthetics"; venue = "Aesthetics";
    } else if (slug === "slimming") {
      brand = "Slimming";   venue = "Slimming";
    } else if (slug === "hq") {
      brand = "HQ";         venue = "HQ";
    } else {
      brand = "SPA";        venue = slug;  // spa slug = venue slug
    }
    spreadMonthlyAcrossDays(r.month, amount, brand, "wages", venue);
  }

  // ── Collect results ───────────────────────────────────────────────────────

  return Array.from(rowMap.values()).filter(row => Object.keys(row.daily).length > 0);
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
  // Top-level guard: the body below has un-try/caught sections (aggregation
  // loop, rent adjustments) that would otherwise surface as an opaque platform
  // 500. Wrap so callers always get a structured error instead.
  try {
    return await handleGet(req);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Unhandled error in ebitda-aggregated: ${e instanceof Error ? e.message : String(e)}`,
        stack: e instanceof Error ? e.stack?.split("\n").slice(0, 8).join("\n") : undefined,
      },
      { status: 500 },
    );
  }
}

async function handleGet(req: NextRequest): Promise<NextResponse> {
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

  // Compute the TTM window. Capped at 2024-01-01 since we have no prior history.
  const ttmFromRequested = shiftIso(dateFrom, -365);
  const ttmFrom = ttmFromRequested < "2024-01-01" ? "2024-01-01" : ttmFromRequested;
  const ttmTo   = shiftIso(dateFrom, -1);  // day before period start

  // 1) Period rows + TTM rows from Supabase, in parallel.
  //    fetchFromSupabase returns a flat AggregatedSheetRow[] for all brands.
  //    We split them into two synthetic OrgFetchResult entries — one keyed
  //    "SPA" (for SPA rows) and one keyed "Aesthetics" (for AES/SLIM/HQ rows)
  //    — so the downstream TTM-index build and zohoOrg derivation work exactly
  //    as they did against the Apps Script data.
  type OrgFetchResult = {
    orgParam: "SPA" | "Aesthetics";
    period:   AggregatedSheetResponse;
    ttm:      AggregatedSheetResponse | null;
  };

  /** Split a flat row array into {SPA: row[], Aesthetics: row[]} buckets. */
  function splitByOrg(rows: AggregatedSheetRow[]): { SPA: AggregatedSheetRow[]; Aesthetics: AggregatedSheetRow[] } {
    const SPA: AggregatedSheetRow[] = [];
    const Aesthetics: AggregatedSheetRow[] = [];
    for (const row of rows) {
      const b = (row.brand || "").trim().toUpperCase();
      if (b === "SPA") {
        SPA.push(row);
      } else {
        // Aesthetics, Slimming, HQ — all come from the "Aesthetics" org
        Aesthetics.push(row);
      }
    }
    return { SPA, Aesthetics };
  }

  /** Fake AggregatedSheetResponse wrapping a row array (dates unused downstream). */
  function makeSheetResponse(rows: AggregatedSheetRow[]): AggregatedSheetResponse {
    // dateFrom / dateTo are string at this point (validated above); cast for TS.
    return { org: "", date_from: dateFrom as string, date_to: dateTo as string, rows, dates: [] };
  }

  let orgResults: OrgFetchResult[];
  try {
    // Fetch period + TTM in parallel from Supabase.
    const [periodRows, ttmRows] = await Promise.all([
      fetchFromSupabase("both", dateFrom, dateTo),
      ttmTo >= ttmFrom
        ? fetchFromSupabase("both", ttmFrom, ttmTo).catch((e: unknown) => {
            warnings.push(
              `TTM fetch failed (${ttmFrom} → ${ttmTo}): ${e instanceof Error ? e.message : String(e)} — TTM-spread rules will fall back to literal sums.`,
            );
            return null as AggregatedSheetRow[] | null;
          })
        : Promise.resolve(null as AggregatedSheetRow[] | null),
    ]);

    const periodSplit = splitByOrg(periodRows);
    const ttmSplit    = ttmRows ? splitByOrg(ttmRows) : null;

    // Build orgResults in the same shape the downstream loop expects.
    // Always include both org entries — the brand filter is applied inside the
    // loop (row-by-row), so producing empty buckets is safe.
    orgResults = [
      {
        orgParam: "SPA",
        period:   makeSheetResponse(periodSplit.SPA),
        ttm:      ttmSplit ? makeSheetResponse(ttmSplit.SPA) : null,
      },
      {
        orgParam: "Aesthetics",
        period:   makeSheetResponse(periodSplit.Aesthetics),
        ttm:      ttmSplit ? makeSheetResponse(ttmSplit.Aesthetics) : null,
      },
    ];
  } catch (e) {
    return NextResponse.json(
      { error: `Supabase fetch failed: ${e instanceof Error ? e.message : String(e)}` },
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
      // Supabase-sourced rows carry pseudo account_code = ebitda_category slug
      // (e.g. "wages", "advertising"). Real Zoho rows carry actual codes like
      // "30001". Try the specific account code first; fall back to the category
      // slug so category-level rules (e.g. spa|wages) apply to Supabase rows.
      const rule = row.account_code
        ? (rules.get(`${zohoOrg}|${row.account_code}`)
           ?? rules.get(`${zohoOrg}|${row.ebitda_category}`))
        : rules.get(`${zohoOrg}|${row.ebitda_category}`);

      let periodValue = literalSum;
      let usedFallback = false;
      let appliedRuleType: RuleType | null = null;
      let appliedMethodDetail: string | null = null;

      // Fallback rules apply on partial periods. Also apply for wages when the
      // literal sum is exactly zero on a full calendar month — this happens when
      // salary entries haven't been posted yet (typically posted ~10 days after
      // month-end). Zero wages on a closed month is a data-lag issue, not
      // genuinely zero wages.
      const wagesUnposted = category === "wages" && literalSum === 0;
      if ((!periodIsFullCalendarMonths || wagesUnposted) && rule && rule.active && rule.rule_type !== "disabled") {
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

  // Post-pass: roll every granular sga_* category into the brand-level
  // "sga" parent, so existing consumers (the BrandAggregatedSummary hook,
  // the EBITDA arithmetic, the parent SG&A row on /finance/ebitda) keep
  // working when the upstream ETL emits granular sga_* sub-categories
  // alongside (or instead of) the legacy collapsed "sga". Sub-category
  // cells themselves are LEFT IN PLACE so the dashboard can render the
  // 11 real per-bucket numbers — they're additive, not replacing "sga".
  function addCell(into: Record<string, CellTotal>, key: string, from: CellTotal) {
    const dest = into[key] ?? { value: 0, has_fallback: false, fallback_account_count: 0 };
    dest.value += from.value;
    if (from.has_fallback) {
      dest.has_fallback = true;
      dest.fallback_account_count += from.fallback_account_count;
    }
    into[key] = dest;
  }
  for (const brand of ALL_BRANDS) {
    const cats = totals[brand];
    for (const cat of Object.keys(cats)) {
      if (cat.startsWith("sga_")) addCell(cats, "sga", cats[cat]);
    }
    seenCategories.add("sga");
    const venueBuckets = venueTotals[brand];
    for (const venueKey in venueBuckets) {
      const vCats = venueBuckets[venueKey];
      for (const cat of Object.keys(vCats)) {
        if (cat.startsWith("sga_")) addCell(vCats, "sga", vCats[cat]);
      }
    }
  }

  // ── Hardwired SPA rent adjustments (off-Zoho business rules) ──────────────
  // Novotel (fixed monthly lease) and Excelsior (base + 5% turnover rent) can't
  // be sourced from Zoho or expressed as fallback rules. Apply them to BOTH the
  // per-venue cells and the SPA brand total so the venue P&L table and the
  // EBITDA arithmetic stay consistent. Runs on full AND partial periods.
  if (!brandFilter || brandFilter === "SPA") {
    const spaVenues = venueTotals.SPA;
    const spaTotals = totals.SPA;
    const newCell = (): CellTotal => ({ value: 0, has_fallback: false, fallback_account_count: 0 });

    const findVenueKey = (wantLower: string): string | null => {
      for (const k in spaVenues) if (k.trim().toLowerCase() === wantLower) return k;
      return null;
    };
    const ensureVenueRentCell = (venueKey: string): CellTotal => {
      const bucket = spaVenues[venueKey] ?? (spaVenues[venueKey] = {});
      return bucket.rent ?? (bucket.rent = newCell());
    };
    // Adjust the SPA brand-level rent total by `delta` so EBITDA stays correct.
    // The brand cell's value tracks the venue cells; we leave its has_fallback
    // flag untouched so we don't mislabel every venue's real rent as estimated.
    const bumpBrandRent = (delta: number) => {
      const cell = spaTotals.rent ?? (spaTotals.rent = newCell());
      cell.value += delta;
      spaTotals.rent = cell;
    };

    // Novotel — fixed monthly rent from effectiveFrom onward; overrides whatever
    // (if anything) Zoho posted. Pre-effective periods get €0 (no rent).
    for (const wantLower in SPA_FIXED_RENT_MONTHLY) {
      const { monthly, effectiveFrom } = SPA_FIXED_RENT_MONTHLY[wantLower];
      // Clamp the proration window to the effective-from date; if the whole
      // period predates it, the fixed rent is €0.
      const effFrom = dateFrom > effectiveFrom ? dateFrom : effectiveFrom;
      const fixed   = effFrom > dateTo ? 0 : proratedMonthlyAmount(monthly, effFrom, dateTo);
      const key   = findVenueKey(wantLower)
        ?? (wantLower.charAt(0).toUpperCase() + wantLower.slice(1));
      const cell  = ensureVenueRentCell(key);
      bumpBrandRent(fixed - cell.value);   // delta vs whatever was there
      cell.value = fixed;
      cell.has_fallback = true;            // rule-derived, not a literal Zoho sum
      seenBrands.add("SPA");
      seenCategories.add("rent");
    }

    // Excelsior — base rent + 5% of period net revenue (added on top).
    for (const wantLower in SPA_REVENUE_RENT_SURCHARGE) {
      const key = findVenueKey(wantLower);
      if (!key) continue;                  // no Excelsior rows in this period
      const revenue   = spaVenues[key]?.revenue?.value ?? 0;
      const surcharge = revenue * SPA_REVENUE_RENT_SURCHARGE[wantLower];
      if (surcharge === 0) continue;
      const cell = ensureVenueRentCell(key);
      cell.value += surcharge;
      cell.has_fallback = true;
      bumpBrandRent(surcharge);
      seenCategories.add("rent");
    }
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
