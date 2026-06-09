import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com")
  .split(",")
  .map((e) => e.trim().toLowerCase());

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();
  return ADMIN_EMAILS.includes(email);
}

/** GET /api/admin/user-permissions?email=xxx — fetch all permissions for an email */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const db = getAdminClient();
  const { data, error } = await db
    .from("user_dashboard_permissions")
    .select("dashboard_key, has_access")
    .eq("email", email.toLowerCase())
    .order("dashboard_key");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** PUT /api/admin/user-permissions — update a single permission toggle */
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { email, dashboard_key, has_access } = await req.json();
  if (!email || !dashboard_key || typeof has_access !== "boolean") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const db = getAdminClient();
  const { error } = await db
    .from("user_dashboard_permissions")
    .update({ has_access, updated_at: new Date().toISOString() })
    .eq("email", email.toLowerCase())
    .eq("dashboard_key", dashboard_key);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
