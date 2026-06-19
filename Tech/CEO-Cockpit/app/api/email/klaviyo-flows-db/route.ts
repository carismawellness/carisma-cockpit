/**
 * GET /api/email/klaviyo-flows-db?brand=spa&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Reads from klaviyo_flows_daily (Supabase). Returns the latest snapshot
 * within the requested date window for each flow, with metrics aggregated
 * across the window (sum of recipients/delivered/opens/clicks).
 *
 * Falls back to the most recent snapshot ever if no rows exist for the range.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 15;

const BRAND_ID: Record<string, number> = { spa: 1, aesthetics: 2, slimming: 3 };

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand");
  const from  = searchParams.get("from");
  const to    = searchParams.get("to");

  if (!brand || !BRAND_ID[brand]) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const brandId  = BRAND_ID[brand];

  // Try the requested window first
  let query = supabase
    .from("klaviyo_flows_daily")
    .select("flow_id,flow_name,status,snapshot_date,recipients,delivered,opens,clicks,unsubscribes,open_rate_pct,click_rate_pct")
    .eq("brand_id", brandId)
    .order("snapshot_date", { ascending: false });

  if (from && to) query = query.gte("snapshot_date", from).lte("snapshot_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message, flows: [] }, { status: 500 });

  // If no data in range, fall back to latest available snapshot date
  let rows = data ?? [];
  if (rows.length === 0 && from && to) {
    const { data: fallback } = await supabase
      .from("klaviyo_flows_daily")
      .select("flow_id,flow_name,status,snapshot_date,recipients,delivered,opens,clicks,unsubscribes,open_rate_pct,click_rate_pct")
      .eq("brand_id", brandId)
      .order("snapshot_date", { ascending: false })
      .limit(200);
    rows = fallback ?? [];
  }

  // Aggregate per flow across all matching snapshot rows
  const flowMap = new Map<string, {
    flowId: string; flowName: string; status: string; latestDate: string;
    recipients: number; delivered: number; opens: number; clicks: number; unsubscribes: number;
    rowCount: number;
  }>();

  for (const r of rows) {
    const existing = flowMap.get(r.flow_id);
    if (!existing) {
      flowMap.set(r.flow_id, {
        flowId: r.flow_id, flowName: r.flow_name, status: r.status ?? "live",
        latestDate: r.snapshot_date,
        recipients: r.recipients ?? 0, delivered: r.delivered ?? 0,
        opens: r.opens ?? 0, clicks: r.clicks ?? 0, unsubscribes: r.unsubscribes ?? 0,
        rowCount: 1,
      });
    } else {
      existing.recipients   += r.recipients   ?? 0;
      existing.delivered    += r.delivered    ?? 0;
      existing.opens        += r.opens        ?? 0;
      existing.clicks       += r.clicks       ?? 0;
      existing.unsubscribes += r.unsubscribes ?? 0;
      existing.rowCount     += 1;
      if (r.snapshot_date > existing.latestDate) existing.latestDate = r.snapshot_date;
    }
  }

  const flows = Array.from(flowMap.values())
    .sort((a, b) => b.recipients - a.recipients)
    .map((f) => ({
      flowId:      f.flowId,
      flowName:    f.flowName,
      status:      f.status,
      snapshotDate: f.latestDate,
      recipients:  f.recipients,
      delivered:   f.delivered,
      opens:       f.opens,
      clicks:      f.clicks,
      unsubscribes: f.unsubscribes,
      openRate:    f.delivered > 0 ? (f.opens  / f.delivered) * 100 : null,
      clickRate:   f.delivered > 0 ? (f.clicks / f.delivered) * 100 : null,
    }));

  return NextResponse.json({ brand, flows, snapshotCount: rows.length });
}
