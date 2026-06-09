/**
 * /api/finance/financial-entries
 *
 * Read and manually override rows in financial_entries — the single source of
 * truth for all daily EBITDA data.
 *
 * GET  — query rows by date range, brand, category, venue
 * PATCH — override a single row's amount (sets is_manual_override = true)
 * DELETE — clear a manual override (reverts row to last Zoho-synced value on next ETL run)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ── GET ──────────────────────────────────────────────────────────────────────
// Query params:
//   date_from  YYYY-MM-DD  (required)
//   date_to    YYYY-MM-DD  (required)
//   brand      SPA | AES | SLIM | HQ  (optional, repeatable)
//   category   e.g. revenue | cogs | wages  (optional)
//   venue      (optional)
//   overrides_only  true — return only manually overridden rows
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  let query = supabase
    .from("financial_entries")
    .select("*")
    .gte("date", dateFrom)
    .lte("date", dateTo)
    .order("date", { ascending: true })
    .order("brand")
    .order("ebitda_category")
    .order("venue");

  const brand    = searchParams.get("brand");
  const category = searchParams.get("category");
  const venue    = searchParams.get("venue");

  if (brand)    query = query.eq("brand", brand.toUpperCase());
  if (category) query = query.eq("ebitda_category", category.toLowerCase());
  if (venue)    query = query.ilike("venue", venue);
  if (searchParams.get("overrides_only") === "true") query = query.eq("is_manual_override", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data, count: data?.length ?? 0 });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
// Body: { id: number, amount: number, override_reason?: string }
// Sets is_manual_override = true so the next ETL run won't overwrite this value.
export async function PATCH(req: NextRequest) {
  let body: { id: number; amount: number; override_reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, amount, override_reason } = body;
  if (typeof id !== "number" || typeof amount !== "number") {
    return NextResponse.json({ error: "id (number) and amount (number) are required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("financial_entries")
    .update({
      amount,
      is_manual_override: true,
      override_reason:    override_reason ?? null,
      updated_at:         new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ row: data });
}

// ── DELETE ────────────────────────────────────────────────────────────────────
// Body: { id: number }
// Clears the manual override flag. The row's amount stays as-is until the next
// ETL run restores the Zoho-pulled value.
export async function DELETE(req: NextRequest) {
  let body: { id: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = body;
  if (typeof id !== "number") {
    return NextResponse.json({ error: "id (number) is required" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("financial_entries")
    .update({
      is_manual_override: false,
      override_reason:    null,
      updated_at:         new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ row: data });
}
