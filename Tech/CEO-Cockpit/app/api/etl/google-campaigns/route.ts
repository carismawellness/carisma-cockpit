/**
 * POST /api/etl/google-campaigns
 *
 * Body: { date_from?: string, date_to?: string, brand_slug?: "spa"|"aesthetics"|"slimming" }
 * Defaults: last 30 days, all brands.
 *
 * Persists Google Ads campaign-level daily metrics to google_campaigns_daily,
 * including rolling peak_ctr for accurate creative fatigue scoring.
 */

import { NextRequest, NextResponse } from "next/server";
import { runGoogleCampaignsEtl } from "@/lib/etl/google-campaigns";

export const maxDuration = 300;
export const dynamic    = "force-dynamic";

function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const dateFrom  = typeof body.date_from  === "string" ? body.date_from  : defaultDateFrom();
  const dateTo    = typeof body.date_to    === "string" ? body.date_to    : defaultDateTo();
  const brandSlug = typeof body.brand_slug === "string" ? body.brand_slug : undefined;

  const VALID = new Set(["spa", "aesthetics", "slimming"]);
  if (brandSlug && !VALID.has(brandSlug)) {
    return NextResponse.json({ error: "Invalid brand_slug" }, { status: 400 });
  }

  try {
    const result = await runGoogleCampaignsEtl({
      dateFrom,
      dateTo,
      brandSlug: brandSlug as "spa" | "aesthetics" | "slimming" | undefined,
    });

    return NextResponse.json({
      status: "ok",
      date_from: dateFrom,
      date_to:   dateTo,
      rows_upserted: result.rows_upserted,
      log: result.log,
    });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
