/**
 * Klaviyo overview API — reads from Supabase klaviyo_daily.
 *
 * Returns aggregated email-marketing metrics for a brand over a date range.
 * Used by all 4 marketing dashboards. Fast (~50ms) and resilient — no live
 * Klaviyo calls on the user request path.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

type BrandSlug = "spa" | "aesthetics" | "slimming";
const VALID_BRANDS = new Set<BrandSlug>(["spa", "aesthetics", "slimming"]);

const BRAND_ID: Record<BrandSlug, number> = {
  spa: 1,
  aesthetics: 2,
  slimming: 3,
};

export interface KlaviyoOverviewResponse {
  totalSubscribers: number;
  campaignsSent: number;
  activeFlows: number;
  totalRecipients: number;
  totalDelivered: number;
  openRate: number;          // 0-1
  clickRate: number;         // 0-1
  unsubscribeRate: number;   // 0-1
  bounceRate: number;        // 0-1
  hasData: boolean;
  lastSyncedAt: string | null;
  error?: string;
}

const EMPTY: KlaviyoOverviewResponse = {
  totalSubscribers: 0,
  campaignsSent: 0,
  activeFlows: 0,
  totalRecipients: 0,
  totalDelivered: 0,
  openRate: 0,
  clickRate: 0,
  unsubscribeRate: 0,
  bounceRate: 0,
  hasData: false,
  lastSyncedAt: null,
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const from = searchParams.get("from") ?? "2026-01-01";
  const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json(
      { ...EMPTY, error: "Invalid brand" },
      { status: 400 },
    );
  }

  const supabase = getAdminClient();
  const cols =
    "date,total_subscribers,active_flows,campaigns_sent,total_recipients,total_delivered,open_rate_pct,click_rate_pct,unsubscribe_rate_pct,bounce_rate_pct,etl_synced_at";

  const { data, error } = await supabase
    .from("klaviyo_daily")
    .select(cols)
    .eq("brand_id", BRAND_ID[brand])
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false });

  if (error) {
    return NextResponse.json(
      { ...EMPTY, error: error.message },
      { status: 500 },
    );
  }

  let rows = data ?? [];

  // Fallback: if no rows in the requested range (ETL hasn't backfilled it),
  // show the most recent snapshot so the dashboard isn't blank.
  if (rows.length === 0) {
    const { data: latest } = await supabase
      .from("klaviyo_daily")
      .select(cols)
      .eq("brand_id", BRAND_ID[brand])
      .order("date", { ascending: false })
      .limit(1);
    rows = latest ?? [];
  }

  if (rows.length === 0) {
    return NextResponse.json(EMPTY);
  }

  // Aggregate across the date range.
  // - totalSubscribers / activeFlows: take the most recent snapshot
  // - campaignsSent / recipients / delivered: sum
  // - rates: delivered-weighted average
  let campaignsSent = 0;
  let totalRecipients = 0;
  let totalDelivered = 0;
  let weightedOpen = 0;
  let weightedClick = 0;
  let weightedUnsub = 0;
  let weightedBounce = 0;
  let recipientsForBounce = 0;

  for (const r of rows) {
    const recipients = Number(r.total_recipients ?? 0);
    const delivered = Number(r.total_delivered ?? 0);
    campaignsSent += Number(r.campaigns_sent ?? 0);
    totalRecipients += recipients;
    totalDelivered += delivered;
    weightedOpen += Number(r.open_rate_pct ?? 0) * delivered;
    weightedClick += Number(r.click_rate_pct ?? 0) * delivered;
    weightedUnsub += Number(r.unsubscribe_rate_pct ?? 0) * delivered;
    weightedBounce += Number(r.bounce_rate_pct ?? 0) * recipients;
    recipientsForBounce += recipients;
  }

  // Latest snapshot for subscriber count + active flow count
  const latest = rows[0]; // ordered desc
  const totalSubscribers = Number(latest.total_subscribers ?? 0);
  const activeFlows = Number(latest.active_flows ?? 0);

  // Rates in DB are stored as percentages (0-100). Convert to 0-1 for UI.
  const openRate = totalDelivered > 0 ? weightedOpen / totalDelivered / 100 : 0;
  const clickRate = totalDelivered > 0 ? weightedClick / totalDelivered / 100 : 0;
  const unsubscribeRate =
    totalDelivered > 0 ? weightedUnsub / totalDelivered / 100 : 0;
  const bounceRate =
    recipientsForBounce > 0 ? weightedBounce / recipientsForBounce / 100 : 0;

  const hasData =
    totalSubscribers > 0 ||
    campaignsSent > 0 ||
    activeFlows > 0 ||
    totalRecipients > 0;

  const resp: KlaviyoOverviewResponse = {
    totalSubscribers,
    campaignsSent,
    activeFlows,
    totalRecipients,
    totalDelivered,
    openRate,
    clickRate,
    unsubscribeRate,
    bounceRate,
    hasData,
    lastSyncedAt: latest.etl_synced_at ?? null,
  };
  return NextResponse.json(resp);
}
