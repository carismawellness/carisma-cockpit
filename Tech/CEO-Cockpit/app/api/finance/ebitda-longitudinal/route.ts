/**
 * /api/finance/ebitda-longitudinal
 *
 * Returns period-by-period EBITDA for a date range, plus SPPY (same period
 * previous year).
 *
 * Supports two granularities:
 *   - monthly (default): groups by calendar month, SPPY = same months -12 months
 *   - weekly:            groups by ISO week,     SPPY = same weeks   -364 days
 *
 * All data is fetched in two wide shots (current range + SPPY range) and
 * aggregated in memory — no per-period round-trips.
 *
 * Query params:
 *   date_from    YYYY-MM-DD (required — first day of first period to show)
 *   date_to      YYYY-MM-DD (required, inclusive — last day of last period)
 *   granularity  "monthly" | "weekly"  (default: "monthly")
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic    = "force-dynamic";
export const maxDuration = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonthTotals = {
  revenue:     number;
  ebitda:      number;
  ebitda_pct:  number;
  wages:       number;
  advertising: number;
  sga:         number;
  rent:        number;
  cogs:        number;
  utilities:   number;
};

type BrandTotals = MonthTotals & { spa: MonthTotals; aes: MonthTotals; slim: MonthTotals };

export type LongitudinalPeriod = {
  period:  string;       // "2025-01" monthly OR "2025-W03" weekly
  label:   string;       // "Jan '25" or "W3 Jan '25"
  current: BrandTotals;
  sppy:    BrandTotals | null;
};

export type LongitudinalResponse = {
  date_from:   string;
  date_to:     string;
  granularity: "monthly" | "weekly";
  periods:     LongitudinalPeriod[];
};

// ── Venue config (mirrors ebitda-v2) ─────────────────────────────────────────

const SPA_SLUGS = [
  "intercontinental","hugos","hyatt","ramla",
  "labranda","sunny_coast","excelsior","novotel",
] as const;

const VENUE_CONFIG = [
  { slug: "intercontinental", brand: "SPA" },
  { slug: "hugos",            brand: "SPA" },
  { slug: "hyatt",            brand: "SPA" },
  { slug: "ramla",            brand: "SPA" },
  { slug: "labranda",         brand: "SPA" },
  { slug: "sunny_coast",      brand: "SPA" },
  { slug: "excelsior",        brand: "SPA" },
  { slug: "novotel",          brand: "SPA" },
  { slug: "aesthetics",       brand: "AES"  },
  { slug: "slimming",         brand: "SLIM" },
  { slug: "hq",               brand: "HQ"   },
] as const;

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

// ── Month label ───────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(m: string): string {
  // m = "2025-01"
  const y  = m.slice(0, 4);
  const mo = parseInt(m.slice(5, 7), 10) - 1;
  return `${MONTH_NAMES[mo]} '${y.slice(2)}`;
}

// ── ISO week helpers ──────────────────────────────────────────────────────────

/**
 * Returns "YYYY-Www" e.g. "2025-W03" for a given date string "YYYY-MM-DD".
 * Uses the ISO 8601 week definition: week 1 contains the first Thursday.
 */
