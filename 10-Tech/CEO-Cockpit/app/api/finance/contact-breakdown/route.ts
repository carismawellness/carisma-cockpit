/**
 * GET /api/finance/contact-breakdown
 *
 * Contact-level breakdown for a single P&L cell on the EBITDA dashboard.
 * Queries `transactions_raw` in Supabase and aggregates amounts per contact.
 *
 * Query params:
 *   • org              — "spa" | "aesthetics" | "both"
 *   • ebitda_line      — "wages" | "sga" | "cogs" | "advertising" | "rent" | "utilities"
 *   • ebitda_sub_line  — optional sub-line filter (e.g. "prof_services", "fuel", …)
 *   • venue            — optional venue slug (e.g. "inter", "hugos"). When provided,
 *                        only transactions tagged to that venue are included. Untagged
 *                        (split/ratio) transactions are always included regardless.
 *   • date_from        — YYYY-MM-DD (inclusive)
 *   • date_to          — YYYY-MM-DD (inclusive)
 */

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const VALID_ORGS   = new Set(["spa", "aesthetics", "both"]);
const VALID_EBITDA = new Set(["wages", "sga", "cogs", "advertising", "rent", "utilities"]);
const ISO_DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;

interface ContactRow {
  contact_name: string;
  amount:       number;
  pct:          number;
}

interface ContactBreakdownResponse {
  org:             string;
  ebitda_line:     string;
  ebitda_sub_line: string | null;
  venue:           string | null;
  date_from:       string;
  date_to:         string;
  total:           number;
  rows:            ContactRow[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const org           = searchParams.get("org")              ?? "";
  const ebitdaLine    = searchParams.get("ebitda_line")      ?? "";
  const ebitdaSubLine = searchParams.get("ebitda_sub_line")  ?? "";
  const venue         = searchParams.get("venue")            ?? "";   // new
  const dateFrom      = searchParams.get("date_from")        ?? "";
  const dateTo        = searchParams.get("date_to")          ?? "";

  // ── Validation ────────────────────────────────────────────────────────────
  const missing = (["org", "ebitda_line", "date_from", "date_to"] as const).filter(
    (k) => !searchParams.get(k),
  );
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required params: ${missing.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_ORGS.has(org)) {
    return NextResponse.json({ error: `org must be one of: spa, aesthetics, both` }, { status: 400 });
  }
  if (!VALID_EBITDA.has(ebitdaLine)) {
    return NextResponse.json(
      { error: `ebitda_line must be one of: ${Array.from(VALID_EBITDA).join(", ")}` },
      { status: 400 },
    );
  }
  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) {
    return NextResponse.json({ error: "date_from and date_to must be YYYY-MM-DD" }, { status: 400 });
  }

  // ── Supabase fetch ────────────────────────────────────────────────────────
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  // When venue is provided, fetch two buckets and merge:
  //   1. Rows tagged to that exact venue
  //   2. Rows with no venue (null) — split/ratio costs shared across venues
  // Group and untagged rows (spa-aggregate, group) → no venue filter.
  const fetchVenueRows = async (venueFilter: string | null | undefined) => {
    const qs = new URLSearchParams([
      ["select",      "contact_name,amount"],
      ["date",        `gte.${dateFrom}`],
      ["date",        `lte.${dateTo}`],
      ["ebitda_line", `eq.${ebitdaLine}`],
    ]);
    if (org !== "both") qs.append("org", `eq.${org}`);
    if (ebitdaSubLine) qs.append("ebitda_sub_line", `eq.${ebitdaSubLine}`);
    if (venueFilter !== undefined) {
      qs.append("venue", venueFilter === null ? "is.null" : `eq.${venueFilter}`);
    }
    const res = await fetch(`${base}/rest/v1/transactions_raw?${qs.toString()}`, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.json() as Promise<Array<{ contact_name: string; amount: number }>>;
  };

  let rows: Array<{ contact_name: string; amount: number }>;
  try {
    if (venue && venue !== "group" && venue !== "spa-aggregate") {
      // Venue-specific: tagged rows for this venue + untagged (split) rows
      const [tagged, untagged] = await Promise.all([
        fetchVenueRows(venue),
        fetchVenueRows(null),
      ]);
      rows = [...tagged, ...untagged];
    } else {
      // Brand-wide or group: no venue filter
      rows = await fetchVenueRows(undefined);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to query transactions_raw: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // ── Group by contact_name ─────────────────────────────────────────────────
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = row.contact_name ?? "";
    totals.set(name, (totals.get(name) ?? 0) + row.amount);
  }

  const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0);

  const contactRows: ContactRow[] = Array.from(totals.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([name, amount]) => ({
      contact_name: name === "" ? "Unassigned" : name,
      amount:       Math.round(amount * 100) / 100,
      pct:          grandTotal !== 0 ? Math.round((amount / grandTotal) * 1000) / 10 : 0,
    }));

  const response: ContactBreakdownResponse = {
    org,
    ebitda_line:     ebitdaLine,
    ebitda_sub_line: ebitdaSubLine || null,
    venue:           venue || null,
    date_from:       dateFrom,
    date_to:         dateTo,
    total:           Math.round(grandTotal * 100) / 100,
    rows:            contactRows,
  };
  return NextResponse.json(response);
}
