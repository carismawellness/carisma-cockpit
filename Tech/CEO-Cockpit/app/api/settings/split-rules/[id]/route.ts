import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, config } = body;

  const { data: existing } = await supabase
    .from("coa_split_rules").select("is_system").eq("id", id).single();
  if (existing?.is_system) {
    return NextResponse.json({ error: "System rules cannot be edited" }, { status: 403 });
  }

  if (config) {
    const total = Object.values(config as Record<string, number>).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 100) > 0.01) {
      return NextResponse.json({ error: `Percentages must sum to 100 (got ${total.toFixed(1)})` }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (name) updates.name = name.trim();
  if (config) updates.config = config;

  const { data, error } = await supabase
    .from("coa_split_rules").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: existing } = await supabase
    .from("coa_split_rules").select("is_system").eq("id", id).single();
  if (existing?.is_system) {
    return NextResponse.json({ error: "System rules cannot be deleted" }, { status: 403 });
  }

  // Unlink any COA rows using this rule before deleting
  await supabase.from("zoho_coa_mapping").update({ split_rule_id: null }).eq("split_rule_id", id);

  const { error } = await supabase.from("coa_split_rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
