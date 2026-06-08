/**
 * POST /api/settings/prof-fee-contacts
 *
 * Returns all unique contact names that appear on professional-fees GL accounts
 * (ebitda_line = 'sga_prof_services' | 'sga') across both Zoho orgs for a date range.
 * On completion auto-seeds CRM roles for known staff-grid contacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionsForAccounts } from "@/lib/etl/zoho-account-transactions";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const FALLBACK_PROF_FEE_CODES = [
  "651180",   // Professional Fees
  "6050005",  // Subcontractor
  "611191",   // Accounting – Professional Services
  "611192",   // Audit – Professional Services
  "611193",   // Consulting – Professional Services
  "611194",   // Legal – Professional Services
  "659177",   // Consulting – The Purest Solutions
];

const DEFAULT_DATE_FROM = "2025-01-01";
const DEFAULT_DATE_TO   = "2026-06-30";

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime());
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── CRM fuzzy matching (staff-grid names for professional fees contacts) ────
const CRM_TOKENS = [
  "vj", "nicci", "juli", "abid", "adeel", "april", "nath", "rana",
  "que", "dori", "melissa", "mandar", "yofana",
  // "ruksana" removed — Ruksana Shaikh is a professional fee contractor (is_prof_fee=true in wage_role_mapping)
];

function fuzzyRole(contactName: string): string | null {
  const toks = contactName.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const tok of toks) {
    if (CRM_TOKENS.some((ct) => ct.length >= 2 && (tok === ct || (ct.length >= 4 && tok.startsWith(ct))))) {
      return "crm";
    }
  }
  return null;
}

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveProfFeeCodes(log: string[]): Promise<string[]> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    log.push("No Supabase credentials — using fallback professional fee codes");
    return [...FALLBACK_PROF_FEE_CODES];
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const codes: string[] = [];

  for (const org of ["spa", "aesthetics"]) {
    for (const line of ["sga_prof_services", "sga"]) {
      const url = `${supabaseUrl}/rest/v1/zoho_coa_mapping?zoho_org=eq.${org}&ebitda_line=eq.${line}&select=account_code`;
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const rows = (await res.json()) as Array<{ account_code: string }>;
      rows.forEach((r) => codes.push(String(r.account_code)));
    }
  }

  const combined = [...new Set([...codes, ...FALLBACK_PROF_FEE_CODES])];
  log.push(`Professional fee codes: ${combined.length} (${codes.length} from COA map + fallbacks merged)`);
  return combined;
}

export async function POST(req: NextRequest) {
  const log: string[] = [];

  try {
    let dateFrom = DEFAULT_DATE_FROM;
    let dateTo   = DEFAULT_DATE_TO;

    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (typeof body.date_from === "string" && body.date_from) dateFrom = body.date_from;
        if (typeof body.date_to   === "string" && body.date_to)   dateTo   = body.date_to;
      } catch { /* use defaults */ }
    }

    if (!isValidIso(dateFrom) || !isValidIso(dateTo)) {
      return NextResponse.json({ error: "date_from and date_to must be YYYY-MM-DD" }, { status: 400 });
    }

    const profFeeCodes = await resolveProfFeeCodes(log);

    const accumulator = new Map<string, { spa: number; aesthetics: number }>();
    function accumulate(name: string, amount: number, org: "spa" | "aesthetics") {
      const key = name.trim();
      if (!key) return;
      const entry = accumulator.get(key) ?? { spa: 0, aesthetics: 0 };
      entry[org] += amount;
      accumulator.set(key, entry);
    }

    const orgs = ["spa", "aesthetics"] as const;
    for (let i = 0; i < orgs.length; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 3000));
      const client = new ZohoBooksClient(orgs[i]);
      const { txns } = await fetchTransactionsForAccounts(client, profFeeCodes, dateFrom, dateTo);
      for (const txn of txns) {
        if (txn.payee) accumulate(txn.payee, txn.amount, orgs[i]);
      }
      log.push(`${orgs[i]}: ${txns.length} transactions`);
    }

    const contacts = Array.from(accumulator.entries())
      .map(([contact_name, amounts]) => {
        const orgs: string[] = [];
        if (amounts.spa !== 0)        orgs.push("spa");
        if (amounts.aesthetics !== 0) orgs.push("aesthetics");
        return { contact_name, total_amount: round2(amounts.spa + amounts.aesthetics), orgs };
      })
      .sort((a, b) => b.total_amount - a.total_amount || a.contact_name.localeCompare(b.contact_name));

    // Auto-seed CRM roles for unmatched contacts.
    try {
      const supabase = getAdminClient();
      const { data: existing } = await supabase.from("wage_role_mapping").select("contact_key");
      const alreadyMapped = new Set((existing ?? []).map((r: { contact_key: string }) => r.contact_key));

      const toSeed = contacts
        .map((c) => ({ contact_name: c.contact_name, role: fuzzyRole(c.contact_name) }))
        .filter((r): r is { contact_name: string; role: string } =>
          r.role !== null && !alreadyMapped.has(normalizeContact(r.contact_name))
        )
        .map((r) => ({
          contact_key:  normalizeContact(r.contact_name),
          contact_name: r.contact_name.trim(),
          role:         r.role,
          updated_at:   new Date().toISOString(),
        }));

      if (toSeed.length > 0) {
        await supabase.from("wage_role_mapping").upsert(toSeed, { onConflict: "contact_key" });
        log.push(`Auto-seeded ${toSeed.length} CRM role(s)`);
      }
    } catch (seedErr) {
      log.push(`Auto-seed skipped: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`);
    }

    return NextResponse.json({
      contacts,
      date_from:      dateFrom,
      date_to:        dateTo,
      total_contacts: contacts.length,
      prof_fee_codes: profFeeCodes,
      log,
    });

  } catch (e) {
    return NextResponse.json(
      { error: `prof-fee-contacts failed: ${e instanceof Error ? e.message : String(e)}`, log },
      { status: 500 },
    );
  }
}
