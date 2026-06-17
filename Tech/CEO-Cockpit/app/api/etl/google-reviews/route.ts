/**
 * POST /api/etl/google-reviews
 *
 * Pulls today's Google review snapshot (rating + total review count) for all
 * 10 Carisma locations via the Places API (New) and upserts into
 * google_reviews. Also captures individual review texts (up to 5 most recent
 * per location) into google_review_texts for longitudinal negative-review
 * tracking. Idempotent — re-running on the same day just refreshes snapshots
 * and adds any newly-posted reviews.
 *
 * No body required: POST {}.
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY   (Places API (New) key)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { NextRequest, NextResponse } from "next/server";
import { runGoogleReviewsEtl } from "@/lib/etl/google-reviews";
import { ETLLogger } from "@/lib/etl/etl-logger";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Optional body (unused — always full snapshot of all locations)
  try { await req.json(); } catch { /* no body is fine */ }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 },
    );
  }

  const logger = new ETLLogger("google_reviews");
  await logger.start();

  try {
    const result = await runGoogleReviewsEtl();

    if (result.rows_upserted === 0 && result.errors.length > 0) {
      await logger.fail(result.errors.join(" | ").slice(0, 500));
      return NextResponse.json(
        { status: "error", errors: result.errors, log: result.log.join("\n") },
        { status: 500 },
      );
    }

    await logger.complete(result.rows_upserted);
    return NextResponse.json({
      status: result.errors.length === 0 ? "ok" : "partial",
      date: result.date,
      rows_upserted: result.rows_upserted,
      reviews_upserted: result.reviews_upserted,
      errors: result.errors.length > 0 ? result.errors : undefined,
      log: result.log.join("\n"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logger.fail(msg);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
