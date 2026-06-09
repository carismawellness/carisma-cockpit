import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { auditSchema } from "@/lib/validations";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const page = searchParams.get("page");

  let query = serviceSupabase
    .from("ci_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (page) query = query.eq("page", page);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data });
}

export async function POST(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await authSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = auditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { action, page, details } = parsed.data;

  const { data, error } = await serviceSupabase
    .from("ci_audit_log")
    .insert({ user_id: user.id, action, page: page ?? null, details: details ?? null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data });
}
