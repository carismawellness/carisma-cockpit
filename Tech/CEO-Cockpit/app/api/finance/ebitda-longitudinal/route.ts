/**
 * /api/finance/ebitda-longitudinal
 *
 * Returns month-by-month EBITDA for a date range, plus SPPY (same period
 * previous year = exact same calendar months shifted back 1 year).
 *
 * All data is fetched in two wide shots (current range + SPPY range) and
 * aggregated in memory — no per-month round-trips.
 *
 * Query params:
 *   date_from  YYYY-MM-DD (required — first day of first month to show)
 *   date_to    YYYY-MM-DD (required, inclusive — last day of last month to show)
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
  month:   string;       // "2025-01"
  label:   string;       // "Jan 2025"
  current: BrandTotals;
  sppy:    BrandTotals | null;
};

export type LongitudinalResponse = {
  date_from: string;
  date_to:   string;
  periods:   LongitudinalPeriod[];
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

type VenueSlug = typeof VENUE_CONFIG[number]["slug"];

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
  return `${MONTH_NAMES[mo]} ${y}`;
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

// ── Per-venue accumulator for ONE month ──────────────────────────────────────

type VenueMonth = {
  revenue:      number;
  lapis_revenue: number;  // services+products (for Klaviyo split + turnover rent)
  wages:        number;
  advertising:  number;
  sga:          number;
  cogs:         number;
  rent:         number;
  utilities:    number;
};

function emptyVM(): VenueMonth {
  return { revenue: 0, lapis_revenue: 0, wages: 0, advertising: 0, sga: 0, cogs: 0, rent: 0, utilities: 0 };
}

/** Key: "YYYY-MM|venue" */
type PeriodicAccum = Map<string, VenueMonth>;

function getVM(acc: PeriodicAccum, yyyyMM: string, venue: string): VenueMonth {
  const k = `${yyyyMM}|${venue}`;
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

    supabase
      .from("aesthetics_sales_daily")
      .select("date_of_service, price_ex_vat")
      .gte("date_of_service", dateFrom)
      .lte("date_of_service", dateTo),

    supabase
      .from("slimming_sales_daily")
      .select("date_of_service, price_ex_vat")
      .gte("date_of_service", dateFrom)
      .lte("date_of_service", dateTo),

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
    ["aesthetics_sales_daily", aesSales],
    ["slimming_sales_daily",   slimSales],
    ["salary_supplement_monthly", supplement],
  ] as Array<[string, { error: { message: string } | null }]>) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  return {
    allRawCosts,
    revDaily:   (revDaily.data   ?? []) as RevDailyRow[],
    revMonthly: (revMonthly.data ?? []) as RevMonthlyRow[],
    aesSales:   (aesSales.data   ?? []) as SalesDailyRow[],
    slimSales:  (slimSales.data  ?? []) as SalesDailyRow[],
    supplement: (supplement.data ?? []) as SuppRow[],
  };
}

// ── Main aggregator ───────────────────────────────────────────────────────────

const WAGE_ROLES = ["manager","reception","therapist","practitioner","crm","unassigned"] as const;

/**
 * Aggregates fetched data into a PeriodicAccum keyed by "YYYY-MM|venue".
 * Config tables (wageRoleMap, profFeeMap, adPatternsArr, hardwiredRules,
 * fallbackRules) are shared (same for both ranges).
 */
