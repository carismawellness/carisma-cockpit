/**
 * /api/finance/ebitda-v2/drill
 *
 * Returns contact-level and transaction-level detail for a single EBITDA V2 cell.
 *
 * Query params:
 *   venue          (required) slug, e.g. "hyatt", "aesthetics", "hq"
 *   ebitda_line    (required) e.g. "wages", "advertising", "sga"
 *   ebitda_sub_line (optional) e.g. "prof_services", "meta"
 *   date_from      YYYY-MM-DD (required)
 *   date_to        YYYY-MM-DD (required)
 *
 * Response: {
 *   is_fallback: boolean,       // true if the cell value came from a fallback/hardwired rule
 *   contacts:  ContactRow[],    // by-contact breakdown
 *   transactions: TxnRow[],     // individual transaction lines
 *   wage_roles: RoleRow[],      // wage-role breakdown (wages cells only)
 *   ad_channels: ChannelRow[],  // ad-channel breakdown (advertising cells only)
 * }
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const venue         = searchParams.get("venue");
  const ebitdaLine    = searchParams.get("ebitda_line");
  const ebitdaSubLine = searchParams.get("ebitda_sub_line");
  const dateFrom      = searchParams.get("date_from");
  const dateTo        = searchParams.get("date_to");

  if (!venue || !ebitdaLine || !dateFrom || !dateTo)
    return NextResponse.json({ error: "venue, ebitda_line, date_from, date_to required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // Check if this cell uses a hardwired rule
  const { data: hwRules } = await supabase
    .from("ebitda_v2_hardwired_rules")
    .select("rule_type, params, note")
    .eq("venue", venue)
    .eq("ebitda_line", ebitdaLine)
    .lte("effective_from", dateTo);

  const activeHw = (hwRules ?? []).find((r: Record<string,unknown>) => !r.effective_to || (r.effective_to as string) >= dateFrom!);
  if (activeHw) {
    // Hardwired cell — no individual transactions, show rule summary
    return NextResponse.json({
      is_fallback: true,
      fallback_note: `No contact/employee breakdown available — value is based on a hardwired rule (${activeHw.rule_type}). ${activeHw.note ?? ""}`.trim(),
      contacts: [],
      transactions: [],
      wage_roles: [],
      ad_channels: [],
    });
  }

  // Build query
  let query = supabase
    .from("transactions_raw")
    .select("txn_id, date, account_code, account_name, contact_name, transaction_type, ebitda_sub_line, amount, venue")
    .eq("venue", venue)
    .eq("ebitda_line", ebitdaLine)
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date", { ascending: false });

  if (ebitdaSubLine) {
    query = query.eq("ebitda_sub_line", ebitdaSubLine);
  }

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const txnRows = (rows ?? []) as Array<Record<string, unknown>>;

  // Wage role mapping + salary supplement (only needed for wages)
  type SuppRow = { employee_name: string; amount: number; month: string };
  let suppRows: SuppRow[] = [];
  let wageRoleMap = new Map<string, string>();

  if (ebitdaLine === "wages") {
    // Load wage role mapping
    const { data: roles } = await supabase
      .from("wage_role_mapping")
      .select("contact_key, role");
    for (const r of (roles ?? [])) {
      wageRoleMap.set((r.contact_key as string).toLowerCase().trim(), r.role as string);
    }

    // Load frozen salary supplement for this venue and the overlapping months
    // Build month list from dateFrom..dateTo
    const suppMonths: string[] = [];
    const cur = new Date(dateFrom!.slice(0, 7) + "-01");
    const end = new Date(dateTo!.slice(0,  7) + "-01");
    while (cur <= end) {
      suppMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-01`);
      cur.setMonth(cur.getMonth() + 1);
    }

    const { data: sd } = await supabase
      .from("salary_supplement_monthly")
      .select("month, employee_name, amount")
      .eq("spa_slug", venue)
      .eq("is_frozen", true)
      .in("month", suppMonths);

    // Pro-rate each month's supplement into the selected period
    for (const s of (sd ?? [])) {
      const m        = (s.month as string).slice(0, 10);
      const mEnd     = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 0).toISOString().slice(0, 10);
      const rangeStart = dateFrom! > m    ? dateFrom! : m;
      const rangeEnd   = dateTo!   < mEnd ? dateTo!   : mEnd;
      const daysInRange = Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000) + 1;
      const daysInMonth = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 0).getDate();
      const prorated    = Number(s.amount ?? 0) * (daysInRange / daysInMonth);
      if (prorated > 0) {
        suppRows.push({ employee_name: s.employee_name as string, amount: +prorated.toFixed(2), month: m });
      }
    }
  }

  // Ad patterns (only needed for advertising)
  // Column is `canonical` (e.g. "Meta", "Google", "Klaviyo"), not `channel`.
  let adPatterns: Array<{ pattern: string; canonical: string }> = [];
  if (ebitdaLine === "advertising") {
    const { data: ap } = await supabase
      .from("advertising_contact_mapping")
      .select("pattern, canonical, priority")
      .order("priority");
    adPatterns = (ap ?? []) as Array<{ pattern: string; canonical: string }>;
  }

  const KNOWN_AD_CHANNELS = new Set(["meta", "google", "klaviyo"]);
  function resolveAdChannel(contact: string): string {
    const lower = contact.toLowerCase();
    for (const p of adPatterns) {
      if (lower.includes(p.pattern.toLowerCase())) {
        const ch = (p.canonical ?? "").toLowerCase();
        return KNOWN_AD_CHANNELS.has(ch) ? ch : "misc";
      }
    }
    return "misc";
  }

  const suppTotal = suppRows.reduce((s, r) => s + r.amount, 0);
  const total = txnRows.reduce((s, r) => s + Number(r.amount ?? 0), 0) + suppTotal;

  // ── Contact breakdown (Zoho txns + supplement) — with source + role ─────
  type ContactAcc = { zoho: number; supplement: number };
  const contactMap = new Map<string, ContactAcc>();

  for (const r of txnRows) {
    const c = (r.contact_name as string) || "Unknown";
    const existing = contactMap.get(c) ?? { zoho: 0, supplement: 0 };
    existing.zoho += Number(r.amount ?? 0);
    contactMap.set(c, existing);
  }
  for (const s of suppRows) {
    const existing = contactMap.get(s.employee_name) ?? { zoho: 0, supplement: 0 };
    existing.supplement += s.amount;
    contactMap.set(s.employee_name, existing);
  }

  const contacts = Array.from(contactMap.entries())
    .map(([contact, acc]) => {
      const amount = acc.zoho + acc.supplement;
      const role   = ebitdaLine === "wages"
        ? (wageRoleMap.get(contact.toLowerCase().trim()) ?? "unassigned")
        : undefined;
      // source tag: both | zoho | supplement
      const source = acc.zoho > 0 && acc.supplement > 0 ? "both"
                   : acc.supplement > 0                  ? "salary_supplement"
                   :                                       "zoho";
      return {
        contact,
        amount:     +amount.toFixed(2),
        share:      total > 0 ? +(amount / total * 100).toFixed(1) : 0,
        role,
        source,
        zoho_amount:       +acc.zoho.toFixed(2),
        supplement_amount: +acc.supplement.toFixed(2),
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Wage role breakdown (Zoho txns + supplement) ─────────────────────────
  const wageRoleAcc = new Map<string, number>();
  if (ebitdaLine === "wages") {
    for (const r of txnRows) {
      const contact = ((r.contact_name as string) || "").toLowerCase().trim();
      const role = wageRoleMap.get(contact) ?? "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + Number(r.amount ?? 0));
    }
    // Supplement rows — look up role for each employee
    for (const s of suppRows) {
      const role = wageRoleMap.get(s.employee_name.toLowerCase().trim()) ?? "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + s.amount);
    }
  }
  const wageRoles = Array.from(wageRoleAcc.entries())
    .map(([role, amount]) => ({
      role,
      amount: +amount.toFixed(2),
      share:  total > 0 ? +(amount / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Ad channel breakdown ──────────────────────────────────────────────────
  const adChannelAcc = new Map<string, number>();
  if (ebitdaLine === "advertising") {
    for (const r of txnRows) {
      const contact = (r.contact_name as string) || "";
      const ch = resolveAdChannel(contact);
      adChannelAcc.set(ch, (adChannelAcc.get(ch) ?? 0) + Number(r.amount ?? 0));
    }
  }
  const adChannels = Array.from(adChannelAcc.entries())
    .map(([channel, amount]) => ({
      channel,
      amount: +amount.toFixed(2),
      share:  total > 0 ? +(amount / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Individual transactions (Zoho + salary supplement) ───────────────────
  const transactions = [
    ...txnRows.map(r => ({
      txn_id:       r.txn_id as string,
      date:         r.date as string,
      contact:      (r.contact_name as string) || "—",
      account_code: r.account_code as string,
      account_name: r.account_name as string,
      txn_type:     r.transaction_type as string,
      sub_line:     r.ebitda_sub_line as string,
      amount:       +Number(r.amount ?? 0).toFixed(2),
      source:       "zoho",
    })),
    // Salary supplement synthetic rows
    ...suppRows.map(s => ({
      txn_id:       `supp-${s.month}-${s.employee_name}`,
      date:         s.month.slice(0, 10),
      contact:      s.employee_name,
      account_code: "SUPPLEMENT",
      account_name: "Salary Supplement",
      txn_type:     "salary_supplement",
      sub_line:     "wages",
      amount:       s.amount,
      source:       "salary_supplement",
    })),
  ];

  return NextResponse.json({
    is_fallback:  false,
    total:        +total.toFixed(2),
    contacts,
    transactions,
    wage_roles:   wageRoles,
    ad_channels:  adChannels,
  });
}
