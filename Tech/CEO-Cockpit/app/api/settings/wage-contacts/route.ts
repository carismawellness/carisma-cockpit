/**
 * POST /api/settings/wage-contacts
 *
 * Returns all unique contact names that appear on wages/salary GL accounts
 * across both Zoho orgs (spa + aesthetics) for a given date range.  Used by
 * the Employee Mapping settings page to populate its contact picker.
 *
 * Body (all optional):
 *   { date_from?: string, date_to?: string }   // YYYY-MM-DD; defaults below
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
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchTransactionsForAccounts } from "@/lib/etl/zoho-account-transactions";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Wages / salary GL codes to query.  Both orgs use the same codes; if a code
// doesn't exist in a given org's COA, fetchTransactionsForAccounts returns []
// for it (no error).
const WAGE_CODES = [
  "30001", "30002", "30003", "30004", "30005", "30006",
  "602221", "602222",
];

const DEFAULT_DATE_FROM = "2025-01-01";
const DEFAULT_DATE_TO   = "2026-04-30";

function isValidIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    // Parse optional body — tolerate empty body gracefully.
    let dateFrom = DEFAULT_DATE_FROM;
    let dateTo   = DEFAULT_DATE_TO;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (typeof body.date_from === "string" && body.date_from) dateFrom = body.date_from;
        if (typeof body.date_to   === "string" && body.date_to)   dateTo   = body.date_to;
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
      const { txns } = await fetchTransactionsForAccounts(client, WAGE_CODES, dateFrom, dateTo);
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
    });

  } catch (e) {
    return NextResponse.json(
      { error: `wage-contacts failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