async function aggregateRange(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  dateFrom:    string,
  dateTo:      string,
  rangeData:   Awaited<ReturnType<typeof fetchRangeData>>,
  wageRoleMap: Map<string, string>,
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
  // 1a. SPA daily LAPIS revenue
  for (const row of revDaily) {
    const slug = LOC_ID_TO_SLUG[row.location_id];
    if (!slug) continue;
    const yyyyMM = (row.date as string).slice(0, 7);
    const lapisSales = (
      Number(row.services         ?? 0) +
      Number(row.product_phytomer ?? 0) +
      Number(row.product_purest   ?? 0) +
      Number(row.product_other    ?? 0)
    );
    const vm = getVM(acc, yyyyMM, slug);
    vm.revenue       += lapisSales;
    vm.lapis_revenue += lapisSales;
  }
  // 1b. SPA monthly adjustments (wholesale, discount, refund) — pro-rated by days
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
  // 1c. Aesthetics daily revenue — group by date month
  for (const row of aesSales) {
    const yyyyMM = (row.date_of_service as string).slice(0, 7);
    getVM(acc, yyyyMM, "aesthetics").revenue += Number(row.price_ex_vat ?? 0);
  }
  // 1d. Slimming daily revenue — group by date month
  for (const row of slimSales) {
    const yyyyMM = (row.date_of_service as string).slice(0, 7);
    getVM(acc, yyyyMM, "slimming").revenue += Number(row.price_ex_vat ?? 0);
  }

  // ── 2. Costs from transactions_raw ───────────────────────────────────────
  for (const row of allRawCosts) {
    const venue   = row.venue ?? "unallocated";
    const line    = row.ebitda_line;
    const contact = row.contact_name ?? "";
    const amount  = Number(row.amount ?? 0);
    const yyyyMM  = (row.date as string).slice(0, 7);

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
          getVM(acc, yyyyMM, pfVenue).sga += amount;
          break;
        }
        const effectiveVenue = wageVenueOverride.get(roleKey) ?? venue;
        if (!allSlugs.has(effectiveVenue)) break;
        getVM(acc, yyyyMM, effectiveVenue).wages += amount;
        break;
      }
      case "advertising": {
        const ch = resolveAdChannel(contact);
        if (ch === "klaviyo" && venue === "hq") {
          // Klaviyo HQ → split across SPA venues by lapis_revenue ratio for this month
          // We use the SAME month's lapis_revenue already accumulated above.
          // Because we process costs after revenue, this is safe.
          const totalSpaRev = SPA_SLUGS.reduce(
            (s, sv) => s + (acc.get(`${yyyyMM}|${sv}`)?.lapis_revenue ?? 0), 0,
          );
          for (const sv of SPA_SLUGS) {
            const spaRev = acc.get(`${yyyyMM}|${sv}`)?.lapis_revenue ?? 0;
            const ratio  = totalSpaRev > 0 ? spaRev / totalSpaRev : 1 / 8;
            getVM(acc, yyyyMM, sv).advertising += amount * ratio;
          }
          break;
        }
        getVM(acc, yyyyMM, venue).advertising += amount;
        break;
      }
      case "sga":       { getVM(acc, yyyyMM, venue).sga       += amount; break; }
      case "cogs":      { getVM(acc, yyyyMM, venue).cogs      += amount; break; }
      case "rent":      { getVM(acc, yyyyMM, venue).rent      += amount; break; }
      case "utilities": { getVM(acc, yyyyMM, venue).utilities += amount; break; }
    }
  }

  // ── 3. Hardwired venue rules (applied per calendar month) ────────────────
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
        const revBase = vm.lapis_revenue || vm.revenue;
        value = base + revBase * pct;
      }

      if (hwLine === "rent")           vm.rent      = value;
      else if (hwLine === "utilities") vm.utilities = value;
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

    for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
      const yyyyMM      = monthStr.slice(0, 7);
      const daysInMo    = totalDaysInMonth(monthStr);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;
      const monthlyFloor = monthlyAmt * (daysInRange / daysInMo);

      for (const venue of targetVenues) {
        if (!allSlugs.has(venue)) continue;
        const venueFloor = splitEqual ? monthlyFloor / numVenues : monthlyFloor;

        // Check actual for this account+venue+month
        const actual = allRawCosts
          .filter(r => r.venue === venue && r.account_code === accountCode && (r.date ?? "").slice(0, 7) === yyyyMM)
          .reduce((sum, r) => sum + Number(r.amount), 0);

        const supp = Math.max(0, venueFloor - actual);
        if (supp === 0) continue;

        const vm = getVM(acc, yyyyMM, venue);
        if      (ebitdaLine === "utilities") vm.utilities += supp;
        else if (ebitdaLine === "cogs")      vm.cogs      += supp;
        else                                  vm.sga       += supp;
      }
    }
  }

  // ── 5. Prof fee min_monthly floors ───────────────────────────────────────
  for (const [contactKey, pf] of profFeeMap) {
    if (!pf.monthly_floor) continue;
    const targetVenue = pf.venue;
    if (!allSlugs.has(targetVenue)) continue;

    for (const monthStr of overlappingMonths(dateFrom, dateTo)) {
      const yyyyMM      = monthStr.slice(0, 7);
      const daysInMo    = totalDaysInMonth(monthStr);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;
      const floor = pf.monthly_floor * (daysInRange / daysInMo);

      const actual = allRawCosts
        .filter(r => (r.contact_name ?? "").toLowerCase().trim() === contactKey && (r.date ?? "").slice(0, 7) === yyyyMM)
        .reduce((sum, r) => sum + Number(r.amount), 0);

      const supp = Math.max(0, floor - actual);
      if (supp > 0) getVM(acc, yyyyMM, targetVenue).sga += supp;
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

  // ── 7. TTM-based fallback for partial/missing months ──────────────────────
  // For each active fallback rule: if no real transaction exists for that
  // account+venue in a given month, apply TTM/previous_month/manual estimate.
  // This prevents chart dips caused by late postings.
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
      const daysInMo    = totalDaysInMonth(monthStr);
      const daysInRange = daysOfMonthInRange(monthStr, dateFrom, dateTo);
      if (daysInRange === 0) continue;

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

          const vm   = getVM(acc, yyyyMM, venue);
          const line = hist.ebitda_line;
          if      (line === "wages")     vm.wages      += fallbackValue;
          else if (line === "advertising") vm.advertising += fallbackValue;
          else if (line === "sga")       vm.sga        += fallbackValue;
          else if (line === "cogs")      vm.cogs       += fallbackValue;
          else if (line === "rent")      vm.rent       += fallbackValue;
          else if (line === "utilities") vm.utilities  += fallbackValue;
        }
      }
    }
  }

  return acc;
}

