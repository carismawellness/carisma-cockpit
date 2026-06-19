/**
 * GET /api/etl/health
 *
 * Manual token-health check — runs the same credential canary the nightly
 * cron runs first (Zoho, Google Sheets, Talexio, Klaviyo, GHL, Meta) and
 * returns per-service {ok, error, latencyMs}.
 *
 * Session-gated by the app middleware (like every other API route).
 * Manual checks do NOT write to etl_sync_log (record: false) so they
 * never mask real staleness signals.
 */

import { NextResponse } from "next/server";
import { runTokenCanary } from "@/lib/etl/token-canary";
import { getStalenessReport } from "@/lib/etl/staleness";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const [services, staleness] = await Promise.all([
    runTokenCanary({ record: false }),
    getStalenessReport(),
  ]);

  return NextResponse.json({
    ok:         services.every(s => s.ok),
    checked_at: new Date().toISOString(),
    services,
    staleness,
  });
}
