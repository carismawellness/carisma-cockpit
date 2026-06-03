/**
 * GET /api/admin/seed-employee-roles
 *
 * ONE-TIME endpoint.  Fetches all wage contacts from Zoho (Jan 2025 – Jun 2026),
 * fuzzy-matches each name against the known staff-grid name tokens, and bulk-upserts
 * the matched roles into wage_role_mapping.  Unmatched names are left untouched.
 *
 * Rules (from staff grid screenshot):
 *   RM + Supervisor → Manager
 *   Receptionist    → Reception
 *   Therapists      → Therapist
 *
 * Matching: for every whitespace-separated token in the Zoho contact name, we check
 * whether the token STARTS WITH any known staff name (min 4 chars).  This handles
 * spelling variants (Blagojche → blago, Elizabeta → elizabet, Sebastijan → sebastia).
 */

import { NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionsForAccounts } from "@/lib/etl/zoho-account-transactions";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ── Known name tokens per role ──────────────────────────────────────────────

const STAFF_TOKENS: Record<string, string[]> = {
  manager: [
    "neli", "natasha", "aakansha", "kristina", "rita", "jovana", "melanie",
  ],
  reception: [
    "maila", "romero", "baretto", "kemi", "alana", "anja", "jean",
    "gabriely", "gulnaz", "praise", "sofia", "daniela",
  ],
  therapist: [
    "milena", "mini", "julie", "yeniffer", "chris", "anda",
    "lourdes", "lovely", "tessa", "tamara", "tina", "kunyak",
    "ety", "patricia", "vivenne", "marivic", "karla", "darsi",
    "karen", "laura", "juliana", "silvia", "blago", "claudia",
    "thais", "elizabet", "jenny", "vanessa", "pakinee",
    "deborah", "lorena", "sebastia", "sangay", "glecila", "gale",
  ],
};

// Manager takes priority over Reception takes priority over Therapist.
const ROLE_PRIORITY = ["manager", "reception", "therapist"] as const;

function fuzzyAssignRole(contactName: string): string | null {
  const tokens = contactName.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const role of ROLE_PRIORITY) {
    const known = STAFF_TOKENS[role];
    for (const tok of tokens) {
      // A staff token matches if it is a prefix of the contact token (min 4 chars).
      if (known.some((st) => st.length >= 4 && tok.startsWith(st))) return role;
      // Or the contact token is a prefix of the staff token (handles truncated names).
      if (known.some((st) => st.length >= 4 && st.startsWith(tok) && tok.length >= 4)) return role;
    }
  }
  return null;
}

function normalizeContact(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Resolve wage codes (mirrors wage-contacts/route.ts) ────────────────────

const FALLBACK_WAGE_CODES = [
  "30001", "30002", "30003", "30004", "30005", "30006", "602221", "602222",
];

async function resolveWageCodes(): Promise<string[]> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return [...FALLBACK_WAGE_CODES];

  const fetch2 = fetch;
  async function codesFrom(filter: string): Promise<string[]> {
    const url = `${supabaseUrl}/rest/v1/zoho_coa_mapping?${filter}&select=account_code&ebitda_line=eq.wages`;
    const r = await fetch2(url, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!r.ok) return [];
    const rows = (await r.json()) as Array<{ account_code: string }>;
    return rows.map((x) => String(x.account_code)).filter(Boolean);
  }

  const [spa, aes] = await Promise.all([
    codesFrom("zoho_org=eq.spa"),
    codesFrom("zoho_org=eq.aesthetics"),
  ]);
  const combined = [...new Set([...spa, ...aes])];
  return combined.length > 0
    ? [...new Set([...combined, ...FALLBACK_WAGE_CODES])]
    : [...FALLBACK_WAGE_CODES];
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET() {
  const log: string[] = [];

  try {
    const wageCodes = await resolveWageCodes();
    log.push(`Using ${wageCodes.length} wage account codes`);

    // Accumulate contacts across both orgs.
    const accumulator = new Map<string, number>();
    for (const org of ["spa", "aesthetics"] as const) {
      const client = new ZohoBooksClient(org);
      const { txns } = await fetchTransactionsForAccounts(client, wageCodes, "2025-01-01", "2026-06-30");
      for (const txn of txns) {
        if (!txn.payee) continue;
        const key = txn.payee.trim();
        accumulator.set(key, (accumulator.get(key) ?? 0) + txn.amount);
      }
      log.push(`${org}: ${txns.length} transactions`);
    }

    const contacts = Array.from(accumulator.keys());
    log.push(`Total unique contacts: ${contacts.length}`);

    // Fuzzy-match and build assignment list.
    const assignments: Array<{ contact_key: string; contact_name: string; role: string; updated_at: string }> = [];
    const unmatched: string[] = [];

    for (const name of contacts) {
      const role = fuzzyAssignRole(name);
      if (role) {
        assignments.push({
          contact_key:  normalizeContact(name),
          contact_name: name.trim(),
          role,
          updated_at:   new Date().toISOString(),
        });
      } else {
        unmatched.push(name);
      }
    }

    log.push(`Matched: ${assignments.length}, Unmatched: ${unmatched.length}`);

    // Bulk upsert to Supabase.
    if (assignments.length > 0) {
      const supabase = getAdminClient();
      const { error } = await supabase
        .from("wage_role_mapping")
        .upsert(assignments, { onConflict: "contact_key" });
      if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    // Summary by role.
    const summary: Record<string, string[]> = {};
    for (const a of assignments) {
      (summary[a.role] ??= []).push(a.contact_name);
    }

    return NextResponse.json({
      ok:        true,
      saved:     assignments.length,
      unmatched,
      summary,
      log,
    });

  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 },
    );
  }
}
