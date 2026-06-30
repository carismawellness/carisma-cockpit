import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Debug endpoint: replicate EBITDA v2 Slimming wages calculation for a given period.
 * Usage: POST { date_from: "2026-05-01", date_to: "2026-05-31" }
 * Auth-free (under /api/etl/ path which bypasses middleware auth).
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as { date_from?: string; date_to?: string };
  const dateFrom = body.date_from ?? "2026-05-01";
  const dateTo   = body.date_to   ?? "2026-05-31";

  const supabase = await createServerSupabaseClient();

  // 1. wage_role_mapping
  const { data: wageRoles } = await supabase
    .from("wage_role_mapping")
    .select("contact_key, role, venue_override, is_prof_fee, monthly_floor, sga_sub_line");

  const wageVenueOverrideMap = new Map<string, string>();
  const profFeeMap           = new Map<string, boolean>();
  for (const row of wageRoles ?? []) {
    const key = (row.contact_key as string).toLowerCase().trim();
    if (row.venue_override) wageVenueOverrideMap.set(key, row.venue_override as string);
    if (row.is_prof_fee)    profFeeMap.set(key, true);
  }

  // 2. transactions_raw wages for the period (all venues)
  const { data: wageTxns } = await supabase
    .from("transactions_raw")
    .select("date, venue, ebitda_line, contact_name, amount")
    .eq("ebitda_line", "wages")
    .gte("date", dateFrom)
    .lte("date", dateTo);

  // Simulate EBITDA routing: apply venue_override, skip prof_fee
  const slimmingFromZoho: Array<{ contact: string; venue_raw: string; via_override: boolean; amount: number }> = [];
  let slimmingZohoTotal = 0;

  for (const t of wageTxns ?? []) {
    const contact = (t.contact_name as string) ?? "";
    const roleKey = contact.toLowerCase().trim();
    const venueRaw = t.venue as string;

    if (profFeeMap.get(roleKey)) continue; // re-routed to SGA, not wages

    const effectiveVenue = wageVenueOverrideMap.get(roleKey) ?? venueRaw;
    if (effectiveVenue === "slimming") {
      const amount = Number(t.amount ?? 0);
      slimmingFromZoho.push({
        contact,
        venue_raw: venueRaw,
        via_override: wageVenueOverrideMap.has(roleKey),
        amount,
      });
      slimmingZohoTotal += amount;
    }
  }

  // 3. salary_supplement_monthly cash salaries (is_frozen=true) for slimming
  // EBITDA fetches 3 months prior + current period
  const suppMonths: string[] = [];
  const [fy, fm] = dateFrom.slice(0, 7).split("-").map(Number);
  for (let i = 3; i >= 0; i--) {
    let y = fy, m = fm - i;
    if (m <= 0) { m += 12; y--; }
    suppMonths.push(`${y}-${String(m).padStart(2, "0")}-01`);
  }
  // dedup
  const uniqueMonths = [...new Set([...suppMonths, `${fy}-${String(fm).padStart(2, "0")}-01`])];

  const { data: suppData } = await supabase
    .from("salary_supplement_monthly")
    .select("month, employee_name, amount, spa_slug, role, is_frozen")
    .in("month", uniqueMonths)
    .eq("spa_slug", "slimming");

  const targetMonth = `${fy}-${String(fm).padStart(2, "0")}-01`;
  const slimmingCash = (suppData ?? []).filter(r => (r.month as string).slice(0, 10) === targetMonth && r.is_frozen);
  const slimmingCashAllMonths = suppData ?? [];

  const slimmingCashTotal = slimmingCash.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // 4. HR source: transactions_raw wages with venue='slimming' directly
  const hrSlimmingZoho = (wageTxns ?? [])
    .filter(t => t.venue === "slimming")
    .map(t => ({ contact: t.contact_name, amount: Number(t.amount ?? 0) }));
  const hrSlimmingZohoTotal = hrSlimmingZoho.reduce((s, r) => s + r.amount, 0);

  // 5. Revenue
  const { data: slmRev } = await supabase
    .from("slimming_sales_daily")
    .select("price_ex_vat")
    .gte("date_of_service", dateFrom)
    .lte("date_of_service", dateTo);
  const slimmingRevenue = (slmRev ?? []).reduce((s, r) => s + Number(r.price_ex_vat ?? 0), 0);

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
      zoho_breakdown: slimmingFromZoho,
    },

    hr: {
      zoho_wages:    +hrSlimmingZohoTotal.toFixed(2),
      cash_wages:    +slimmingCashTotal.toFixed(2),
      total_wages:   +hrWages.toFixed(2),
      wages_pct:     hrWagesPct,
      zoho_breakdown: hrSlimmingZoho,
    },

    cash_supplement_detail: slimmingCashAllMonths,
    venue_overrides_to_slimming: Object.fromEntries(
      [...wageVenueOverrideMap.entries()].filter(([, v]) => v === "slimming")
    ),
  });
}
