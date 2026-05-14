import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get("org") ?? "spa";
  const { data, error } = await supabase
    .from("coa_split_rules")
    .select("*")
    .eq("zoho_org", org)
    .order("is_system", { ascending: false })
    .order("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, zoho_org = "spa", config } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "config (per-location %) is required for custom rules" }, { status: 400 });
  }
  const total = Object.values(config as Record<string, number>).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 100) > 0.01) {
    return NextResponse.json({ error: `Percentages must sum to 100 (got ${total.toFixed(1)})` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("coa_split_rules")
    .insert({ name: name.trim(), zoho_org, rule_type: "custom_fixed", is_system: false, config })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
