import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com"
)
  .split(",")
  .map((e) => e.trim().toLowerCase());

/** GET /api/me/permissions — returns the current user's allowed dashboard keys */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ isAdmin: false, keys: [] });
  }

  const email = user.email.toLowerCase();

  if (ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ isAdmin: true, keys: [] });
  }

  const db = getAdminClient();
  const { data } = await db
    .from("user_dashboard_permissions")
    .select("dashboard_key")
    .eq("email", email)
    .eq("has_access", true);

  const keys = (data ?? []).map((r) => r.dashboard_key as string);
  return NextResponse.json({ isAdmin: false, keys });
}
