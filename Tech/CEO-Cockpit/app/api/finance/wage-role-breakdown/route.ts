/**
 * GET /api/finance/wage-role-breakdown
 *
 * Breaks down wages transactions by staff role using the wage_role_mapping table.
 * Joins client-side: contact_name is normalised (lowercase, trim, collapse spaces)
 * and looked up in wage_role_mapping. Unmatched contacts fall into "unassigned".
 *
 * Query params:
 *   • org       — "spa" | "aesthetics" | "both"
 *   • date_from — YYYY-MM-DD (inclusive)
 *   • date_to   — YYYY-MM-DD (inclusive)
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VALID_ORGS  = new Set(["spa", "aesthetics", "both"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type KnownRole = "manager" | "reception" | "practitioner" | "crm";

interface WageRoleResponse {
  roles: {
    manager:      number;
    reception:    number;
    practitioner: number;
    crm:          number;
    unassigned:   number;
  };
  total:    number;
  has_data: boolean;
}

/** Normalise a contact name the same way the ETL / mapping UI does. */
function normalise(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const org      = searchParams.get("org")       ?? "";
  const dateFrom = searchParams.get("date_from")  ?? "";
  const dateTo   = searchParams.get("date_to")    ?? "";

  // ── Validation ──────────────────────────────────────────────────────────────
  const missing = (["org", "date_from", "date_to"] as const).filter(
    (k) => !searchParams.get(k),
  );
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required params: ${missing.join(", ")}` },
      { status: 400 },
    );
  }
  if (!VALID_ORGS.has(org)) {
    return NextResponse.json(
      { error: "org must be one of: spa, aesthetics, both" },
      { status: 400 },
    );
  }
  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) {
    return NextResponse.json(
      { error: "date_from and date_to must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  // ── Supabase credentials ────────────────────────────────────────────────────
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = {
    apikey:        key,
    Authorization: `Bearer ${key}`,
  };

  // ── Fetch wage_role_mapping ─────────────────────────────────────────────────
  let mappingRows: Array<{ contact_key: string; role: string }>;
  try {
    const res = await fetch(
      `${base}/rest/v1/wage_role_mapping?select=contact_key,role`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Supabase error ${res.status} (wage_role_mapping): ${text}` },
        { status: 502 },
      );
    }
    mappingRows = await res.json();
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to query wage_role_mapping: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // Build lookup map: normalised contact_key → role
  const roleMap = new Map<string, string>();
  for (const m of mappingRows) {
    roleMap.set(normalise(m.contact_key), m.role);
  }

  // ── Fetch transactions_raw (wages only) ─────────────────────────────────────
  const qs = new URLSearchParams([
    ["select",      "contact_name,amount"],
    ["ebitda_line", "eq.wages"],
    ["date",        `gte.${dateFrom}`],
    ["date",        `lte.${dateTo}`],
  ]);
  if (org !== "both") qs.append("org", `eq.${org}`);

  let txRows: Array<{ contact_name: string; amount: number }>;
  try {
    const res = await fetch(
      `${base}/rest/v1/transactions_raw?${qs.toString()}`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Supabase error ${res.status} (transactions_raw): ${text}` },
        { status: 502 },
      );
    }
    txRows = await res.json();
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to query transactions_raw: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // ── Client-side join & aggregation ──────────────────────────────────────────
  const totals: Record<string, number> = {
    manager:      0,
    reception:    0,
    practitioner: 0,
    crm:          0,
    unassigned:   0,
  };

  for (const tx of txRows) {
    const key  = normalise(tx.contact_name);
    const role = roleMap.get(key) as KnownRole | undefined;
    const bucket: string = role && role in totals ? role : "unassigned";
    totals[bucket] = (totals[bucket] ?? 0) + tx.amount;
  }

  const grandTotal =
    totals.manager + totals.reception + totals.practitioner + totals.crm + totals.unassigned;

  const round = (n: number) => Math.round(n * 100) / 100;

  const response: WageRoleResponse = {
    roles: {
      manager:      round(totals.manager),
      reception:    round(totals.reception),
      practitioner: round(totals.practitioner),
      crm:          round(totals.crm),
      unassigned:   round(totals.unassigned),
    },
    total:    round(grandTotal),
    has_data: txRows.length > 0,
  };

  return NextResponse.json(response);
}