// ── Collapse a PeriodicAccum month into MonthTotals for a brand ──────────────

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

function buildBrandTotals(acc: PeriodicAccum, yyyyMM: string): BrandTotals {
  const group: MonthTotals = zeroTotals();
  const spa:   MonthTotals = zeroTotals();
  const aes:   MonthTotals = zeroTotals();
  const slim:  MonthTotals = zeroTotals();

  for (const vc of VENUE_CONFIG) {
    const vm = acc.get(`${yyyyMM}|${vc.slug}`) ?? emptyVM();
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

  if (!dateFrom || !dateTo)
    return NextResponse.json({ error: "date_from and date_to required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // SPPY range: same calendar months, 1 year earlier
  const sppyFrom = shiftDateByMonths(dateFrom, -12);
  const sppyTo   = shiftDateByMonths(dateTo,   -12);

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
    aggregateRange(supabase, dateFrom, dateTo, currentData,
      wageRoleMap, wageVenueOverride, profFeeMap, adPatternsArr, hardwiredRules, fallbackRules),
    sppyData
      ? aggregateRange(supabase, sppyFrom, sppyTo, sppyData,
          wageRoleMap, wageVenueOverride, profFeeMap, adPatternsArr, hardwiredRules, fallbackRules)
      : Promise.resolve(new Map() as PeriodicAccum),
  ]);

  // ── Build output periods ──────────────────────────────────────────────────
  const months = overlappingMonths(dateFrom, dateTo);

  const periods: LongitudinalPeriod[] = months.map(monthStr => {
    const yyyyMM     = monthStr.slice(0, 7);                 // "YYYY-MM"
    const sppyYYYYMM = shiftMonth(monthStr, -12).slice(0, 7);

    const current = buildBrandTotals(currentAcc, yyyyMM);

    // SPPY is null when no data exists for that prior-year month
    const hasSppyData = sppyAcc.size > 0 && (
      [...sppyAcc.keys()].some(k => k.startsWith(sppyYYYYMM + "|"))
    );
    const sppy = hasSppyData ? buildBrandTotals(sppyAcc, sppyYYYYMM) : null;

    return {
      month:   yyyyMM,
      label:   monthLabel(yyyyMM),
      current,
      sppy,
    };
  });

  const response: LongitudinalResponse = {
    date_from: dateFrom,
    date_to:   dateTo,
    periods,
  };

  return NextResponse.json(response);
}
