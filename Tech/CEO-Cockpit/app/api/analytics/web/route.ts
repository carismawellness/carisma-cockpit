/**
 * GET /api/analytics/web?brand=spa&from=2026-01-01&to=2026-06-30
 *
 * Reads from ga4_daily (Supabase) and returns aggregated web analytics
 * for the requested brand and date range. Includes Malta geo-traffic,
 * session quality metrics, and Spa-only ecommerce funnel data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { format } from "date-fns";

type BrandSlug = "spa" | "aesthetics" | "slimming";
const VALID_BRANDS = new Set<BrandSlug>(["spa", "aesthetics", "slimming"]);

const BRAND_ID: Record<BrandSlug, number> = {
  spa: 1,
  aesthetics: 2,
  slimming: 3,
};

export interface WebAnalyticsResult {
  sessions: number;
  maltaSessions: number | null;
  maltaPct: number | null;
  pageViews: number;
  avgSessionDurationSec: number | null;
  bounceRatePct: number | null;
  conversions: number;
  conversionRatePct: number | null;
  // Spa ecommerce funnel (null for aesthetics/slimming)
  viewItemCount: number | null;
  viewItemPct: number | null;
  addToCartCount: number | null;
  addToCartPct: number | null;
  beginCheckoutCount: number | null;
  beginCheckoutPct: number | null;
  purchaseCount: number | null;
  purchasePct: number | null;
  hasData: boolean;
}

const EMPTY: WebAnalyticsResult = {
  sessions: 0,
  maltaSessions: null,
  maltaPct: null,
  pageViews: 0,
  avgSessionDurationSec: null,
  bounceRatePct: null,
  conversions: 0,
  conversionRatePct: null,
  viewItemCount: null,
  viewItemPct: null,
  addToCartCount: null,
  addToCartPct: null,
  beginCheckoutCount: null,
  beginCheckoutPct: null,
  purchaseCount: null,
  purchasePct: null,
  hasData: false,
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const today = format(new Date(), "yyyy-MM-dd");
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo = searchParams.get("to") ?? today;

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json(
      { ...EMPTY, error: "Invalid brand" },
      { status: 400 },
    );
  }

  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("ga4_daily")
    .select(
      "sessions,total_users,new_users,page_views,avg_session_duration_sec,bounce_rate_pct,conversions,malta_sessions,conversion_rate_pct,view_item_count,add_to_cart_count,begin_checkout_count,purchase_count",
    )
    .eq("brand_id", BRAND_ID[brand])
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    return NextResponse.json(
      { ...EMPTY, error: error.message },
      { status: 500 },
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return NextResponse.json(EMPTY);
  }

  // Aggregate totals
  let totalSessions = 0;
  let totalMaltaSessions = 0;
  let hasMaltaData = false;
  let totalPageViews = 0;
  let totalConversions = 0;
  let weightedDuration = 0;
  let durationRows = 0;
  let weightedBounce = 0;
  let bounceRows = 0;

  // Spa ecommerce funnel
  let totalViewItem = 0;
  let totalAddToCart = 0;
  let totalBeginCheckout = 0;
  let totalPurchase = 0;
  let hasEcommerce = false;

  for (const r of rows) {
    const sessions = Number(r.sessions ?? 0);
    totalSessions += sessions;
    totalPageViews += Number(r.page_views ?? 0);
    totalConversions += Number(r.conversions ?? 0);

    if (r.malta_sessions !== null && r.malta_sessions !== undefined) {
      totalMaltaSessions += Number(r.malta_sessions);
      hasMaltaData = true;
    }

    if (r.avg_session_duration_sec !== null && r.avg_session_duration_sec !== undefined && sessions > 0) {
      weightedDuration += Number(r.avg_session_duration_sec) * sessions;
      durationRows += sessions;
    }

    if (r.bounce_rate_pct !== null && r.bounce_rate_pct !== undefined && sessions > 0) {
      weightedBounce += Number(r.bounce_rate_pct) * sessions;
      bounceRows += sessions;
    }

    if (r.view_item_count !== null && r.view_item_count !== undefined) {
      totalViewItem += Number(r.view_item_count);
      hasEcommerce = true;
    }
    if (r.add_to_cart_count !== null && r.add_to_cart_count !== undefined) {
      totalAddToCart += Number(r.add_to_cart_count);
    }
    if (r.begin_checkout_count !== null && r.begin_checkout_count !== undefined) {
      totalBeginCheckout += Number(r.begin_checkout_count);
    }
    if (r.purchase_count !== null && r.purchase_count !== undefined) {
      totalPurchase += Number(r.purchase_count);
    }
  }

  const avgDuration = durationRows > 0 ? weightedDuration / durationRows : null;
  const avgBounce = bounceRows > 0 ? weightedBounce / bounceRows : null;
  const maltaPct = hasMaltaData && totalSessions > 0
    ? Math.round((totalMaltaSessions / totalSessions) * 10000) / 100
    : null;
  const conversionRatePct = totalSessions > 0
    ? Math.round((totalConversions / totalSessions) * 10000) / 100
    : null;

  const result: WebAnalyticsResult = {
    sessions: totalSessions,
    maltaSessions: hasMaltaData ? totalMaltaSessions : null,
    maltaPct,
    pageViews: totalPageViews,
    avgSessionDurationSec: avgDuration !== null ? Math.round(avgDuration * 10) / 10 : null,
    bounceRatePct: avgBounce !== null ? Math.round(avgBounce * 100) / 100 : null,
    conversions: totalConversions,
    conversionRatePct,
    viewItemCount: hasEcommerce ? totalViewItem : null,
    viewItemPct: hasEcommerce && totalSessions > 0
      ? Math.round((totalViewItem / totalSessions) * 10000) / 100
      : null,
    addToCartCount: hasEcommerce ? totalAddToCart : null,
    addToCartPct: hasEcommerce && totalSessions > 0
      ? Math.round((totalAddToCart / totalSessions) * 10000) / 100
      : null,
    beginCheckoutCount: hasEcommerce ? totalBeginCheckout : null,
    beginCheckoutPct: hasEcommerce && totalSessions > 0
      ? Math.round((totalBeginCheckout / totalSessions) * 10000) / 100
      : null,
    purchaseCount: hasEcommerce ? totalPurchase : null,
    purchasePct: hasEcommerce && totalSessions > 0
      ? Math.round((totalPurchase / totalSessions) * 10000) / 100
      : null,
    hasData: totalSessions > 0 || totalPageViews > 0,
  };

  return NextResponse.json(result);
}