function isoWeek(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = (date.getDay() + 6) % 7; // Mon=0, Sun=6
  const thursday = new Date(date);
  thursday.setDate(date.getDate() - dayOfWeek + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${thursday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * "2025-W03" → "W3 Jan '25"
 * Finds the Monday of the given ISO week and formats as "W{n} {Mon} '{yy}".
 */
function weekLabel(weekStr: string): string {
  const [yearStr, wStr] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7; // Mon=0
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  return `W${week} ${MONTH_NAMES[monday.getMonth()]} '${String(year).slice(2)}`;
}

/**
 * Shift a YYYY-MM-DD date string by n days.
 */
function shiftDateByDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  const yy  = date.getFullYear();
  const mm  = String(date.getMonth() + 1).padStart(2, "0");
  const dd  = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Enumerate all unique ISO weeks (sorted) that overlap a date range.
 * Returns strings like "2025-W03".
 */
function overlappingWeeks(from: string, to: string): string[] {
  const weeks = new Set<string>();
  let cur = from;
  while (cur <= to) {
    weeks.add(isoWeek(cur));
    cur = shiftDateByDays(cur, 1);
  }
  return [...weeks].sort();
}

// ── Date helpers — all LOCAL-SAFE (copied from ebitda-v2) ─────────────────────

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

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

function lastDayOfMonth(monthStr: string): string {
  const y    = parseInt(monthStr.slice(0, 4), 10);
  const m    = parseInt(monthStr.slice(5, 7), 10);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

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

function shiftMonth(dateStr: string, n: number): string {
  let y = parseInt(dateStr.slice(0, 4), 10);
  let m = parseInt(dateStr.slice(5, 7), 10) + n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Shift a YYYY-MM-DD date string by n months (±) keeping day clamped to EOM */
function shiftDateByMonths(dateStr: string, n: number): string {
  const d = parseLocalDate(dateStr);
  let   y = d.getFullYear();
  let   mo = d.getMonth() + 1 + n;   // 1-based
  while (mo > 12) { mo -= 12; y++; }
  while (mo < 1)  { mo += 12; y--; }
  const maxDay = new Date(y, mo, 0).getDate();
  const day    = Math.min(d.getDate(), maxDay);
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * For a given ISO week string ("YYYY-Www"), return [mondayDateStr, sundayDateStr].
 */
function weekBounds(weekStr: string): [string, string] {
  const [yearStr, wStr] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(wStr, 10);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = (jan4.getDay() + 6) % 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  };
  return [fmt(monday), fmt(sunday)];
}

// ── Per-venue accumulator for ONE period ─────────────────────────────────────

type VenueMonth = {
  revenue:      number;
  cockpit_revenue: number;  // services+products (for Klaviyo split + turnover rent)
  wages:        number;
  advertising:  number;
  sga:          number;
  cogs:         number;
  rent:         number;
  utilities:    number;
};

function emptyVM(): VenueMonth {
  return { revenue: 0, cockpit_revenue: 0, wages: 0, advertising: 0, sga: 0, cogs: 0, rent: 0, utilities: 0 };
}

/** Key: "PERIOD|venue"  where PERIOD is "YYYY-MM" (monthly) or "YYYY-Www" (weekly) */
type PeriodicAccum = Map<string, VenueMonth>;

function getVM(acc: PeriodicAccum, period: string, venue: string): VenueMonth {
  const k = `${period}|${venue}`;
  if (!acc.has(k)) acc.set(k, emptyVM());
  return acc.get(k)!;
}

// ── Supabase row types ────────────────────────────────────────────────────────

type RawRow = {
  venue:           string;
  ebitda_line:     string;
  ebitda_sub_line: string;
  contact_name:    string;
  amount:          number;
  account_code:    string;
  date:            string;
};

type RevDailyRow = {
  location_id:      number;
  date:             string;
  services:         number;
  product_phytomer: number;
  product_purest:   number;
  product_other:    number;
};

type RevMonthlyRow = {
  location_id:    number;
  month:          string;
  wholesale:      number;
  sales_discount: number;
  sales_refund:   number;
};

type SalesDailyRow = {
  date_of_service: string;
  price_ex_vat:    number;
};

type SuppRow = {
  month:         string;
  employee_name: string;
  amount:        number;
  spa_slug:      string;
  role:          string;
};

type WageRoleRow = {
  contact_key:   string;
  role:          string;
  venue_override: string | null;
  is_prof_fee:   boolean;
  monthly_floor: number | null;
};

type AdPatternRow = {
  pattern:   string;
  canonical: string;
};

type FallbackRuleRow = {
  account_code: string;
  account_name: string;
  zoho_org:     string;
  rule_type:    string;
  active:       boolean;
  params:       Record<string, unknown>;
};

type HardwiredRuleRow = {
  venue:          string;
  ebitda_line:    string;
  rule_type:      string;
  params:         Record<string, number>;
  effective_from: string;
  effective_to:   string | null;
};

// ── Data fetcher — fetches everything for a date range ────────────────────────

async function fetchRangeData(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  dateFrom:  string,
  dateTo:    string,
) {
  // 1a. Paginate transactions_raw (PostgREST max_rows=330, PAGE=200)
  const PAGE = 200;
  const allRawCosts: RawRow[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions_raw")
      .select("venue, ebitda_line, ebitda_sub_line, contact_name, amount, account_code, date")
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("date")
      .order("txn_id")
      .order("venue")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`transactions_raw page ${offset}: ${error.message}`);
    if (!data || data.length === 0) break;
    allRawCosts.push(...(data as RawRow[]));
  }

  const months = overlappingMonths(dateFrom, dateTo);

  // Paginate sales daily tables — Supabase caps non-paginated reads at 1000 rows,
  // which silently truncates months with high transaction volumes (400+ rows/month).
  async function paginateSalesDaily(table: "aesthetics_sales_daily" | "slimming_sales_daily"): Promise<SalesDailyRow[]> {
    const SALES_PAGE = 1000;
    const all: SalesDailyRow[] = [];
    for (let offset = 0; offset < 100_000; offset += SALES_PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select("date_of_service, price_ex_vat")
        .gte("date_of_service", dateFrom)
        .lte("date_of_service", dateTo)
        .order("date_of_service")
        .range(offset, offset + SALES_PAGE - 1);
      if (error) throw new Error(`${table} page ${offset}: ${error.message}`);
      if (!data || data.length === 0) break;
      all.push(...(data as SalesDailyRow[]));
      if (data.length < SALES_PAGE) break;
    }
    return all;
  }

  const [revDaily, revMonthly, aesSales, slimSales, supplement] = await Promise.all([
    supabase
      .from("spa_revenue_daily")
      .select("location_id, date, services, product_phytomer, product_purest, product_other")
      .gte("date", dateFrom)
      .lte("date", dateTo),

    supabase
      .from("spa_revenue_monthly")
      .select("location_id, month, wholesale, sales_discount, sales_refund")
      .in("month", months),

    paginateSalesDaily("aesthetics_sales_daily"),

    paginateSalesDaily("slimming_sales_daily"),

    supabase
      .from("salary_supplement_monthly")
      .select("month, employee_name, amount, spa_slug, role")
      .in("month", [
        ...overlappingMonths(shiftMonth(dateFrom, -3), dateFrom.slice(0, 7) + "-01"),
        ...months,
      ].filter((v, i, a) => a.indexOf(v) === i))
      .eq("is_frozen", true),
  ]);

  for (const [label, res] of [
    ["spa_revenue_daily",   revDaily],
    ["spa_revenue_monthly", revMonthly],
    ["salary_supplement_monthly", supplement],
  ] as Array<[string, { error: { message: string } | null }]>) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  return {
    allRawCosts,
    revDaily:   (revDaily.data   ?? []) as RevDailyRow[],
    revMonthly: (revMonthly.data ?? []) as RevMonthlyRow[],
    aesSales,
    slimSales,
    supplement: (supplement.data ?? []) as SuppRow[],
  };
}

// ── Period key resolver ───────────────────────────────────────────────────────

/**
 * Given a date string and granularity, returns the period key.
 *   monthly: "2025-01"
 *   weekly:  "2025-W03"
 */
function dateToPeriod(dateStr: string, granularity: "monthly" | "weekly"): string {
  if (granularity === "weekly") return isoWeek(dateStr);
  return dateStr.slice(0, 7);
}

// ── Main aggregator ───────────────────────────────────────────────────────────

const WAGE_ROLES = ["manager","reception","therapist","practitioner","crm","unassigned"] as const;

/**
 * Aggregates fetched data into a PeriodicAccum keyed by "PERIOD|venue".
 * Config tables (wageRoleMap, profFeeMap, adPatternsArr, hardwiredRules,
 * fallbackRules) are shared (same for both ranges).
 */
async function aggregateRange(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  dateFrom:    string,
  dateTo:      string,
  granularity: "monthly" | "weekly",
  rangeData:   Awaited<ReturnType<typeof fetchRangeData>>,
  _wageRoleMap: Map<string, string>,
  wageVenueOverride: Map<string, string>,
  profFeeMap:  Map<string, { monthly_floor: number; venue: string }>,
  adPatternsArr: AdPatternRow[],
  hardwiredRules: HardwiredRuleRow[],
  fallbackRules:  FallbackRuleRow[],
): Promise<PeriodicAccum> {
  const acc: PeriodicAccum = new Map();
  const { allRawCosts, revDaily, revMonthly, aesSales, slimSales, supplement } = rangeData;

  const KNOWN_AD_CHANNELS = new Set(["meta","google","klaviyo"]);
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

  // Build hardwired map: "venue|ebitda_line" → rule (only if effective in this range)
  type HardwiredEntry = { rule_type: string; params: Record<string, number> };
  const hwMap = new Map<string, HardwiredEntry>();
  for (const r of hardwiredRules) {
    if (dateTo   < r.effective_from) continue;
    if (r.effective_to && dateFrom > r.effective_to) continue;
    hwMap.set(`${r.venue}|${r.ebitda_line}`, { rule_type: r.rule_type, params: r.params ?? {} });
  }

  const allSlugs = new Set<string>(VENUE_CONFIG.map(v => v.slug));

  // ── 1. Revenue ────────────────────────────────────────────────────────────
  // 1a. SPA daily Cockpit revenue
  for (const row of revDaily) {
    const slug = LOC_ID_TO_SLUG[row.location_id];
    if (!slug) continue;
    const period = dateToPeriod(row.date as string, granularity);
    // services + product_* hold inc-VAT after migration 073. Divide for ex-VAT.
    const cockpitSalesInc = (
      Number(row.services         ?? 0) +
      Number(row.product_phytomer ?? 0) +
      Number(row.product_purest   ?? 0) +
      Number(row.product_other    ?? 0)
    );
    const cockpitSales = cockpitSalesInc / 1.18;
    const vm = getVM(acc, period, slug);
    vm.revenue       += cockpitSales;
    vm.cockpit_revenue += cockpitSales;
  }

  // 1b. SPA monthly adjustments (wholesale, discount, refund)
  if (granularity === "monthly") {
    // Monthly: pro-rate by days-in-range / days-in-month (existing logic)
    for (const row of revMonthly) {
      const slug = LOC_ID_TO_SLUG[row.location_id];
      if (!slug) continue;
      const monthStr   = (row.month as string).slice(0, 10);   // "YYYY-MM-01"
      const yyyyMM     = monthStr.slice(0, 7);
      const daysInMo   = totalDaysInMonth(monthStr);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;
      const factor = daysInRange / daysInMo;
      const adj = (
        (Number(row.wholesale      ?? 0) -
         Number(row.sales_discount ?? 0) -
         Number(row.sales_refund   ?? 0)) * factor
      );
      getVM(acc, yyyyMM, slug).revenue += adj;
    }
  } else {
    // Weekly: pro-rate each monthly adjustment into each overlapping ISO week
    for (const row of revMonthly) {
      const slug = LOC_ID_TO_SLUG[row.location_id];
      if (!slug) continue;
      const monthStr   = (row.month as string).slice(0, 10);   // "YYYY-MM-01"
      const daysInMo   = totalDaysInMonth(monthStr);
      const monthEnd   = lastDayOfMonth(monthStr);
      const totalAdj   = (
        Number(row.wholesale      ?? 0) -
        Number(row.sales_discount ?? 0) -
        Number(row.sales_refund   ?? 0)
      );
      if (totalAdj === 0) continue;

      // Find all weeks in our range that overlap this month
      const weeksInRange = overlappingWeeks(
        dateFrom > monthStr ? dateFrom : monthStr,
        dateTo   < monthEnd ? dateTo   : monthEnd,
      );
      for (const wk of weeksInRange) {
        const [wMon, wSun] = weekBounds(wk);
        // Overlap between this week and this month
        const overlapStart = wMon > monthStr ? wMon : monthStr;
        const overlapEnd   = wSun < monthEnd ? wSun : monthEnd;
        // Also clamp to overall date range
        const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
        const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
        if (clampedStart > clampedEnd) continue;
        const overlapDays = daysBetween(clampedStart, clampedEnd);
        const factor = overlapDays / daysInMo;
        getVM(acc, wk, slug).revenue += totalAdj * factor;
      }
    }
  }

  // 1c. Aesthetics daily revenue — group by period
  for (const row of aesSales) {
    const period = dateToPeriod(row.date_of_service as string, granularity);
    getVM(acc, period, "aesthetics").revenue += Number(row.price_ex_vat ?? 0);
  }
  // 1d. Slimming daily revenue — group by period
  for (const row of slimSales) {
    const period = dateToPeriod(row.date_of_service as string, granularity);
    getVM(acc, period, "slimming").revenue += Number(row.price_ex_vat ?? 0);
  }

  // ── 2. Costs from transactions_raw ───────────────────────────────────────
  for (const row of allRawCosts) {
    const venue   = row.venue ?? "unallocated";
    const line    = row.ebitda_line;
    const contact = row.contact_name ?? "";
    const amount  = Number(row.amount ?? 0);
    const period  = dateToPeriod(row.date as string, granularity);

    if (!allSlugs.has(venue)) continue;
    if (line === "revenue")   continue;

    // Skip if hardwired rule overrides this venue+line combo
    if (hwMap.has(`${venue}|${line}`)) continue;

    switch (line) {
      case "wages": {
        const roleKey = contact.toLowerCase().trim();
        if (profFeeMap.has(roleKey)) {
          // Prof fee contractor → sga in target venue
          const pfVenue = profFeeMap.get(roleKey)!.venue;
          if (!allSlugs.has(pfVenue)) break;
          getVM(acc, period, pfVenue).sga += amount;
          break;
        }
        const effectiveVenue = wageVenueOverride.get(roleKey) ?? venue;
        if (!allSlugs.has(effectiveVenue)) break;
        getVM(acc, period, effectiveVenue).wages += amount;
        break;
      }
      case "advertising": {
        const ch = resolveAdChannel(contact);
        if (ch === "klaviyo" && venue === "hq") {
          // Klaviyo HQ → split across SPA venues by cockpit_revenue ratio for this period
          const totalSpaRev = SPA_SLUGS.reduce(
            (s, sv) => s + (acc.get(`${period}|${sv}`)?.cockpit_revenue ?? 0), 0,
          );
          for (const sv of SPA_SLUGS) {
            const spaRev = acc.get(`${period}|${sv}`)?.cockpit_revenue ?? 0;
            const ratio  = totalSpaRev > 0 ? spaRev / totalSpaRev : 1 / 8;
            getVM(acc, period, sv).advertising += amount * ratio;
          }
          break;
        }
        getVM(acc, period, venue).advertising += amount;
        break;
      }
      case "sga":       { getVM(acc, period, venue).sga       += amount; break; }
      case "cogs":      { getVM(acc, period, venue).cogs      += amount; break; }
      case "rent":      { getVM(acc, period, venue).rent      += amount; break; }
      case "utilities": { getVM(acc, period, venue).utilities += amount; break; }
      default:
        console.warn(`[ebitda-longitudinal] Unknown ebitda_line: "${line}" (venue: ${venue})`);
        break;
    }
  }

  // ── 3. Hardwired venue rules ─────────────────────────────────────────────
  if (granularity === "monthly") {
    // Monthly: apply per calendar month (existing logic)
    for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
      const yyyyMM      = monthStr.slice(0, 7);
      const daysInMo    = totalDaysInMonth(monthStr);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;

      for (const [key, rule] of hwMap) {
        const [hwVenue, hwLine] = key.split("|");
        const vm = getVM(acc, yyyyMM, hwVenue);

        let value = 0;
        if (rule.rule_type === "fixed_monthly") {
          value = (rule.params.monthly_amount ?? 0) * (daysInRange / daysInMo);
        } else if (rule.rule_type === "base_plus_revenue_pct") {
          const pct  = (rule.params.revenue_pct  ?? 0) / 100;
          const base = (rule.params.base_monthly ?? 0) * (daysInRange / daysInMo);
          const revBase = vm.cockpit_revenue || vm.revenue;
          value = base + revBase * pct;
        }

        if (hwLine === "rent")           vm.rent      = value;
        else if (hwLine === "utilities") vm.utilities = value;
      }
    }
  } else {
    // Weekly: pro-rate monthly hardwired amounts into weeks
    for (const wk of overlappingWeeks(dateFrom, dateTo)) {
      const [wMon, wSun] = weekBounds(wk);

      for (const [key, rule] of hwMap) {
        const [hwVenue, hwLine] = key.split("|");
        const vm = getVM(acc, wk, hwVenue);

        // For each calendar month this week overlaps, accumulate a pro-rated value
        let totalValue = 0;
        const monthsForWeek = overlappingMonths(
          wMon > dateFrom ? wMon : dateFrom,
          wSun < dateTo   ? wSun : dateTo,
        );
        for (const monthStr of monthsForWeek) {
          const monthEnd    = lastDayOfMonth(monthStr);
          const daysInMo    = totalDaysInMonth(monthStr);
          // Overlap of week ∩ month ∩ overall range
          const overlapStart = (wMon > monthStr ? wMon : monthStr);
          const overlapEnd   = (wSun < monthEnd ? wSun : monthEnd);
          const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
          const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
          if (clampedStart > clampedEnd) continue;
          const overlapDays = daysBetween(clampedStart, clampedEnd);
          const factor = overlapDays / daysInMo;

          if (rule.rule_type === "fixed_monthly") {
            totalValue += (rule.params.monthly_amount ?? 0) * factor;
          } else if (rule.rule_type === "base_plus_revenue_pct") {
            const pct  = (rule.params.revenue_pct  ?? 0) / 100;
            const base = (rule.params.base_monthly ?? 0) * factor;
            const revBase = vm.cockpit_revenue || vm.revenue;
            totalValue += base + revBase * pct;
          }
        }

        if (hwLine === "rent")           vm.rent      = totalValue;
        else if (hwLine === "utilities") vm.utilities = totalValue;
      }
    }
  }

  // ── 4. min_monthly cost floor rules (from ebitda_fallback_rules) ─────────
  const minRules = fallbackRules.filter(r => r.active && r.rule_type === "min_monthly");
  for (const rule of minRules) {
    const params      = rule.params ?? {};
    const monthlyAmt  = Number(params.monthly_amount ?? 0);
    if (!monthlyAmt) continue;
    const ebitdaLine = (params.ebitda_line  as string) ?? "sg_and_a";
    const accountCode = rule.account_code;
    const targetVenues: string[] = Array.isArray(params.venues)
      ? (params.venues as string[])
      : params.venue ? [params.venue as string] : [];
    const splitEqual = params.split === "equal";
    const numVenues  = targetVenues.length || 1;

    if (granularity === "monthly") {
      // Period-aggregate approach (mirrors ebitda-v2): compare total floor across
      // the requested period to total actual across the same period. Prevents
      // phantom supplements when a vendor bills lumpy/quarterly — one big posting
      // in March covers the floor for Apr+May too, instead of triggering monthly
      // top-ups that already-paid actuals can't offset.
      const monthBuckets: { yyyyMM: string; days: number }[] = [];
      for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
        const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
        if (daysInRange === 0) continue;
        monthBuckets.push({ yyyyMM: monthStr.slice(0, 7), days: daysInRange });
      }
      const totalDays = monthBuckets.reduce((s, b) => s + b.days, 0);
      if (totalDays === 0) continue;

      for (const venue of targetVenues) {
        if (!allSlugs.has(venue)) continue;

        let periodFloor = 0;
        for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
          const daysInMo    = totalDaysInMonth(monthStr);
          const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
          if (daysInRange === 0) continue;
          const monthlyFloor = monthlyAmt * (daysInRange / daysInMo);
          periodFloor += splitEqual ? monthlyFloor / numVenues : monthlyFloor;
        }

        const periodActual = allRawCosts
          .filter(r => r.venue === venue && r.account_code === accountCode)
          .reduce((sum, r) => sum + Number(r.amount), 0);

        const periodSupp = Math.max(0, periodFloor - periodActual);
        if (periodSupp === 0) continue;

        // Distribute the period supplement across months in range proportional
        // to days-in-range, so chart bars still vary smoothly across the period.
        for (const { yyyyMM, days } of monthBuckets) {
          const share = periodSupp * (days / totalDays);
          const vm = getVM(acc, yyyyMM, venue);
          if      (ebitdaLine === "utilities") vm.utilities += share;
          else if (ebitdaLine === "cogs")      vm.cogs      += share;
          else                                  vm.sga       += share;
        }
      }
    } else {
      // Weekly: pro-rate floor into weeks
      for (const wk of overlappingWeeks(dateFrom, dateTo)) {
        const [wMon, wSun] = weekBounds(wk);
        const monthsForWeek = overlappingMonths(
          wMon > dateFrom ? wMon : dateFrom,
          wSun < dateTo   ? wSun : dateTo,
        );
        let weekFloor = 0;
        for (const monthStr of monthsForWeek) {
          const monthEnd    = lastDayOfMonth(monthStr);
          const daysInMo    = totalDaysInMonth(monthStr);
          const overlapStart = (wMon > monthStr ? wMon : monthStr);
          const overlapEnd   = (wSun < monthEnd ? wSun : monthEnd);
          const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
          const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
          if (clampedStart > clampedEnd) continue;
          const overlapDays = daysBetween(clampedStart, clampedEnd);
          weekFloor += monthlyAmt * (overlapDays / daysInMo);
        }

        for (const venue of targetVenues) {
          if (!allSlugs.has(venue)) continue;
          const venueFloor = splitEqual ? weekFloor / numVenues : weekFloor;
          // Check actual for this account+venue+week
          const actual = allRawCosts
            .filter(r => r.venue === venue && r.account_code === accountCode && isoWeek(r.date ?? "1970-01-01") === wk)
            .reduce((sum, r) => sum + Number(r.amount), 0);
          const supp = Math.max(0, venueFloor - actual);
          if (supp === 0) continue;
          const vm = getVM(acc, wk, venue);
          if      (ebitdaLine === "utilities") vm.utilities += supp;
          else if (ebitdaLine === "cogs")      vm.cogs      += supp;
          else                                  vm.sga       += supp;
        }
      }
    }
  }

  // ── 5. Prof fee min_monthly floors ───────────────────────────────────────
  for (const [contactKey, pf] of profFeeMap) {
    if (!pf.monthly_floor) continue;
    const targetVenue = pf.venue;
    if (!allSlugs.has(targetVenue)) continue;

    if (granularity === "monthly") {
      // Period-aggregate (mirrors ebitda-v2): compare total floor to total actual
      // across the period so quarterly billing doesn't trigger phantom monthly top-ups.
      const monthBuckets: { yyyyMM: string; days: number }[] = [];
      let periodFloor = 0;
      for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
        const daysInMo    = totalDaysInMonth(monthStr);
        const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
        if (daysInRange === 0) continue;
        monthBuckets.push({ yyyyMM: monthStr.slice(0, 7), days: daysInRange });
        periodFloor += pf.monthly_floor * (daysInRange / daysInMo);
      }
      const totalDays = monthBuckets.reduce((s, b) => s + b.days, 0);
      if (totalDays === 0) continue;

      const periodActual = allRawCosts
        .filter(r => (r.contact_name ?? "").toLowerCase().trim() === contactKey)
        .reduce((sum, r) => sum + Number(r.amount), 0);

      const periodSupp = Math.max(0, periodFloor - periodActual);
      if (periodSupp > 0) {
        for (const { yyyyMM, days } of monthBuckets) {
          getVM(acc, yyyyMM, targetVenue).sga += periodSupp * (days / totalDays);
        }
      }
    } else {
      // Weekly: pro-rate prof-fee floor into weeks
      for (const wk of overlappingWeeks(dateFrom, dateTo)) {
        const [wMon, wSun] = weekBounds(wk);
        const monthsForWeek = overlappingMonths(
          wMon > dateFrom ? wMon : dateFrom,
          wSun < dateTo   ? wSun : dateTo,
        );
        let weekFloor = 0;
        for (const monthStr of monthsForWeek) {
          const monthEnd    = lastDayOfMonth(monthStr);
          const daysInMo    = totalDaysInMonth(monthStr);
          const overlapStart = (wMon > monthStr ? wMon : monthStr);
          const overlapEnd   = (wSun < monthEnd ? wSun : monthEnd);
          const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
          const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
          if (clampedStart > clampedEnd) continue;
          const overlapDays = daysBetween(clampedStart, clampedEnd);
          weekFloor += pf.monthly_floor * (overlapDays / daysInMo);
        }
        const actual = allRawCosts
          .filter(r => (r.contact_name ?? "").toLowerCase().trim() === contactKey && isoWeek(r.date ?? "1970-01-01") === wk)
          .reduce((sum, r) => sum + Number(r.amount), 0);
        const supp = Math.max(0, weekFloor - actual);
        if (supp > 0) getVM(acc, wk, targetVenue).sga += supp;
      }
    }
  }

  // ── 6. Salary supplement → wages (with prior-month fallback) ─────────────
  type SuppEntry = { spa_slug: string; amount: number; role: string };
  const suppByMonth = new Map<string, SuppEntry[]>();
  for (const row of supplement) {
    const m = (row.month as string).slice(0, 10); // "YYYY-MM-01"
    if (!suppByMonth.has(m)) suppByMonth.set(m, []);
    suppByMonth.get(m)!.push({
      spa_slug: row.spa_slug ?? "",
      amount:   Number(row.amount ?? 0),
      role:     ((row.role as string) || "").toLowerCase().trim() || "unassigned",
    });
  }
  const frozenMonths = Array.from(suppByMonth.keys()).sort();

  if (granularity === "monthly") {
    for (const targetMonthStr of overlappingMonths(dateFrom, dateTo)) {
      const yyyyMM = targetMonthStr.slice(0, 7);
      let rows = suppByMonth.get(targetMonthStr);
      if (!rows || rows.length === 0) {
        const candidate = [...frozenMonths].reverse().find(m => m < targetMonthStr);
        if (candidate) rows = suppByMonth.get(candidate)!;
      }
      if (!rows || rows.length === 0) continue;

      const daysInRange = daysOfMonthInRange(targetMonthStr, dateFrom, dateTo);
      const factor      = daysInRange / totalDaysInMonth(targetMonthStr);

      for (const row of rows) {
        if (!row.spa_slug || !allSlugs.has(row.spa_slug)) continue;
        const suppRole = (WAGE_ROLES as readonly string[]).includes(row.role) ? row.role : "unassigned";
        void suppRole; // role detail is not tracked in longitudinal (top-level only)
        getVM(acc, yyyyMM, row.spa_slug).wages += row.amount * factor;
      }
    }
  } else {
    // Weekly: pro-rate supplement into weeks (using the same month-resolution fallback)
    for (const wk of overlappingWeeks(dateFrom, dateTo)) {
      const [wMon, wSun] = weekBounds(wk);
      const monthsForWeek = overlappingMonths(
        wMon > dateFrom ? wMon : dateFrom,
        wSun < dateTo   ? wSun : dateTo,
      );
      for (const targetMonthStr of monthsForWeek) {
        const monthEnd    = lastDayOfMonth(targetMonthStr);
        const daysInMo    = totalDaysInMonth(targetMonthStr);

        let rows = suppByMonth.get(targetMonthStr);
        if (!rows || rows.length === 0) {
          const candidate = [...frozenMonths].reverse().find(m => m < targetMonthStr);
          if (candidate) rows = suppByMonth.get(candidate)!;
        }
        if (!rows || rows.length === 0) continue;

        // How many days of this month fall within this week (clamped to overall range)
        const overlapStart = (wMon > targetMonthStr ? wMon : targetMonthStr);
        const overlapEnd   = (wSun < monthEnd ? wSun : monthEnd);
        const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
        const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
        if (clampedStart > clampedEnd) continue;
        const overlapDays = daysBetween(clampedStart, clampedEnd);
        const factor = overlapDays / daysInMo;

        for (const row of rows) {
          if (!row.spa_slug || !allSlugs.has(row.spa_slug)) continue;
          const suppRole = (WAGE_ROLES as readonly string[]).includes(row.role) ? row.role : "unassigned";
          void suppRole;
          getVM(acc, wk, row.spa_slug).wages += row.amount * factor;
        }
      }
    }
  }

  // ── 7. TTM-based fallback for partial/missing months ──────────────────────
  // For each active fallback rule: if no real transaction exists for that
  // account+venue in a given month, apply TTM/previous_month/manual estimate.
  // This prevents chart dips caused by late postings.
  // NOTE: TTM fallbacks are computed per-month even in weekly mode, then pro-rated
  // into weeks by day-count to avoid per-week DB round-trips.
  const activeFallbacks = fallbackRules.filter(r => r.active && r.rule_type !== "min_monthly");
  if (activeFallbacks.length > 0) {
    const activeCodes = activeFallbacks.map(r => r.account_code);

    // Fetch 12-month TTM history (ending day before dateFrom)
    const ttmTo   = dateFrom;
    const ttmFrom = shiftMonth(dateFrom, -12);
    const HIST_PAGE = 200;

    type HistRaw = { account_code: string; venue: string; date: string; amount: number; ebitda_line: string; ebitda_sub_line: string };
    async function fetchHistRows(from: string, to: string): Promise<HistRaw[]> {
      const all: HistRaw[] = [];
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
        all.push(...(data as HistRaw[]));
      }
      return all;
    }

    const prevMonthFrom = shiftMonth(dateFrom, -1);
    const [histRows, prevRows] = await Promise.all([
      fetchHistRows(ttmFrom, ttmTo),
      fetchHistRows(prevMonthFrom, dateFrom),
    ]);

    type HistKey = string; // "account_code|venue"
    const histMap    = new Map<HistKey, { ttm: number; ebitda_line: string; months: Set<string> }>();
    for (const r of histRows) {
      const k   = `${r.account_code}|${r.venue}`;
      const mon = (r.date ?? "").slice(0, 7);
      const ex  = histMap.get(k);
      if (ex) {
        ex.ttm += Number(r.amount ?? 0);
        ex.months.add(mon);
      } else {
        histMap.set(k, { ttm: Number(r.amount ?? 0), ebitda_line: r.ebitda_line || "sga", months: new Set([mon]) });
      }
    }

    const prevMap = new Map<HistKey, number>();
    for (const r of prevRows) {
      const k = `${r.account_code}|${r.venue}`;
      prevMap.set(k, (prevMap.get(k) ?? 0) + Number(r.amount ?? 0));
    }

    const prevMonthStr    = prevMonthFrom + "-01"; // already "YYYY-MM-01"
    const daysInPrevMonth = totalDaysInMonth(prevMonthStr);

    for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
      const yyyyMM      = monthStr.slice(0, 7);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;

      // Mirror ebitda-v2: only apply TTM/prev-month fallbacks for partial calendar months.
      // Complete past months use actual Zoho data exclusively — applying fallbacks there
      // inflates costs when accounts post quarterly (phantom monthly estimates stack on top
      // of the real quarterly posting for the months without transactions).
      if (daysInRange === totalDaysInMonth(monthStr)) continue;

      const appliedFallbackKeys = new Set<string>();

      for (const rule of activeFallbacks) {
        const ruleType    = rule.rule_type;
        const accountCode = rule.account_code;
        const venueKeys   = [...histMap.keys()].filter(k => k.startsWith(accountCode + "|"));

        for (const key of venueKeys) {
          const [, venue] = key.split("|");
          if (!allSlugs.has(venue)) continue;
          const hist = histMap.get(key)!;

          const dedupKey = `${accountCode}|${venue}`;
          if (appliedFallbackKeys.has(dedupKey)) continue;

          // Skip if hardwired rule overrides this venue+line
          if (hwMap.has(`${venue}|${hist.ebitda_line}`)) continue;

          // Skip if real data already exists for this account+venue+month
          const alreadyHasData = allRawCosts.some(
            r => r.venue === venue && r.account_code === accountCode && (r.date ?? "").slice(0, 7) === yyyyMM,
          );
          if (alreadyHasData) continue;

          appliedFallbackKeys.add(dedupKey);

          let fallbackValue = 0;
          if (ruleType === "ttm_spread") {
            const actualMonths = Math.max(hist.months.size, 1);
            const annualised   = (hist.ttm / actualMonths) * 12;
            fallbackValue = annualised * (daysInRange / 365);
          } else if (ruleType === "previous_month") {
            const prev = prevMap.get(key) ?? 0;
            fallbackValue = prev * (daysInRange / daysInPrevMonth);
          } else if (ruleType === "manual_annual") {
            const annual = (rule.params?.annual_amount as number) ?? 0;
            fallbackValue = annual * (daysInRange / 365);
          } else if (ruleType === "quarterly_average") {
            fallbackValue = hist.ttm * (3 / 12) / 3 * (daysInRange / 30.4375);
          } else {
            continue;
          }

          if (fallbackValue <= 0) continue;

          if (granularity === "monthly") {
            // Apply directly to month period key
            const vm   = getVM(acc, yyyyMM, venue);
            const line = hist.ebitda_line;
            if      (line === "wages")       vm.wages      += fallbackValue;
            else if (line === "advertising") vm.advertising += fallbackValue;
            else if (line === "sga")         vm.sga        += fallbackValue;
            else if (line === "cogs")        vm.cogs       += fallbackValue;
            else if (line === "rent")        vm.rent       += fallbackValue;
            else if (line === "utilities")   vm.utilities  += fallbackValue;
          } else {
            // Weekly: distribute the monthly fallback amount pro-rata into each week
            const monthEnd = lastDayOfMonth(monthStr);
            const weeksInMonth = overlappingWeeks(
              monthStr > dateFrom ? monthStr : dateFrom,
              monthEnd < dateTo   ? monthEnd : dateTo,
            );
            for (const wk of weeksInMonth) {
              const [wMon, wSun] = weekBounds(wk);
              const overlapStart = (wMon > monthStr ? wMon : monthStr);
              const overlapEnd   = (wSun < monthEnd ? wSun : monthEnd);
              const clampedStart = overlapStart > dateFrom ? overlapStart : dateFrom;
              const clampedEnd   = overlapEnd   < dateTo   ? overlapEnd   : dateTo;
              if (clampedStart > clampedEnd) continue;
              const wkDays = daysBetween(clampedStart, clampedEnd);
              const wkFallback = fallbackValue * (wkDays / daysInRange);
              if (wkFallback <= 0) continue;
              const vm   = getVM(acc, wk, venue);
              const line = hist.ebitda_line;
              if      (line === "wages")       vm.wages      += wkFallback;
              else if (line === "advertising") vm.advertising += wkFallback;
              else if (line === "sga")         vm.sga        += wkFallback;
              else if (line === "cogs")        vm.cogs       += wkFallback;
              else if (line === "rent")        vm.rent       += wkFallback;
              else if (line === "utilities")   vm.utilities  += wkFallback;
            }
          }
        }
      }
    }
  }

  return acc;
}

