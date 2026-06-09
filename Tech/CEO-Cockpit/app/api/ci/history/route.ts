import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET() {
  const serviceSupabase = getAdminClient();
  try {
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await serviceSupabase
      .from("ci_chat_history")
      .select("role, message, sql_query, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: "Failed to load history" },
        { status: 500 }
      );
    }

    // Reverse to chronological order
    const messages = (data || []).reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.message,
      sql_query: row.sql_query || undefined,
    }));

    return NextResponse.json({ messages });
  } catch {
    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 }
    );
  }
}
