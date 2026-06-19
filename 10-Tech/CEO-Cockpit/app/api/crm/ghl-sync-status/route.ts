import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("crm_daily")
    .select("etl_synced_at")
    .order("etl_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ last_synced: null }, { status: 500 });
  }

  return NextResponse.json({
    last_synced: (data as { etl_synced_at?: string } | null)?.etl_synced_at ?? null,
  });
}
