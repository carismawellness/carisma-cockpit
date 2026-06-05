/**
 * /api/finance/ebitda-v2/drill
 *
 * Query params:
 *   venue, ebitda_line, date_from, date_to (required)
 *   ebitda_sub_line  optional — filter to specific SGA sub-category
 *   wage_role        optional — when set, filter contacts to this role only
 *                    (e.g. "manager", "therapist", "reception", "crm", "unassigned")
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ── Helpers ───────────────────────────────────────────────────────────────────

function basisLabel(ruleType: string | null, config: Record<string, unknown> | null): string {
  if (!ruleType) return "Tag";
  switch (ruleType) {
    case "equal":       return "Equal split";
    case "sales_ratio": return "Revenue split";
    case "salary_cost": return "Salary split";
    case "custom": {
      if (!config) return "Custom split";
      const entries = Object.entries(config).filter(([, v]) => Number(v) > 0);
      return entries.length === 1 ? "Tag" : "Custom split";
    }
    default: return "Tag";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const venue         = searchParams.get("venue");
  const ebitdaLine    = searchParams.get("ebitda_line");
  const ebitdaSubLine = searchParams.get("ebitda_sub_line");
  const wageRole      = searchParams.get("wage_role");    // filter wages to one role
  const adChannel     = searchParams.get("ad_channel");   // filter advertising to one channel
  const dateFrom      = searchParams.get("date_from");
  const dateTo        = searchParams.get("date_to");

  if (!venue || !ebitdaLine || !dateFrom || !dateTo)
    return NextResponse.json({ error: "venue, ebitda_line, date_from, date_to required" }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // ── Hardwired rule check ──────────────────────────────────────────────────
  const { data: hwRules } = await supabase
    .from("ebitda_v2_hardwired_rules")
    .select("rule_type, params, note")
    .eq("venue", venue)
    .eq("ebitda_line", ebitdaLine)
    .lte("effective_from", dateTo);

  const activeHw = (hwRules ?? []).find(
    (r: Record<string, unknown>) => !r.effective_to || (r.effective_to as string) >= dateFrom!
  );
  if (activeHw) {
    return NextResponse.json({
      is_fallback:  true,
      fallback_note: `No contact/employee breakdown available — value is based on a hardwired rule (${activeHw.rule_type}). ${activeHw.note ?? ""}`.trim(),
      contacts: [], transactions: [], wage_roles: [], ad_channels: [],
    });
  }

  // ── Fetch transactions ────────────────────────────────────────────────────
  let query = supabase
    .from("transactions_raw")
    .select("txn_id, date, account_code, account_name, contact_name, transaction_type, ebitda_sub_line, amount, venue")
    .eq("venue", venue)
    .eq("ebitda_line", ebitdaLine)
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date", { ascending: false });

  if (ebitdaSubLine) query = query.eq("ebitda_sub_line", ebitdaSubLine);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // mutable — wage_role and ad_channel filters may narrow this later
  let txnRows = (rows ?? []) as Array<Record<string, unknown>>;

  // ── Wage role mapping + supplement ─────────────────────────────────────────
  type SuppRow = { employee_name: string; amount: number; month: string; role?: string };
  let suppRows: SuppRow[] = [];
  let wageRoleMap = new Map<string, string>();

  if (ebitdaLine === "wages") {
    const { data: roleData } = await supabase.from("wage_role_mapping").select("contact_key, role");
    for (const r of (roleData ?? [])) {
      wageRoleMap.set((r.contact_key as string).toLowerCase().trim(), r.role as string);
    }

    // Build overlapping months
    const suppMonths: string[] = [];
    const cur = new Date(dateFrom.slice(0, 7) + "-01");
    const end = new Date(dateTo.slice(0, 7) + "-01");
    while (cur <= end) {
      suppMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-01`);
      cur.setMonth(cur.getMonth() + 1);
    }

    const { data: sd } = await supabase
      .from("salary_supplement_monthly")
      .select("month, employee_name, amount, role")   // role = designation from Talexio
      .eq("spa_slug", venue)
      .eq("is_frozen", true)
      .in("month", suppMonths);

    for (const s of (sd ?? [])) {
      const m = (s.month as string).slice(0, 10);
      const mEnd = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 0).toISOString().slice(0, 10);
      const rangeStart = dateFrom > m ? dateFrom : m;
      const rangeEnd   = dateTo < mEnd ? dateTo : mEnd;
      const daysInRange = Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000) + 1;
      const daysInMonth = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 0).getDate();
      const prorated = Number(s.amount ?? 0) * (daysInRange / daysInMonth);
      if (prorated > 0) suppRows.push({
        employee_name: s.employee_name as string,
        amount: +prorated.toFixed(2),
        month: m,
        role: ((s.role as string) || "").toLowerCase().trim() || undefined,
      });
    }

    // ── Wage role filter — apply BEFORE any totals ──────────────────────────
    if (wageRole) {
      txnRows  = txnRows.filter(r => {
        const key = ((r.contact_name as string) || "").toLowerCase().trim();
        return (wageRoleMap.get(key) ?? "unassigned") === wageRole;
      });
      suppRows = suppRows.filter(s => {
        const role = s.role
          || wageRoleMap.get(s.employee_name.toLowerCase().trim())
          || "unassigned";
        return role === wageRole;
      });
    }
  }

  // ── Ad channel patterns ────────────────────────────────────────────────────
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

  // ── Ad channel filter — keep only contacts resolving to this channel ───────
  if (adChannel && ebitdaLine === "advertising") {
    txnRows = txnRows.filter(r =>
      resolveAdChannel((r.contact_name as string) || "") === adChannel
    );
  }

  // ── COA mapping → split basis ─────────────────────────────────────────────
  const uniqueCodes = [...new Set(txnRows.map(r => r.account_code as string).filter(Boolean))];
  const basisMap = new Map<string, string>(); // account_code → label

  if (uniqueCodes.length > 0) {
    // Determine org from venue
    const isAesthetics = ["aesthetics", "slimming"].includes(venue);
    const org = isAesthetics ? "aesthetics" : "spa";

    const { data: coaRows } = await supabase
      .from("coa_mapping")
      .select("account_code, coa_split_rules(rule_type, config)")
      .in("account_code", uniqueCodes)
      .eq("zoho_org", org);

    for (const row of (coaRows ?? [])) {
      const sr = (row as Record<string, unknown>).coa_split_rules as Record<string, unknown> | null;
      const ruleType = (sr?.rule_type as string) ?? null;
      const config   = (sr?.config as Record<string, unknown>) ?? null;
      basisMap.set(row.account_code as string, basisLabel(ruleType, config));
    }
  }

  function txnBasis(r: Record<string, unknown>): string {
    const code = r.account_code as string;
    return basisMap.get(code) ?? "Tag";
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const suppTotal = suppRows.reduce((s, r) => s + r.amount, 0);
  const total = txnRows.reduce((s, r) => s + Number(r.amount ?? 0), 0) + suppTotal;

  // ── Contact breakdown ─────────────────────────────────────────────────────
  type ContactAcc = { zoho: number; supplement: number; bases: Set<string> };
  const contactMap = new Map<string, ContactAcc>();

  for (const r of txnRows) {
    const c = (r.contact_name as string) || "Unknown";
    const existing = contactMap.get(c) ?? { zoho: 0, supplement: 0, bases: new Set() };
    existing.zoho += Number(r.amount ?? 0);
    existing.bases.add(txnBasis(r));
    contactMap.set(c, existing);
  }
  for (const s of suppRows) {
    const existing = contactMap.get(s.employee_name) ?? { zoho: 0, supplement: 0, bases: new Set() };
    existing.supplement += s.amount;
    existing.bases.add("Supplement");
    contactMap.set(s.employee_name, existing);
  }

  const contacts = Array.from(contactMap.entries())
    .map(([contact, acc]) => {
      const amount  = acc.zoho + acc.supplement;
      const role    = ebitdaLine === "wages"
        ? (wageRoleMap.get(contact.toLowerCase().trim()) ?? "unassigned")
        : undefined;
      const source  = acc.zoho > 0 && acc.supplement > 0 ? "both"
                    : acc.supplement > 0                  ? "salary_supplement"
                    :                                       "zoho";
      const basesArr = Array.from(acc.bases);
      const basis   = basesArr.length === 1 ? basesArr[0] : "Mixed";
      return {
        contact, amount: +amount.toFixed(2),
        share: total > 0 ? +(amount / total * 100).toFixed(1) : 0,
        role, source, basis,
        zoho_amount: +acc.zoho.toFixed(2),
        supplement_amount: +acc.supplement.toFixed(2),
      };
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Wage roles breakdown ──────────────────────────────────────────────────
  const wageRoleAcc = new Map<string, number>();
  if (ebitdaLine === "wages") {
    for (const r of txnRows) {
      const key  = ((r.contact_name as string) || "").toLowerCase().trim();
      const role = wageRoleMap.get(key) ?? "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + Number(r.amount ?? 0));
    }
    for (const s of suppRows) {
      const role = s.role || wageRoleMap.get(s.employee_name.toLowerCase().trim()) || "unassigned";
      wageRoleAcc.set(role, (wageRoleAcc.get(role) ?? 0) + s.amount);
    }
  }
  const wageRoles = Array.from(wageRoleAcc.entries())
    .map(([role, amount]) => ({ role, amount: +amount.toFixed(2), share: total > 0 ? +(amount / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Ad channels breakdown ─────────────────────────────────────────────────
  const adChannelAcc = new Map<string, number>();
  if (ebitdaLine === "advertising") {
    for (const r of txnRows) {
      const ch = resolveAdChannel((r.contact_name as string) || "");
      adChannelAcc.set(ch, (adChannelAcc.get(ch) ?? 0) + Number(r.amount ?? 0));
    }
  }
  const adChannels = Array.from(adChannelAcc.entries())
    .map(([channel, amount]) => ({ channel, amount: +amount.toFixed(2), share: total > 0 ? +(amount / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // ── Individual transactions ───────────────────────────────────────────────
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
      basis:        txnBasis(r),
    })),
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
      basis:        "Supplement",
    })),
  ];

  return NextResponse.json({
    is_fallback: false,
    total: +total.toFixed(2),
    wage_role_filter: wageRole ?? null,
    contacts, transactions, wage_roles: wageRoles, ad_channels: adChannels,
  });
}
