import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const org    = req.nextUrl.searchParams.get("org")    ?? "spa";
  const filter = req.nextUrl.searchParams.get("filter") ?? "all"; // "all" | "unmapped"
  const search = req.nextUrl.searchParams.get("q")      ?? "";

  let query = supabase
    .from("zoho_coa_mapping")
    .select("*, coa_split_rules(*)")
    .eq("zoho_org", org)
    .order("account_name");

  if (filter === "unmapped") query = query.is("ebitda_line", null);
  if (search) query = query.ilike("account_name", `%${search}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ebitda_line, split_rule_id } = body;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (ebitda_line !== undefined) {
    updates.ebitda_line = ebitda_line || null;
    // Excluded accounts don't need a split rule — clear it automatically
    if (ebitda_line === "excluded") updates.split_rule_id = null;
  }
  if (split_rule_id !== undefined) updates.split_rule_id = split_rule_id || null;

  const { data, error } = await supabase
    .from("zoho_coa_mapping")
    .update(updates)
    .eq("id", id)
    .select("*, coa_split_rules(*)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
