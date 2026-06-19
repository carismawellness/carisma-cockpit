/**
 * POST /api/etl/speed-to-lead
 *
 * Computes speed-to-lead (business-hours response time, lead creation → first
 * move out of "New Leads") per GHL opportunity and writes crm_speed_to_lead +
 * crm_daily rollups. Idempotent (upsert on ghl_opportunity_id / date,brand_id).
 *
 * Body (optional): { "days_back": 90 }
 *
 * Called nightly by /api/cron/nightly-refresh (Phase 2, after ghl-crm so the
 * webhook mirror is fresh). Can be triggered manually: POST {}.
 *
 * Required env: GHL_API_KEY[_AESTHETICS|_SLIMMING], SUPABASE_SERVICE_ROLE_KEY,
 *               NEXT_PUBLIC_SUPABASE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { ETLLogger } from "@/lib/etl/etl-logger";
import { runSpeedToLead } from "@/lib/etl/speed-to-lead";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const daysBack = typeof body.days_back === "number" && body.days_back > 0 ? body.days_back : 90;

  const logger = new ETLLogger("speed_to_lead");
  await logger.start();

  const result = await runSpeedToLead(daysBack);

  if (result.status === "error") await logger.fail((result.errors ?? ["unknown"]).join(" | ").slice(0, 500));
  else await logger.complete(result.total_rows);

  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
