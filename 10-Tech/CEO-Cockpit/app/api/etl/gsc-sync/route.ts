/**
 * POST /api/etl/gsc-sync
 *
 * Body: { start_date?: string, end_date?: string, brand_slug?: "spa"|"aesthetics"|"slimming" }
 * Defaults: end_date = 3 days ago (GSC's typical data lag), start_date = end_date - 29.
 *
 * Pulls Google Search Console rankings for tracked keywords and upserts into
 * gsc_keyword_daily. Configure the tracked keyword list in
 * lib/constants/gsc-keywords.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { runGscKeywordEtl } from "@/lib/etl/gsc-keyword-daily";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* allow empty body */
  }

  const startDate = typeof body.start_date === "string" ? body.start_date : undefined;
  const endDate = typeof body.end_date === "string" ? body.end_date : undefined;
  const brandSlug = typeof body.brand_slug === "string" ? body.brand_slug : undefined;

  const VALID = new Set(["spa", "aesthetics", "slimming"]);
  if (brandSlug && !VALID.has(brandSlug)) {
    return NextResponse.json({ error: "Invalid brand_slug" }, { status: 400 });
  }

  try {
    const result = await runGscKeywordEtl({
      startDate,
      endDate,
      brandSlug: brandSlug as "spa" | "aesthetics" | "slimming" | undefined,
    });
    return NextResponse.json({
      status: "ok",
      rows_upserted: result.rows_upserted,
      log: result.log,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
