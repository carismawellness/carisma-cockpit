/**
 * POST /api/settings/wage-contacts
 *
 * Returns all unique contact names that appear on wages/salary GL accounts
 * across both Zoho orgs (spa + aesthetics) for a given date range.  Used by
 * the Employee Mapping settings page to populate its contact picker.
 *
 * Body (all optional):
 *   {
 *     date_from?: string,   // YYYY-MM-DD; defaults below
 *     date_to?: string,     // YYYY-MM-DD; defaults below
 *     wages_only?: boolean, // when true, only use codes from COA map (skip hardcoded fallback)
 *   }
 *
 * Response:
 *   {
 *     contacts: Array<{
 *       contact_name: string;   // exact Zoho payee/contact name
 *       total_amount: number;   // sum across both orgs, 2dp
 *       orgs: string[];         // ["spa"] | ["aesthetics"] | ["spa","aesthetics"]
 *     }>;
 *     date_from: string;
 *     date_to: string;
 *     total_contacts: number;
 *     wage_codes: string[];     // the account codes that were queried
 *     log: string[];            // diagnostic log entries
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionsForAccounts } from "@/lib/etl/zoho-account-transactions";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Fallback wages / salary GL codes — used when both Supabase COA map queries
// return nothing.  Both orgs use the same codes; if a code doesn't exist in a
// given org's COA, fetchTransactionsForAccounts returns [] for it (no error).
const FALLBACK_WAGE_CODES = [
  "30001", "30002", "30003", "30004", "30005", "30006",
  "602221", "602222",
];

const DEFAULT_DATE_FROM = "2025-01-01";
const DEFAULT_DATE_TO   = "2026-06-30";

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Query a Supabase table for account codes where ebitda_line = 'wages'.
 * Returns an empty array (never throws) if the table doesn't exist or the
 * query fails — callers treat a missing table as silently skipped.
 */
async function fetchWageCodesFromTable(
  supabaseUrl: string,
  serviceRoleKey: string,
  table: string,
  log: string[],
): Promise<string[]> {
  try {
    const sep = table.includes("?") ? "&" : "?";
    const url = `${supabaseUrl}/rest/v1/${table}${sep}select=account_code&ebitda_line=eq.wages`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    });

    // 404 / 400 most likely means the table doesn't exist — skip silently.
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        log.push(`Table ${table} not found — skipping`);
      } else {
        log.push(`Table ${table} returned HTTP ${res.status} — skipping`);
      }
      return [];
    }

    const rows = (await res.json()) as Array<{ account_code: string }>;
    const codes = rows.map((r) => String(r.account_code)).filter(Boolean);
    log.push(`Table ${table}: found ${codes.length} wage account code(s)`);
    return codes;
  } catch (err) {
    log.push(`Table ${table} query error: ${err instanceof Error ? err.message : String(err)} — skipping`);
    return [];
  }
}

/**
 * Resolve the full deduplicated set of wage account codes to query.
 * Priority: spa_coa_map + aesthetics_coa_map (union) → fallback hardcoded list.
 * When wagesOnly=true the fallback is skipped even if both tables are empty.
 */
async function resolveWageCodes(wagesOnly: boolean, log: string[]): Promise<string[]> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    log.push("Supabase credentials not configured — using fallback hardcoded wage codes");
    return wagesOnly ? [] : [...FALLBACK_WAGE_CODES];
  }

  // zoho_coa_mapping covers both orgs (zoho_org = 'spa' | 'aesthetics')
  const [spaCodes, aestheticsCodes] = await Promise.all([
    fetchWageCodesFromTable(supabaseUrl, serviceRoleKey, "zoho_coa_mapping?zoho_org=eq.spa", log),
    fetchWageCodesFromTable(supabaseUrl, serviceRoleKey, "zoho_coa_mapping?zoho_org=eq.aesthetics", log),
  ]);

  const combined = [...new Set([...spaCodes, ...aestheticsCodes])];

  if (combined.length === 0) {
    if (wagesOnly) {
      log.push("No codes found in COA maps and wages_only=true — returning empty list");
      return [];
    }
    log.push("No codes found in COA maps — falling back to hardcoded list");
    return [...FALLBACK_WAGE_CODES];
  }

  // Always include fallback codes unless wages_only is set, so we don't
  // accidentally drop codes that exist in Zoho but not yet in the COA map.
  const final = wagesOnly
    ? combined
    : [...new Set([...combined, ...FALLBACK_WAGE_CODES])];

  log.push(`Found ${final.length} wage account codes (${combined.length} from COA map${wagesOnly ? "" : ` + ${FALLBACK_WAGE_CODES.length} hardcoded fallbacks merged`})`);
  return final;
}

export async function POST(req: NextRequest) {
  const log: string[] = [];

  try {
    // Parse optional body — tolerate empty body gracefully.
    let dateFrom = DEFAULT_DATE_FROM;
    let dateTo   = DEFAULT_DATE_TO;
    let wagesOnly = false;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (typeof body.date_from  === "string"  && body.date_from)  dateFrom  = body.date_from;
        if (typeof body.date_to    === "string"  && body.date_to)    dateTo    = body.date_to;
        if (typeof body.wages_only === "boolean" && body.wages_only) wagesOnly = body.wages_only;
      } catch {
        // No body / invalid JSON — use defaults.
      }
    }

    if (!isValidIso(dateFrom) || !isValidIso(dateTo)) {
      return NextResponse.json(
        { error: "date_from and date_to must be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (dateFrom > dateTo) {
      return NextResponse.json(
        { error: "date_from must be on or before date_to" },
        { status: 400 },
      );
    }

    // Resolve wage account codes dynamically from Supabase COA maps.
    const wageCodes = await resolveWageCodes(wagesOnly, log);
    log.push(`Found ${wageCodes.length} wage account codes`);

    // Per-contact accumulator: contact_name → { spa: number, aesthetics: number }
    const accumulator = new Map<string, { spa: number; aesthetics: number }>();

    function accumulate(contactName: string, amount: number, org: "spa" | "aesthetics") {
      const key = contactName.trim();
      if (!key) return;
      const entry = accumulator.get(key) ?? { spa: 0, aesthetics: 0 };
      entry[org] += amount;
      accumulator.set(key, entry);
    }

    // Pull both orgs sequentially to stay gentle on Zoho rate limits.
    for (const org of ["spa", "aesthetics"] as const) {
      const client = new ZohoBooksClient(org);
      const { txns } = await fetchTransactionsForAccounts(client, wageCodes, dateFrom, dateTo);
      for (const txn of txns) {
        if (txn.payee) {
          accumulate(txn.payee, txn.amount, org);
        }
      }
    }

    // Build sorted response.
    const contacts = Array.from(accumulator.entries())
      .map(([contact_name, amounts]) => {
        const orgs: string[] = [];
        if (amounts.spa !== 0)        orgs.push("spa");
        if (amounts.aesthetics !== 0) orgs.push("aesthetics");
        const total_amount = round2(amounts.spa + amounts.aesthetics);
        return { contact_name, total_amount, orgs };
      })
      // Sort by total amount descending; alphabetical as tiebreak.
      .sort((a, b) => b.total_amount - a.total_amount || a.contact_name.localeCompare(b.contact_name));

    return NextResponse.json({
      contacts,
      date_from:      dateFrom,
      date_to:        dateTo,
      total_contacts: contacts.length,
      wage_codes:     wageCodes,
      log,
    });

  } catch (e) {
    return NextResponse.json(
      { error: `wage-contacts failed: ${e instanceof Error ? e.message : String(e)}`, log },
      { status: 500 },
    );
  }
}
