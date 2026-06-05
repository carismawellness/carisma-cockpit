import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// GET /api/settings/ebitda-v2-rules
// Returns special_persons and hardwired_rules arrays.
export async function GET() {
  const supabase = await createServerSupabaseClient();

  const [persons, rules] = await Promise.all([
    supabase
      .from("ebitda_v2_special_persons")
      .select("*")
      .order("contact_key"),
    supabase
      .from("ebitda_v2_hardwired_rules")
      .select("*")
      .order("venue"),
  ]);

  if (persons.error) return NextResponse.json({ error: persons.error.message }, { status: 500 });
  if (rules.error)   return NextResponse.json({ error: rules.error.message },   { status: 500 });

  return NextResponse.json({ special_persons: persons.data, hardwired_rules: rules.data });
}

// POST /api/settings/ebitda-v2-rules
// Body: { action, ...payload }
// action = "add_person"    → { contact_key, display_name }
// action = "toggle_person" → { id, active }
// action = "delete_person" → { id }
// action = "update_rule"   → { id, params, note }
export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const body: Record<string, unknown> = await req.json();
  const { action } = body;

  if (action === "add_person") {
    const contact_key  = String(body.contact_key  ?? "").toLowerCase().trim();
    const display_name = String(body.display_name ?? "").trim();
    if (!contact_key || !display_name)
      return NextResponse.json({ error: "contact_key and display_name required" }, { status: 400 });

    const { data, error } = await supabase
      .from("ebitda_v2_special_persons")
      .insert({ contact_key, display_name })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ person: data });
  }

  if (action === "toggle_person") {
    const { id, active } = body;
    const { error } = await supabase
      .from("ebitda_v2_special_persons")
      .update({ active })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_person") {
    const { id } = body;
    const { error } = await supabase
      .from("ebitda_v2_special_persons")
      .delete()
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_rule") {
    const { id, params, note } = body;
    const { error } = await supabase
      .from("ebitda_v2_hardwired_rules")
      .update({ params, note })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
