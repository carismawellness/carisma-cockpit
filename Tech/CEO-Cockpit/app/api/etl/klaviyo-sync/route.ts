/**
 * POST /api/etl/klaviyo-sync
 *
 * Body: { date?: string, brand_slug?: "spa"|"aesthetics"|"slimming" }
 * Defaults: yesterday, all brands.
 *
 * Persists Klaviyo daily aggregate metrics (subscriber counts, email rates)
 * to the klaviyo_daily table.
 */

import { NextRequest, NextResponse } from "next/server";
import { runKlaviyoDailyEtl } from "@/lib/etl/klaviyo-daily";

export const maxDuration = 120;
export const dynamic    = "force-dynamic";

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const date      = typeof body.date       === "string" ? body.date       : yesterday();
  const brandSlug = typeof body.brand_slug === "string" ? body.brand_slug : undefined;

  const VALID = new Set(["spa", "aesthetics", "slimming"]);
  if (brandSlug && !VALID.has(brandSlug)) {
    return NextResponse.json({ error: "Invalid brand_slug" }, { status: 400 });
  }

  try {
    const result = await runKlaviyoDailyEtl({
      date,
      brandSlug: brandSlug as "spa" | "aesthetics" | "slimming" | undefined,
    });

    return NextResponse.json({
      status: "ok",
      date,
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
