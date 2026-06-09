/**
 * /api/finance/ebitda-v2
 *
 * EBITDA V2 — reads directly from Supabase (transactions_raw + revenue tables).
 * No live Zoho calls. Applies COA mapping, employee mapping, and fallback rules
 * at read time.
 *
 * Query params:
 *   date_from  YYYY-MM-DD (required)
 *   date_to    YYYY-MM-DD (required, inclusive)
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── Venue config ─────────────────────────────────────────────────────────────

// Slug → display label + brand
export const VENUE_CONFIG = [
  { slug: "intercontinental", label: "inter",     brand: "SPA" },
  { slug: "hugos",            label: "hugos",     brand: "SPA" },
  { slug: "hyatt",            label: "hyatt",     brand: "SPA" },
  { slug: "ramla",            label: "ramla",     brand: "SPA" },
  { slug: "labranda",         label: "labranda",  brand: "SPA" },
  { slug: "sunny_coast",      label: "Sunny Coast", brand: "SPA" },
  { slug: "excelsior",        label: "excelsior", brand: "SPA" },
  { slug: "novotel",          label: "novotel",   brand: "SPA" },
  { slug: "aesthetics",       label: "Aesthetics",brand: "AES" },
  { slug: "slimming",         label: "Slimming",  brand: "SLIM"},
  { slug: "hq",               label: "HQ",        brand: "HQ"  },
] as const;

// location_id (in spa_revenue_monthly) → venue slug
const LOC_ID_TO_SLUG: Record<number, string> = {
  1: "intercontinental",
  2: "hugos",
  3: "hyatt",
  4: "ramla",
  5: "labranda",
  6: "sunny_coast",
  7: "excelsior",
  8: "novotel",
};

// Wage roles (from wage_role_mapping)
const WAGE_ROLES = ["manager", "reception", "therapist", "practitioner", "crm", "unassigned"] as const;
type WageRole = typeof WAGE_ROLES[number];

// SG&A sub-lines
const SGA_SUBS = [
  "prof_services","fuel","laundry","software","cleaning",
  "travel","misc","insurance","events","maintenance","telecom",
] as const;

// Ad channels
const AD_CHANNELS = ["meta","google","klaviyo","misc"] as const;

type VenueData = {
  revenue:        number;
  lapis_revenue:  number;   // services + products only (no wholesale/adjustments) — used for turnover-based rent
  wages:          number;
  wage_by_role:   Record<WageRole, number>;
  advertising:    number;
  ad_by_channel:  Record<string, number>;
  sga:            number;
  sga_by_sub:     Record<string, number>;
  cogs:           number;
  rent:           number;
  utilities:      number;
  ebitda:         number;
};

function emptyVenueData(): VenueData {
  return {
    revenue:       0,
    lapis_revenue: 0,
    wages:         0,
    wage_by_role:  Object.fromEntries(WAGE_ROLES.map(r => [r, 0])) as Record<WageRole, number>,
    advertising:   0,
    ad_by_channel: Object.fromEntries(AD_CHANNELS.map(c => [c, 0])),
    sga:           0,
    sga_by_sub:    Object.fromEntries(SGA_SUBS.map(s => [s, 0])),
    cogs:          0,
    rent:          0,
    utilities:     0,
    ebitda:        0,
  };
}

// ── Date helpers — ALL use LOCAL-SAFE parsing ─────────────────────────────────
//
// IMPORTANT: new Date("YYYY-MM-DD") is parsed as UTC midnight by JavaScript.
// On Vercel servers running in EDT (UTC-4), "2026-05-01" becomes April 30 local
// time, causing getMonth() to return 3 (April) instead of 4 (May). This breaks
// every month-boundary calculation for partial periods.
//
// Fix: parse date strings by splitting on "-" and using the 3-argument Date
// constructor (local time), or use pure string arithmetic for month operations.

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);   // local time — not UTC
}

function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function isFullCalendarMonths(from: string, to: string): boolean {
  const df = parseLocalDate(from);
  const dt = parseLocalDate(to);
  const startIsFirst = df.getDate() === 1;
  const endIsLast    = dt.getDate() === new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  return startIsFirst && endIsLast;
}

// Months that overlap with [from, to] — pure string arithmetic, no Date parsing
function overlappingMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(5, 7), 10);
  const ey = parseInt(to.slice(0, 4), 10);
  const em = parseInt(to.slice(5, 7), 10);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// Last day of a given YYYY-MM-01 month string
function lastDayOfMonth(monthStr: string): string {
  const y = parseInt(monthStr.slice(0, 4), 10);
  const m = parseInt(monthStr.slice(5, 7), 10);
  const last = new Date(y, m, 0).getDate();  // day 0 of next month = last day of this month
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// Days in a given calendar month that fall within [from, to]
function daysOfMonthInRange(monthStr: string, from: string, to: string): number {
  const mEnd       = lastDayOfMonth(monthStr);
  const rangeStart = from > monthStr ? from : monthStr;
  const rangeEnd   = to   < mEnd    ? to   : mEnd;
  if (rangeStart > rangeEnd) return 0;
  return daysBetween(rangeStart, rangeEnd);
}

function totalDaysInMonth(monthStr: string): number {
  const y = parseInt(monthStr.slice(0, 4), 10);
  const m = parseInt(monthStr.slice(5, 7), 10);
  return new Date(y, m, 0).getDate();
}

// Shift a YYYY-MM-01 string by N calendar months (negative = back)
function shiftMonth(dateStr: string, n: number): string {
  let y = parseInt(dateStr.slice(0, 4), 10);
  let m = parseInt(dateStr.slice(5, 7), 10) + n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");

  if (!dateFrom || !dateTo)
    return NextResponse.json({ error: "date_from and date_to required" }, { status: 400 });

  const supabase       = await createServerSupabaseClient();
  const daysInPeriod   = daysBetween(dateFrom, dateTo);
  const isFullPeriod   = isFullCalendarMonths(dateFrom, dateTo);
  const warnings: string[] = [];

  // ── 1a. Paginate transactions_raw — this project's PostgREST max_rows is
  //       330, so each .range() call returns at most 330 rows. We use PAGE=200
  //       (safely below max_rows) and loop until we receive an EMPTY page.
  //       Never break on a partial page — that would be the last real page.
  //       Safety cap at 500 iterations (~100k rows) prevents infinite loops.
  type RawRow = { venue: string; ebitda_line: string; ebitda_sub_line: string; contact_name: string; amount: number; account_code?: string };
  async function fetchAllRawCosts(): Promise<RawRow[]> {
    const PAGE = 200;
    const all: RawRow[] = [];
    // IMPORTANT: must ORDER BY to guarantee stable pagination.
    // Without ORDER BY, offset-based pages can overlap (same row on two pages)
    // or skip rows as the query planner uses different index scans per request.
    // We order by (date, txn_id, venue) which is nearly unique per row.
    for (let offset = 0; offset < 100_000; offset += PAGE) {
      const { data, error } = await supabase
        .from("transactions_raw")
        .select("venue, ebitda_line, ebitda_sub_line, contact_name, amount, account_code")
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date")
        .order("txn_id")
        .order("venue")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`transactions_raw page ${offset}: ${error.message}`);
      if (!data || data.length === 0) break;
      all.push(...(data as RawRow[]));
    }
    return all;
  }

  // ── 1. Load all config tables in parallel ─────────────────────────────────
  const [allRawCosts, revenueDaily, revenueMonthly, aestheticsSales, slimmingSales,
         supplement, wageRoles, adPatterns, fallbackRules, hardwiredRules] =
    await Promise.all([
      fetchAllRawCosts(),

      // SPA revenue per location per day — paginated to bypass PostgREST max_rows
      fetchAll(
        (off, lim) =>
          supabase
            .from("spa_revenue_daily")
            .select("location_id, date, services, product_phytomer, product_purest, product_other")
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .range(off, off + lim - 1),
        "spa_revenue_daily",
      ),

      // SPA revenue monthly — used only for wholesale, discount, refund adjustments
      supabase
        .from("spa_revenue_monthly")
        .select("location_id, month, wholesale, sales_discount, sales_refund")
        .in("month", overlappingMonths(dateFrom, dateTo)),

      // Aesthetics revenue — paginated to bypass PostgREST max_rows
      fetchAll(
        (off, lim) =>
          supabase
            .from("aesthetics_sales_daily")
            .select("price_ex_vat")
            .gte("date_of_service", dateFrom)
            .lte("date_of_service", dateTo)
            .range(off, off + lim - 1),
        "aesthetics_sales_daily",
      ),

      // Slimming revenue — paginated to bypass PostgREST max_rows
      fetchAll(
        (off, lim) =>
          supabase
            .from("slimming_sales_daily")
            .select("price_ex_vat")
            .gte("date_of_service", dateFrom)
            .lte("date_of_service", dateTo)
            .range(off, off + lim - 1),
        "slimming_sales_daily",
      ),

      // Salary supplement — fetch up to 3 months before period start so we can
      // fall back to the most recent frozen month when the period month has no data.
      supabase
        .from("salary_supplement_monthly")
        .select("month, employee_name, amount, spa_slug, role")   // role = designation from Talexio
        .in("month", [
          ...overlappingMonths(shiftMonth(dateFrom, -3), dateFrom.slice(0, 7) + "-01"),
          ...overlappingMonths(dateFrom, dateTo),
        ].filter((v, i, a) => a.indexOf(v) === i))   // dedupe
        .eq("is_frozen", true),

      // Wage role mapping: contact_key → role + optional venue_override + prof fee flags
      supabase
        .from("wage_role_mapping")
        .select("contact_key, role, venue_override, is_prof_fee, monthly_floor"),

      // Advertising contact patterns: pattern → channel
      supabase
        .from("advertising_contact_mapping")
        .select("pattern, canonical, priority")
        .order("priority"),

      // Fallback rules (for partial periods)
      supabase
        .from("ebitda_fallback_rules")
        .select("account_code, account_name, zoho_org, rule_type, active, params"),

      // Hardwired venue rules
      supabase
        .from("ebitda_v2_hardwired_rules")
        .select("*"),
    ]);

  // Error checks (rawCosts, spa_revenue_daily, aesthetics_sales_daily, slimming_sales_daily
  // errors thrown inside fetchAll/fetchAllRawCosts; only non-paginated queries need checking here)
  for (const [label, res] of [
    ["spa_revenue_monthly", revenueMonthly],
  ] as Array<[string, {error: {message: string} | null}]>) {
    if (res.error) return NextResponse.json({ error: `${label}: ${res.error.message}` }, { status: 500 });
  }

  // ── 2. Build lookup structures ────────────────────────────────────────────

  // Wage role lookup: normalized contact name → role
  const wageRoleMap = new Map<string, WageRole>();
  // Venue override: contact whose wages should show in a different venue than posted
  const wageVenueOverrideMap = new Map<string, string>();
  // Prof fee contacts: re-routed from wages → sga.prof_services with optional min floor
  const profFeeMap = new Map<string, { monthly_floor: number; venue: string }>();
  for (const row of (wageRoles.data ?? [])) {
    const key = (row.contact_key as string).toLowerCase().trim();
    wageRoleMap.set(key, row.role as WageRole);
    if (row.venue_override) wageVenueOverrideMap.set(key, row.venue_override as string);
    if (row.is_prof_fee) {
      profFeeMap.set(key, {
        monthly_floor: Number(row.monthly_floor ?? 0),
        venue: (row.venue_override as string) ?? "hq",
      });
    }
  }

  // Ad channel lookup: contact name → channel
  // Table column is `canonical` (e.g. "Meta", "Google", "Klaviyo") — lowercase to match ad_by_channel keys.
  const adPatternsArr = (adPatterns.data ?? []) as Array<{ pattern: string; canonical: string }>;
  const KNOWN_AD_CHANNELS = new Set(["meta", "google", "klaviyo"]);
  function resolveAdChannel(contact: string): string {
    const lower = contact.toLowerCase();
    for (const p of adPatternsArr) {
      if (lower.includes(p.pattern.toLowerCase())) {
        const ch = (p.canonical ?? "").toLowerCase();
        return KNOWN_AD_CHANNELS.has(ch) ? ch : "misc";
      }
    }
    return "misc";
  }

  // Hardwired rules lookup: venue → { ebitda_line → rule }
  type HardwiredRule = { rule_type: string; params: Record<string, number>; effective_from: string; effective_to?: string };
  const hardwiredMap = new Map<string, HardwiredRule>();
  for (const r of (hardwiredRules.data ?? [])) {
    const key = `${r.venue}|${r.ebitda_line}`;
    const from = r.effective_from as string;
    const to   = r.effective_to  as string | undefined;
    if (dateTo < from) continue;                    // rule not yet effective
    if (to && dateFrom > to) continue;              // rule expired
    hardwiredMap.set(key, {
      rule_type: r.rule_type as string,
      params: (r.params ?? {}) as Record<string, number>,
      effective_from: from,
      effective_to: to,
    });
  }

  // ── 3. Initialise per-venue accumulators ──────────────────────────────────
  const venues: Record<string, VenueData> = {};
  for (const vc of VENUE_CONFIG) {
    venues[vc.slug] = emptyVenueData();
  }

  // ── 4. Revenue ───────────────────────────────────────────────────────────
  // 4a. SPA — sum actual daily LAPIS amounts for exact date range (no pro-rating)
  overlappingMonths(dateFrom, dateTo);
  for (const row of revenueDaily) {
    const slug = LOC_ID_TO_SLUG[row.location_id as number];
    if (!slug || !venues[slug]) continue;
    const lapisSales = (
      (row.services         as number) +
      (row.product_phytomer as number) +
      (row.product_purest   as number) +
      (row.product_other    as number)
    );
    venues[slug].revenue       += lapisSales;
    venues[slug].lapis_revenue += lapisSales;   // services+products only — for turnover rent
  }
  // Zoho adjustments (wholesale, discount, refund) are still monthly — pro-rate to period
  for (const row of (revenueMonthly.data ?? [])) {
    const slug = LOC_ID_TO_SLUG[row.location_id as number];
    if (!slug || !venues[slug]) continue;
    const monthStr  = (row.month as string).slice(0, 10);
    const daysInMo  = totalDaysInMonth(monthStr);
    const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
    const factor    = daysInRange / daysInMo;
    const adj = (
      ((row.wholesale      as number) -
       (row.sales_discount as number) -
       (row.sales_refund   as number)) * factor
    );
    venues[slug].revenue += adj;
  }
  // 4b. Aesthetics
  const aesthTotal = aestheticsSales
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.price_ex_vat ?? 0), 0);
  if (venues["aesthetics"]) venues["aesthetics"].revenue = aesthTotal;
  // 4c. Slimming
  const slimTotal = slimmingSales
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.price_ex_vat ?? 0), 0);
  if (venues["slimming"]) venues["slimming"].revenue = slimTotal;

  // ── 5. Costs from transactions_raw ────────────────────────────────────────
  const fallbackApplied: Array<{venue: string; ebitda_line: string; rule_type: string; value: number}> = [];

  for (const row of allRawCosts) {
    const venue     = (row.venue         as string) ?? "unallocated";
    const line      = (row.ebitda_line   as string);
    const sub       = (row.ebitda_sub_line as string) ?? line;
    const contact   = (row.contact_name  as string) ?? "";
    const amount    = Number(row.amount  ?? 0);

    if (!venues[venue]) continue;     // unknown venue (e.g. 'unallocated')
    if (line === "revenue") continue; // revenue handled from google-sheet sources above

    const hwKey = `${venue}|${line}`;
    if (hardwiredMap.has(hwKey)) continue; // overridden by hardwired rule below

    switch (line) {
      case "wages": {
        const roleKey = contact.toLowerCase().trim();
        // Prof fee contractors: re-route from wages → sga.prof_services
        if (profFeeMap.has(roleKey)) {
          const pfVenue = profFeeMap.get(roleKey)!.venue;
          if (!venues[pfVenue]) break;
          venues[pfVenue].sga += amount;
          venues[pfVenue].sga_by_sub["prof_services"] = (venues[pfVenue].sga_by_sub["prof_services"] ?? 0) + amount;
          break;
        }
        // Venue override: re-route SPA-payroll staff who work for another brand
        const effectiveVenue = wageVenueOverrideMap.get(roleKey) ?? venue;
        if (!venues[effectiveVenue]) break;
        venues[effectiveVenue].wages += amount;
        const role: WageRole = wageRoleMap.get(roleKey) ?? "unassigned";
        venues[effectiveVenue].wage_by_role[role] += amount;
        break;
      }
      case "advertising": {
        const ch = resolveAdChannel(contact);
        // Klaviyo billed to HQ → split across 8 SPA venues by lapis_revenue ratio
        if (ch === "klaviyo" && venue === "hq") {
          const SPA_SLUGS = ["intercontinental","hugos","hyatt","ramla","labranda","sunny_coast","excelsior","novotel"] as const;
          const totalSpaRev = SPA_SLUGS.reduce((s, sv) => s + (venues[sv]?.lapis_revenue ?? 0), 0);
          for (const sv of SPA_SLUGS) {
            if (!venues[sv]) continue;
            const ratio = totalSpaRev > 0 ? (venues[sv].lapis_revenue ?? 0) / totalSpaRev : 1 / 8;
            const share = amount * ratio;
            venues[sv].advertising += share;
            venues[sv].ad_by_channel["klaviyo"] = (venues[sv].ad_by_channel["klaviyo"] ?? 0) + share;
          }
          break;
        }
        venues[venue].advertising += amount;
        venues[venue].ad_by_channel[ch] = (venues[venue].ad_by_channel[ch] ?? 0) + amount;
        break;
      }
      case "sga": {
        venues[venue].sga += amount;
        venues[venue].sga_by_sub[sub] = (venues[venue].sga_by_sub[sub] ?? 0) + amount;
        break;
      }
      case "cogs": {
        venues[venue].cogs += amount;
        break;
      }
      case "rent": {
        venues[venue].rent += amount;
        break;
      }
      case "utilities": {
        venues[venue].utilities += amount;
        break;
      }
    }
  }

  // ── 6. Apply hardwired venue rules ────────────────────────────────────────
  for (const [key, rule] of hardwiredMap) {
    const [venue, ebitda_line] = key.split("|");
    if (!venues[venue]) continue;

    let value = 0;
    if (rule.rule_type === "fixed_monthly") {
      value = (rule.params.monthly_amount ?? 0) * (daysInPeriod / 30.4375);
    } else if (rule.rule_type === "base_plus_revenue_pct") {
      const pct  = (rule.params.revenue_pct  ?? 0) / 100;
      const base = (rule.params.base_monthly ?? 0) * (daysInPeriod / 30.4375);
      // Use Lapis-only revenue (services + products, no wholesale/adjustments)
      // for turnover rent — that's the contractual basis for Excelsior.
      const revenueBase = venues[venue].lapis_revenue || venues[venue].revenue;
      value = base + revenueBase * pct;
    }

    if (ebitda_line === "rent")      venues[venue].rent      = value;
    else if (ebitda_line === "utilities") venues[venue].utilities = value;

    fallbackApplied.push({ venue, ebitda_line, rule_type: rule.rule_type, value });
  }

  // ── 6b-pre. Apply min_monthly floor rules (ALL periods) ──────────────────
  // These guarantee a minimum cost floor regardless of whether actual Zoho
  // transactions exist. Applied for full months AND partial periods.
  // Logic: max(actual_in_period, monthly_amount × day_fraction_of_month).
  // Only the deficit is added — actual data is never discarded.
  {
    const minRules = (fallbackRules.data ?? []).filter(
      (r: Record<string, unknown>) => r.active && r.rule_type === "min_monthly",
    );
    for (const rule of minRules) {
      const params       = (rule.params ?? {}) as Record<string, unknown>;
      const monthlyAmt   = Number(params.monthly_amount ?? 0);
      if (!monthlyAmt) continue;
      const ebitdaLine   = (params.ebitda_line as string)     ?? "sg_and_a";
      const ebitdaSub    = (params.ebitda_sub_line as string)  ?? "misc";
      const accountCode  = rule.account_code as string;

      // Venue list: explicit array (for all-spa items) OR single venue
      const targetVenues: string[] = Array.isArray(params.venues)
        ? (params.venues as string[])
        : params.venue ? [params.venue as string] : [];
      const splitEqual = params.split === "equal";
      const numVenues  = targetVenues.length || 1;

      // Pro-rate by actual calendar days in each overlapping month
      let floor = 0;
      for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
        const daysInMo   = totalDaysInMonth(monthStr);
        const daysOver   = daysOfMonthInRange(monthStr, dateFrom, dateTo);
        floor += monthlyAmt * (daysOver / daysInMo);
      }

      for (const venue of targetVenues) {
        if (!venues[venue]) continue;
        const venueFloor = splitEqual ? floor / numVenues : floor;

        // Actual already accumulated for this account+venue from transactions_raw
        const actual = allRawCosts
          .filter(r => r.venue === venue && r.account_code === accountCode)
          .reduce((sum, r) => sum + r.amount, 0);

        const supplement = Math.max(0, venueFloor - actual);
        if (supplement === 0) continue;

        if (ebitdaLine === "utilities") {
          venues[venue].utilities += supplement;
        } else if (ebitdaLine === "cogs") {
          venues[venue].cogs += supplement;
        } else if (ebitdaLine === "sg_and_a") {
          venues[venue].sga += supplement;
          const sub = SGA_SUBS.includes(ebitdaSub as typeof SGA_SUBS[number]) ? ebitdaSub : "misc";
          venues[venue].sga_by_sub[sub] = (venues[venue].sga_by_sub[sub] ?? 0) + supplement;
        }
        fallbackApplied.push({ venue, ebitda_line: ebitdaLine, rule_type: "min_monthly", value: Math.round(supplement) });
      }
    }
  }

  // ── 6b-pre-2. Prof fee contact min_monthly floors ────────────────────────
  // Contacts in profFeeMap are re-routed wages → sga.prof_services above.
  // Apply their monthly_floor as a minimum (deficit only — never discard actual).
  {
    for (const [contactKey, pf] of profFeeMap) {
      if (!pf.monthly_floor) continue;
      const targetVenue = pf.venue;
      if (!venues[targetVenue]) continue;

      let floor = 0;
      for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
        const daysInMo = totalDaysInMonth(monthStr);
        const daysOver = daysOfMonthInRange(monthStr, dateFrom, dateTo);
        floor += pf.monthly_floor * (daysOver / daysInMo);
      }

      // Actual posted by this contact (regardless of original ebitda_line — we re-routed it)
      const actual = allRawCosts
        .filter(r => (r.contact_name ?? "").toLowerCase().trim() === contactKey)
        .reduce((sum, r) => sum + r.amount, 0);

      const supplement = Math.max(0, floor - actual);
      if (supplement === 0) continue;

      venues[targetVenue].sga += supplement;
      venues[targetVenue].sga_by_sub["prof_services"] = (venues[targetVenue].sga_by_sub["prof_services"] ?? 0) + supplement;
      fallbackApplied.push({ venue: targetVenue, ebitda_line: "prof_services", rule_type: "min_monthly", value: Math.round(supplement) });
    }
  }

  // ── 6b. Apply ebitda_fallback_rules for partial periods ──────────────────
  // For partial calendar months, lumpy costs (rent, insurance, prof services,
  // laundry, telecom etc.) may not yet be posted. Apply the configured fallback
  // rule to provide a pro-rated estimate so the P&L is meaningful mid-month.
  if (!isFullPeriod && (fallbackRules.data ?? []).length > 0) {
    // TTM window: 12 months ending the day before the period starts
    const ttmTo   = dateFrom;
    const ttmFrom = shiftMonth(dateFrom, -12);

    // Fetch historical costs for all active fallback accounts from transactions_raw
    // grouped by (account_code, venue) — one query covers all rules at once.
    const activeCodes = (fallbackRules.data ?? [])
      .filter((r: Record<string, unknown>) => r.active)
      .map((r: Record<string, unknown>) => r.account_code as string);

    if (activeCodes.length > 0) {
      // TTM and previous-month queries can return thousands of rows across 88 codes ×
      // 12 months × 8 venues — must paginate like fetchAllRawCosts() to avoid the
      // PostgREST max_rows cap (330) silently dropping most of the history.
      const HIST_PAGE = 200;

      type HistRawRow = { account_code: string; venue: string; date: string; amount: number; ebitda_line: string; ebitda_sub_line: string };
      async function fetchHistRows(from: string, to: string): Promise<HistRawRow[]> {
        const all: HistRawRow[] = [];
        for (let offset = 0; offset < 500_000; offset += HIST_PAGE) {
          const { data, error } = await supabase
            .from("transactions_raw")
            .select("account_code, venue, date, amount, ebitda_line, ebitda_sub_line")
            .in("account_code", activeCodes)
            .gte("date", from)
            .lt("date", to)
            .order("date").order("account_code").order("venue")
            .range(offset, offset + HIST_PAGE - 1);
          if (error) throw new Error(`histRows page ${offset}: ${error.message}`);
          if (!data || data.length === 0) break;
          all.push(...(data as HistRawRow[]));
        }
        return all;
      }

      // Historical totals by (account_code, venue) over TTM window
      const prevMonthFrom = shiftMonth(dateFrom, -1);
      const [histRows, prevRows] = await Promise.all([
        fetchHistRows(ttmFrom, ttmTo),
        fetchHistRows(prevMonthFrom, dateFrom),
      ]);

      // Group historical amounts by account+venue AND track distinct months
      // (needed to correctly annualise when <12 months of SPA history exist)
      type HistKey = string; // "account_code|venue"
      const histMap    = new Map<HistKey, { ttm: number; ebitda_line: string; ebitda_sub_line: string }>();
      const histMonths = new Map<HistKey, Set<string>>(); // track distinct YYYY-MM per key
      for (const r of histRows) {
        const k = `${r.account_code}|${r.venue}`;
        const mon = (r.date ?? "").slice(0, 7);
        if (!histMonths.has(k)) histMonths.set(k, new Set());
        histMonths.get(k)!.add(mon);
        const existing = histMap.get(k);
        if (existing) {
          existing.ttm += Number(r.amount ?? 0);
        } else {
          histMap.set(k, {
            ttm: Number(r.amount ?? 0),
            ebitda_line:     r.ebitda_line     || "sga",
            ebitda_sub_line: r.ebitda_sub_line || "misc",
          });
        }
      }

      const prevMap = new Map<HistKey, number>();
      for (const r of prevRows) {
        const k = `${r.account_code}|${r.venue}`;
        prevMap.set(k, (prevMap.get(k) ?? 0) + Number(r.amount ?? 0));
      }

      // Days in prior month (for previous_month pro-rating)
      const prevMonthStr = prevMonthFrom + "-01";
      const daysInPrevMonth = totalDaysInMonth(prevMonthStr.slice(0, 7) + "-01");

      // Track which account_code|venue combos have had fallback applied to prevent
      // duplicate rules (same account_code appearing twice in ebitda_fallback_rules)
      // from doubling costs.
      const appliedFallbackKeys = new Set<string>();

      for (const rule of (fallbackRules.data ?? [])) {
        if (!rule.active) continue;
        const ruleType   = rule.rule_type as string;
        const accountCode = rule.account_code as string;
        // rule.zoho_org available as "spa" | "aesthetics" if needed

        // Find all venue+ebitda_line combos for this account in historical data
        const venueKeys = [...histMap.keys()].filter(k => k.startsWith(accountCode + "|"));

        for (const key of venueKeys) {
          const [, venue] = key.split("|");
          if (!venues[venue]) continue;
          const hist = histMap.get(key)!;

          // Skip if another rule with the same account_code already fired for this venue
          const dedupKey = `${accountCode}|${venue}`;
          if (appliedFallbackKeys.has(dedupKey)) continue;

          // Don't stack fallback on top of a hardwired rule — hardwired is definitive
          if (hardwiredMap.has(`${venue}|${hist.ebitda_line}`)) continue;

          // Check if there's already real data for this account+venue in the period
          const alreadyHasData = allRawCosts.some(
            r => r.venue === venue && (r as unknown as Record<string,unknown>).account_code === accountCode
          );
          if (alreadyHasData) continue; // real data trumps fallback

          appliedFallbackKeys.add(dedupKey);

          let fallbackValue = 0;
          if (ruleType === "ttm_spread") {
            // Annualise TTM (account for < 12 months of history), pro-rate to period
            // TEMP: use actual months in history to annualise correctly.
            // Once full 2025 SPA backfill is done (12 months available),
            // actual_months will equal 12 and this reverts to standard TTM.
            const actualMonths = Math.max(histMonths.get(key)?.size ?? 1, 1);
            const annualised   = (hist.ttm / actualMonths) * 12;
            fallbackValue = annualised * (daysInPeriod / 365);
          } else if (ruleType === "previous_month") {
            const prev = prevMap.get(key) ?? 0;
            fallbackValue = prev * (daysInPeriod / daysInPrevMonth);
          } else if (ruleType === "manual_annual") {
            const annual = (rule.params as Record<string, number>)?.annual_amount ?? 0;
            fallbackValue = annual * (daysInPeriod / 365);
          } else if (ruleType === "quarterly_average") {
            // Average of last 3 months
            // Use TTM × 3/12 as approximation (q3From = shiftMonth(dateFrom, -3) if needed)
            fallbackValue = hist.ttm * (3 / 12) / 3 * (daysInPeriod / 30.4375);
          } else {
            continue; // "disabled" or unknown
          }

          if (fallbackValue <= 0) continue;

          const line = hist.ebitda_line;
          const sub  = hist.ebitda_sub_line;

          // Apply to venue
          switch (line) {
            case "wages":
              venues[venue].wages += fallbackValue;
              venues[venue].wage_by_role["unassigned"] = (venues[venue].wage_by_role["unassigned"] ?? 0) + fallbackValue;
              break;
            case "advertising": venues[venue].advertising += fallbackValue; break;
            case "sga":
              venues[venue].sga += fallbackValue;
              venues[venue].sga_by_sub[sub] = (venues[venue].sga_by_sub[sub] ?? 0) + fallbackValue;
              break;
            case "cogs":      venues[venue].cogs      += fallbackValue; break;
            case "rent":      venues[venue].rent      += fallbackValue; break;
            case "utilities": venues[venue].utilities += fallbackValue; break;
          }

          fallbackApplied.push({
            venue,
            ebitda_line: line,
            rule_type:   ruleType,
            value:       +fallbackValue.toFixed(2),
          });
        }
      }
    }
  }

  // ── 7. Salary supplement → wages (with prior-month fallback) ────────────
  // Group all fetched supplement rows by month key (YYYY-MM-01).
  type SuppRow = { spa_slug: string; employee_name: string; amount: number; role?: string };
  const suppByMonth = new Map<string, SuppRow[]>();
  for (const row of (supplement.data ?? [])) {
    const m = (row.month as string).slice(0, 10);
    if (!suppByMonth.has(m)) suppByMonth.set(m, []);
    suppByMonth.get(m)!.push({
      spa_slug:      (row.spa_slug      as string) ?? "",
      employee_name: (row.employee_name as string) ?? "",
      amount:        Number(row.amount  ?? 0),
      role:          ((row.role as string) || "").toLowerCase().trim() || undefined,
    });
  }

  // Sorted list of months that have frozen data (for fallback lookup).
  const frozenMonths = Array.from(suppByMonth.keys()).sort();

  for (const targetMonth of overlappingMonths(dateFrom, dateTo)) {
    let rows = suppByMonth.get(targetMonth);
    let sourceMonth = targetMonth;
    let isFallback  = false;

    if (!rows || rows.length === 0) {
      // Find the most recent prior frozen month (walk backwards from targetMonth).
      const candidate = [...frozenMonths].reverse().find(m => m < targetMonth);
      if (candidate) {
        rows        = suppByMonth.get(candidate)!;
        sourceMonth = candidate;
        isFallback  = true;
      }
    }

    if (!rows || rows.length === 0) continue;

    // Pro-rate by days of targetMonth that fall in [dateFrom, dateTo].
    const daysInRange = daysOfMonthInRange(targetMonth, dateFrom, dateTo);
    const factor      = daysInRange / totalDaysInMonth(targetMonth);

    for (const row of rows) {
      if (!row.spa_slug || !venues[row.spa_slug]) continue;
      const amount = row.amount * factor;
      // Role comes exclusively from the frozen supplement record's role column.
      // wage_role_mapping is NOT used for supplement — frozen cell is authoritative.
      const suppRoleRaw = ((row.role as string) || "").toLowerCase().trim() || "unassigned";
      const suppRole: WageRole = (WAGE_ROLES as readonly string[]).includes(suppRoleRaw)
        ? (suppRoleRaw as WageRole)
        : "unassigned";
      venues[row.spa_slug].wages                  += amount;
      venues[row.spa_slug].wage_by_role[suppRole] += amount;
    }

    if (isFallback) {
      const label = targetMonth.slice(0, 7);
      const src   = sourceMonth.slice(0, 7);
      warnings.push(`Salary supplement ${label}: no frozen data — using ${src} as fallback`);
      fallbackApplied.push({
        venue:       "all_spa",
        ebitda_line: "wages_supplement",
        rule_type:   `prior_month_fallback (${src})`,
        value:       rows.reduce((s, r) => s + r.amount, 0) * factor,
      });
    }
  }

  // ── 8. Compute EBITDA per venue ───────────────────────────────────────────
  for (const vc of VENUE_CONFIG) {
    const v = venues[vc.slug];
    v.ebitda = v.revenue - v.wages - v.advertising - v.sga - v.cogs - v.rent - v.utilities;
    // Round to 2dp
    v.revenue     = +v.revenue.toFixed(2);
    v.wages       = +v.wages.toFixed(2);
    v.advertising = +v.advertising.toFixed(2);
    v.sga         = +v.sga.toFixed(2);
    v.cogs        = +v.cogs.toFixed(2);
    v.rent        = +v.rent.toFixed(2);
    v.utilities   = +v.utilities.toFixed(2);
    v.ebitda      = +v.ebitda.toFixed(2);
  }

  // ── 9. Group totals ───────────────────────────────────────────────────────
  const group = emptyVenueData();
  for (const vc of VENUE_CONFIG) {
    const v = venues[vc.slug];
    group.revenue     += v.revenue;
    group.wages       += v.wages;
    group.advertising += v.advertising;
    group.sga         += v.sga;
    group.cogs        += v.cogs;
    group.rent        += v.rent;
    group.utilities   += v.utilities;
    for (const r of WAGE_ROLES) group.wage_by_role[r]    += v.wage_by_role[r];
    for (const c of AD_CHANNELS) group.ad_by_channel[c]  = (group.ad_by_channel[c] ?? 0) + (v.ad_by_channel[c] ?? 0);
    for (const s of SGA_SUBS)   group.sga_by_sub[s]     = (group.sga_by_sub[s]    ?? 0) + (v.sga_by_sub[s]    ?? 0);
  }
  group.ebitda = group.revenue - group.wages - group.advertising - group.sga - group.cogs - group.rent - group.utilities;
  group.ebitda = +group.ebitda.toFixed(2);

  return NextResponse.json({
    date_from:          dateFrom,
    date_to:            dateTo,
    days_in_period:     daysInPeriod,
    debug_raw_row_count: allRawCosts.length,   // temporary: confirms pagination fetched all rows
    venues,
    group,
    fallback_applied:   fallbackApplied,
    warnings,
  });
}