// ── Collapse a PeriodicAccum period into MonthTotals for a brand ─────────────

function zeroTotals(): MonthTotals {
  return { revenue: 0, ebitda: 0, ebitda_pct: 0, wages: 0, advertising: 0, sga: 0, rent: 0, cogs: 0, utilities: 0 };
}

function computeEbitdaPct(t: MonthTotals): void {
  t.ebitda     = +(t.revenue - t.wages - t.advertising - t.sga - t.cogs - t.rent - t.utilities).toFixed(2);
  t.ebitda_pct = t.revenue !== 0 ? +((t.ebitda / t.revenue) * 100).toFixed(2) : 0;
}

function addVM(t: MonthTotals, vm: VenueMonth): void {
  t.revenue     += vm.revenue;
  t.wages       += vm.wages;
  t.advertising += vm.advertising;
  t.sga         += vm.sga;
  t.cogs        += vm.cogs;
  t.rent        += vm.rent;
  t.utilities   += vm.utilities;
}

function buildBrandTotals(acc: PeriodicAccum, period: string): BrandTotals {
  const group: MonthTotals = zeroTotals();
  const spa:   MonthTotals = zeroTotals();
  const aes:   MonthTotals = zeroTotals();
  const slim:  MonthTotals = zeroTotals();

  for (const vc of VENUE_CONFIG) {
    const vm = acc.get(`${period}|${vc.slug}`) ?? emptyVM();
    addVM(group, vm);
    if (vc.brand === "SPA")  addVM(spa,  vm);
    if (vc.brand === "AES")  addVM(aes,  vm);
    if (vc.brand === "SLIM") addVM(slim, vm);
    // HQ included in group only — not in any brand subtotal
  }

  computeEbitdaPct(group);
  computeEbitdaPct(spa);
  computeEbitdaPct(aes);
  computeEbitdaPct(slim);

  return { ...group, spa, aes, slim };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  const granularityParam = searchParams.get("granularity") ?? "monthly";

  if (!dateFrom || !dateTo)
    return NextResponse.json({ error: "date_from and date_to required" }, { status: 400 });

  if (granularityParam !== "monthly" && granularityParam !== "weekly")
    return NextResponse.json({ error: "granularity must be 'monthly' or 'weekly'" }, { status: 400 });

  const granularity: "monthly" | "weekly" = granularityParam;

  const supabase = await createServerSupabaseClient();

  // SPPY range:
  //   monthly → same calendar months, 12 months earlier
  //   weekly  → same ISO weeks, 364 days (52 weeks) earlier (preserves weekday alignment)
  const sppyFrom = granularity === "weekly"
    ? shiftDateByDays(dateFrom, -364)
    : shiftDateByMonths(dateFrom, -12);
  const sppyTo = granularity === "weekly"
    ? shiftDateByDays(dateTo, -364)
    : shiftDateByMonths(dateTo, -12);

  // ── Load config tables once (shared across both ranges) ──────────────────
  const [wageRolesRes, adPatternsRes, fallbackRulesRes, hardwiredRulesRes] = await Promise.all([
    supabase.from("wage_role_mapping").select("contact_key, role, venue_override, is_prof_fee, monthly_floor"),
    supabase.from("advertising_contact_mapping").select("pattern, canonical, priority").order("priority"),
    supabase.from("ebitda_fallback_rules").select("account_code, account_name, zoho_org, rule_type, active, params"),
    supabase.from("ebitda_v2_hardwired_rules").select("*"),
  ]);

  for (const [label, res] of [
    ["wage_role_mapping",         wageRolesRes],
    ["advertising_contact_mapping", adPatternsRes],
    ["ebitda_fallback_rules",     fallbackRulesRes],
    ["ebitda_v2_hardwired_rules", hardwiredRulesRes],
  ] as Array<[string, { error: { message: string } | null }]>) {
    if (res.error) return NextResponse.json({ error: `${label}: ${res.error.message}` }, { status: 500 });
  }

  // Build wage maps
  const wageRoleMap      = new Map<string, string>();
  const wageVenueOverride = new Map<string, string>();
  const profFeeMap       = new Map<string, { monthly_floor: number; venue: string }>();
  for (const row of (wageRolesRes.data ?? []) as WageRoleRow[]) {
    const key = (row.contact_key as string).toLowerCase().trim();
    wageRoleMap.set(key, row.role as string);
    if (row.venue_override) wageVenueOverride.set(key, row.venue_override as string);
    if (row.is_prof_fee) {
      profFeeMap.set(key, {
        monthly_floor: Number(row.monthly_floor ?? 0),
        venue:         (row.venue_override as string) ?? "hq",
      });
    }
  }

  const adPatternsArr   = (adPatternsRes.data    ?? []) as AdPatternRow[];
  const fallbackRules   = (fallbackRulesRes.data  ?? []) as FallbackRuleRow[];
  const hardwiredRules  = (hardwiredRulesRes.data ?? []) as HardwiredRuleRow[];

  // ── Fetch data for both ranges in parallel ────────────────────────────────
  let currentData: Awaited<ReturnType<typeof fetchRangeData>>;
  let sppyData:    Awaited<ReturnType<typeof fetchRangeData>> | null = null;

  try {
    [currentData, sppyData] = await Promise.all([
      fetchRangeData(supabase, dateFrom, dateTo),
      fetchRangeData(supabase, sppyFrom, sppyTo).catch(() => null),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── Aggregate both ranges ─────────────────────────────────────────────────
  const [currentAcc, sppyAcc] = await Promise.all([
    aggregateRange(supabase, dateFrom, dateTo, granularity, currentData,
      wageRoleMap, wageVenueOverride, profFeeMap, adPatternsArr, hardwiredRules, fallbackRules),
    sppyData
      ? aggregateRange(supabase, sppyFrom, sppyTo, granularity, sppyData,
          wageRoleMap, wageVenueOverride, profFeeMap, adPatternsArr, hardwiredRules, fallbackRules)
      : Promise.resolve(new Map() as PeriodicAccum),
  ]);

  // ── Build output periods ──────────────────────────────────────────────────
  let periods: LongitudinalPeriod[];

  if (granularity === "monthly") {
    const months = overlappingMonths(dateFrom, dateTo);
    periods = months.map(monthStr => {
      const yyyyMM     = monthStr.slice(0, 7);                 // "YYYY-MM"
      const sppyYYYYMM = shiftMonth(monthStr, -12).slice(0, 7);

      const current = buildBrandTotals(currentAcc, yyyyMM);

      // SPPY is null when no data exists for that prior-year month
      const hasSppyData = sppyAcc.size > 0 && (
        [...sppyAcc.keys()].some(k => k.startsWith(sppyYYYYMM + "|"))
      );
      const sppy = hasSppyData ? buildBrandTotals(sppyAcc, sppyYYYYMM) : null;

      return {
        period:  yyyyMM,
        label:   monthLabel(yyyyMM),
        current,
        sppy,
      };
    });
  } else {
    // Weekly
    const weeks = overlappingWeeks(dateFrom, dateTo);
    periods = weeks.map(wk => {
      // SPPY week = same week key but in the SPPY range (364 days back same ISO week)
      // Since SPPY range is shifted back by exactly 364 days, the ISO week numbers
      // align perfectly (52 weeks × 7 days = 364 days).
      const sppyWk = isoWeek(shiftDateByDays(weekBounds(wk)[0], -364));

      const current = buildBrandTotals(currentAcc, wk);

      const hasSppyData = sppyAcc.size > 0 && (
        [...sppyAcc.keys()].some(k => k.startsWith(sppyWk + "|"))
      );
      const sppy = hasSppyData ? buildBrandTotals(sppyAcc, sppyWk) : null;

      return {
        period: wk,
        label:  weekLabel(wk),
        current,
        sppy,
      };
    });
  }

  const response: LongitudinalResponse = {
    date_from:   dateFrom,
    date_to:     dateTo,
    granularity,
    periods,
  };

  return NextResponse.json(response);
}
