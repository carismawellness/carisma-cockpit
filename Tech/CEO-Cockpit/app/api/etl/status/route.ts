import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getStalenessReport } from "@/lib/etl/staleness";

export const maxDuration = 60;

export async function GET() {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("etl_sync_log")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Additive: per-source staleness vs expected cadence (most sources are
  // nightly → 26h threshold). Never throws — returns [] on failure.
  const staleness = await getStalenessReport();

  return NextResponse.json({ syncs: data, staleness });
}
