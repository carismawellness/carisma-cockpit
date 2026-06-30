import { NextRequest, NextResponse } from "next/server";

/**
 * Debug endpoint: replicate EBITDA v2 Slimming wages calculation for a given period.
 * Usage: POST { date_from: "2026-05-01", date_to: "2026-05-31" }
 * Uses service role key directly (like other ETL routes) to bypass RLS.
 */

function sbBase(): string {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gnripfrvcxrakjhiwlxy.supabase.co";
}
function sbHdrs(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function sbGet(table: string, params: string): Promise<unknown[]> {
  const r = await fetch(`${sbBase()}/rest/v1/${table}?${params}`, { headers: sbHdrs() });
  if (!r.ok) throw new Error(`${table} ${r.status}: ${await r.text()}`);
  return r.json() as Promise<unknown[]>;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { date_from?: string; date_to?: string };
  const dateFrom = body.date_from ?? "2026-05-01";
  const dateTo   = body.date_to   ?? "2026-05-31";

  // 1. wage_role_mapping
  type WageRow = { contact_key: string; venue_override: string | null; is_prof_fee: boolean };
  const wageRoles = await sbGet("wage_role_mapping", "select=contact_key,venue_override,is_prof_fee") as WageRow[];

  const wageVenueOverrideMap = new Map<string, string>();
  const profFeeSet           = new Set<string>();
  for (const row of wageRoles) {
    const key = row.contact_key.toLowerCase().trim();
    if (row.venue_override) wageVenueOverrideMap.set(key, row.venue_override);
    if (row.is_prof_fee)    profFeeSet.add(key);
  }

  // 2. transactions_raw wages for the period (all venues)
  type TxnRow = { date: string; venue: string; ebitda_line: string; contact_name: string; amount: string };
  const wageTxns = await sbGet(
    "transactions_raw",
    `select=date,venue,ebitda_line,contact_name,amount&ebitda_line=eq.wages&date=gte.${dateFrom}&date=lte.${dateTo}&limit=1000`
  ) as TxnRow[];

  // Simulate EBITDA routing: apply venue_override, skip prof_fee
  const slimmingFromZohoEbitda: Array<{ contact: string; venue_raw: string; via_override: boolean; amount: number }> = [];
  let slimmingZohoTotal = 0;
  const hrSlimmingZoho: Array<{ contact: string; amount: number }> = [];
  let hrSlimmingZohoTotal = 0;

  for (const t of wageTxns) {
    const contact = t.contact_name ?? "";
    const roleKey = contact.toLowerCase().trim();
    const venueRaw = t.venue;
    const amount   = Number(t.amount ?? 0);

    // HR: just venue-tagged rows
    if (venueRaw === "slimming") {
      hrSlimmingZoho.push({ contact, amount });
      hrSlimmingZohoTotal += amount;
    }

    // EBITDA: apply overrides
    if (profFeeSet.has(roleKey)) continue;
    const effectiveVenue = wageVenueOverrideMap.get(roleKey) ?? venueRaw;
    if (effectiveVenue === "slimming") {
      slimmingFromZohoEbitda.push({ contact, venue_raw: venueRaw, via_override: wageVenueOverrideMap.has(roleKey), amount });
      slimmingZohoTotal += amount;
    }
  }

  // 3. salary_supplement_monthly for slimming (is_frozen=true, all months in window)
  const [fy, fm] = dateFrom.slice(0, 7).split("-").map(Number);
  const targetMonthStr = `${fy}-${String(fm).padStart(2, "0")}-01`;
  const suppMonths: string[] = [];
  for (let i = 3; i >= 0; i--) {
    let y = fy, m = fm - i;
    if (m <= 0) { m += 12; y--; }
    suppMonths.push(`${y}-${String(m).padStart(2, "0")}-01`);
  }
  const monthsIn = suppMonths.map(m => `"${m}"`).join(",");

  type SuppRow = { month: string; employee_name: string; amount: string; spa_slug: string; is_frozen: boolean };
  const suppData = await sbGet(
    "salary_supplement_monthly",
    `select=month,employee_name,amount,spa_slug,is_frozen&spa_slug=eq.slimming&month=in.(${monthsIn})`
  ) as SuppRow[];

  const slimmingCashMay = suppData.filter(r => r.month.slice(0, 10) === targetMonthStr && r.is_frozen);
  const slimmingCashTotal = slimmingCashMay.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // 4. Revenue
  type RevRow = { price_ex_vat: string };
  const slmRev = await sbGet(
    "slimming_sales_daily",
    `select=price_ex_vat&date_of_service=gte.${dateFrom}&date_of_service=lte.${dateTo}&limit=5000`
  ) as RevRow[];
  const slimmingRevenue = slmRev.reduce((s, r) => s + Number(r.price_ex_vat ?? 0), 0);

  const ebitdaWages  = slimmingZohoTotal + slimmingCashTotal;
  const hrWages      = hrSlimmingZohoTotal + slimmingCashTotal;
  const ebitdaWagesPct = slimmingRevenue > 0 ? Math.round(ebitdaWages / slimmingRevenue * 100) : 0;
  const hrWagesPct     = slimmingRevenue > 0 ? +((hrWages / slimmingRevenue) * 100).toFixed(1) : 0;

  return NextResponse.json({
    period: { date_from: dateFrom, date_to: dateTo },
    revenue: +slimmingRevenue.toFixed(2),

    ebitda: {
      zoho_wages:    +slimmingZohoTotal.toFixed(2),
      cash_wages:    +slimmingCashTotal.toFixed(2),
      total_wages:   +ebitdaWages.toFixed(2),
      wages_pct:     ebitdaWagesPct,
      zoho_breakdown: slimmingFromZohoEbitda,
    },

    hr: {
      zoho_wages:    +hrSlimmingZohoTotal.toFixed(2),
      cash_wages:    +slimmingCashTotal.toFixed(2),
      total_wages:   +hrWages.toFixed(2),
      wages_pct:     hrWagesPct,
      zoho_breakdown: hrSlimmingZoho,
    },

    cash_supplement_may: slimmingCashMay,
    venue_overrides_to_slimming: Object.fromEntries(
      [...wageVenueOverrideMap.entries()].filter(([, v]) => v === "slimming")
    ),
  });
}
