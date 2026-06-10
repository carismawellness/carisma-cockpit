import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DASHBOARD_KEYS } from "@/lib/constants/dashboards";

export const maxDuration = 60;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "contact@mertgulen.com,admin@cockpit.local,123@cockpit.local,mert@carismaspa.com")
  .split(",")
  .map((e) => e.trim().toLowerCase());

async function requireAdmin(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();
  return ADMIN_EMAILS.includes(email) ? email : null;
}

/** GET /api/admin/invitations — list all invitations */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = getAdminClient();
  const { data, error } = await db
    .from("user_invitations")
    .select("id, email, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with registered status — skip if auth admin call fails (non-blocking)
  let registeredEmails = new Set<string | undefined>();
  try {
    const { data: authUsers } = await db.auth.admin.listUsers();
    registeredEmails = new Set((authUsers?.users ?? []).map((u) => u.email?.toLowerCase()));
  } catch {}

  const enriched = (data ?? []).map((inv) => ({
    ...inv,
    registered: registeredEmails.has(inv.email.toLowerCase()),
  }));

  return NextResponse.json(enriched);
}

/** POST /api/admin/invitations — invite an email, seed permissions, and create auth account */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { email, permissions } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const normalised = email.trim().toLowerCase();
  const granted = new Set<string>(Array.isArray(permissions) ? permissions : []);
  const db = getAdminClient();

  // Upsert invitation row
  const { error: invErr } = await db
    .from("user_invitations")
    .upsert({ email: normalised, is_active: true }, { onConflict: "email" });

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  // Seed all permission rows — true for selected, false for the rest
  const rows = DASHBOARD_KEYS.map((key) => ({
    email: normalised,
    dashboard_key: key,
    has_access: granted.has(key),
  }));

  const { error: permErr } = await db
    .from("user_dashboard_permissions")
    .upsert(rows, { onConflict: "email,dashboard_key" });

  if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 });

  // Create (or reset) Supabase auth account — no email verification needed
  const tempPassword = "Carisma" + Math.floor(1000 + Math.random() * 9000);

  const { data: existing } = await db.auth.admin.listUsers();
  const existingUser = (existing?.users ?? []).find(
    (u) => u.email?.toLowerCase() === normalised
  );

  if (existingUser) {
    // User already exists — just reset their password
    await db.auth.admin.updateUserById(existingUser.id, { password: tempPassword });
  } else {
    const { error: authErr } = await db.auth.admin.createUser({
      email: normalised,
      password: tempPassword,
      email_confirm: true,
    });
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, tempPassword });
}

/** PATCH /api/admin/invitations — toggle is_active for an email */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { email, is_active } = await req.json();
  if (!email || typeof is_active !== "boolean") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const db = getAdminClient();
  const { error } = await db
    .from("user_invitations")
    .update({ is_active })
    .eq("email", email.toLowerCase());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/invitations?email=xxx — remove invitation */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const db = getAdminClient();
  const normalised = email.toLowerCase();

  await db.from("user_dashboard_permissions").delete().eq("email", normalised);
  const { error } = await db.from("user_invitations").delete().eq("email", normalised);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
