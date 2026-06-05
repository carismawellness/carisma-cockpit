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
  const total = txnRows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  // Wage role mapping (only needed for wages)
  let wageRoleMap = new Map<string, string>();
  if (ebitdaLine === "wages") {
    const { data: roles } = await supabase
      .from("wage_role_mapping")
      .select("contact_key, role");
    for (const r of (roles ?? [])) {
      wageRoleMap.set((r.contact_key as string).toLowerCase().trim(), r.role as string);
    }
  }

  // Ad patterns (only needed for advertising)
  let adPatterns: Array<{ pattern: string; channel: string }> = [];
  if (ebitdaLine === "advertising") {
    const { data: ap } = await supabase
      .from("advertising_contact_mapping")
      .select("pattern, channel, priority")
      .order("priority");
    adPatterns = (ap ?? []) as Array<{ pattern: string; channel: string }>;
  }

  function resolveAdChannel(contact: string): string {
    const lower = contact.toLowerCase();
    for (const p of adPatterns) {
      if (lower.includes(p.pattern.toLowerCase())) return p.channel;
    }
    return "misc";
  }

  // ── Contact breakdown ─────────────────────────────────────────────────────
  const contactMap = new Map<string, number>();
  for (const r of txnRows) {
    const c = (r.contact_name as string) || "Unknown";
    contactMap.set(c, (contactMap.get(c) ?? 0) + Number(r.amount ?? 0));
  }
  const contacts = Array.from(contactMap.entries())
    .map(([contact, amount]) => ({
      contact,
      amount: +amount.toFixed(2),
      share:  total > 0 ? +(amount / total * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Wage role breakdown ───────────────────────────────────────────────────
  const wageRoleAcc = new Map<string, number>();
  if (ebitdaLine === "wages") {
    for (const r of txnRows) {
      const contact = ((r.contact_name as string) || "").toLowerCase().trim();
      const role = wageRoleMap.get(contact) ?? "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + Number(r.amount ?? 0));
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

  // ── Individual transactions ───────────────────────────────────────────────
  const transactions = txnRows.map(r => ({
    txn_id:       r.txn_id,
    date:         r.date,
    contact:      r.contact_name || "—",
    account_code: r.account_code,
    account_name: r.account_name,
    txn_type:     r.transaction_type,
    sub_line:     r.ebitda_sub_line,
    amount:       +Number(r.amount ?? 0).toFixed(2),
    source:       "zoho" as string,   // all transactions_raw rows come from Zoho ETL
  }));

  return NextResponse.json({
    is_fallback:  false,
    total:        +total.toFixed(2),
    contacts,
    transactions,
    wage_roles:   wageRoles,
    ad_channels:  adChannels,
  });
}
