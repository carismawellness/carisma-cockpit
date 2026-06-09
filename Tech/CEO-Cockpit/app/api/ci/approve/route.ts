import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { approveSchema } from "@/lib/validations";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const body = await request.json();
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { alert_id, action } = parsed.data;

  const newStatus = action === "approve" ? "approved" : "dismissed";
  const updates: Record<string, unknown> = { status: newStatus };
  if (action === "approve") {
    updates.approved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("ci_alerts")
    .update(updates)
    .eq("id", alert_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ alert: data });
}
