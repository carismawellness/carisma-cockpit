import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com")
  .split(",")
  .map((e) => e.trim().toLowerCase());

/** GET /api/admin/users — list registered Supabase auth users */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!ADMIN_EMAILS.includes((user?.email ?? "").toLowerCase())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = getAdminClient();
  const { data, error } = await db.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));

  return NextResponse.json(users);
}
