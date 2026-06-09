import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/** GET /api/auth/check-invitation?email=xxx — public endpoint used during registration */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const db = getAdminClient();
  const { data } = await db
    .from("user_invitations")
    .select("is_active")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (!data?.is_active) {
    return NextResponse.json(
      { error: "This email has not been invited. Please contact your administrator." },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}
