/**
 * GET /api/ads/spend-comparison?brand=spa&from=2026-01-01&to=2026-06-30
 *
 * Returns monthly Meta + Google spend for the requested period (TY)
 * and the same calendar months one year prior (LY), enabling YoY
 * spend comparison beneath the weekly revenue chart.
 *
 * Uses fetchAll() because daily rows per brand × campaigns can exceed
 * the PostgREST 1000-row default cap when querying 2 years of data.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { MonthlySpend } from "@/lib/hooks/useSpendComparison";

const VALID_BRANDS = new Set(["spa", "aesthetics", "slimming"]);
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthLabel(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]} '${y.slice(2)}`;
}

function priorYearKey(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  return `${parseInt(y) - 1}-${m}`;
}

function monthsInRange(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(from.slice(0, 7) + "-01T00:00:00Z");
  const end   = new Date(to.slice(0, 7)   + "-01T00:00:00Z");
  while (start <= end) {
    result.push(start.toISOString().slice(0, 7));
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return result;
}

function sumByMonth(rows: { date: string; spend: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.date.slice(0, 7); // YYYY-MM
    map.set(key, (map.get(key) ?? 0) + (row.spend ?? 0));
  }
  return map;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand    = searchParams.get("brand");
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo   = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: brandRow } = await supabase
    .from("brands")
    .select("id")
    .eq("slug", brand)
    .single();
  const brandId = (brandRow as { id: number } | null)?.id;
  if (!brandId) {
    return NextResponse.json({ error: `Brand '${brand}' not found` }, { status: 404 });
  }

  // Query from LY start to TY end so one query covers both windows
  const lyFrom = `${parseInt(dateFrom.slice(0, 4)) - 1}${dateFrom.slice(4)}`;

  const [metaRows, googleRows] = await Promise.all([
    fetchAll<{ date: string; spend: number }>(
      (off, lim) =>
        supabase
          .from("meta_campaigns_daily")
          .select("date,spend")
          .eq("brand_id", brandId)
          .gte("date", lyFrom)
          .lte("date", dateTo)
          .range(off, off + lim - 1),
      "meta_spend",
    ),
    fetchAll<{ date: string; spend: number }>(
      (off, lim) =>
        supabase
          .from("google_campaigns_daily")
          .select("date,spend")
          .eq("brand_id", brandId)
          .gte("date", lyFrom)
          .lte("date", dateTo)
          .range(off, off + lim - 1),
      "google_spend",
    ),
  ]);

  const metaByMonth   = sumByMonth(metaRows);
  const googleByMonth = sumByMonth(googleRows);

  const result: MonthlySpend[] = monthsInRange(dateFrom, dateTo).map((yyyyMM) => {
    const lyKey = priorYearKey(yyyyMM);
    return {
      month:    monthLabel(yyyyMM),
      metaTY:   Math.round((metaByMonth.get(yyyyMM)   ?? 0) * 100) / 100,
      metaLY:   Math.round((metaByMonth.get(lyKey)    ?? 0) * 100) / 100,
      googleTY: Math.round((googleByMonth.get(yyyyMM) ?? 0) * 100) / 100,
      googleLY: Math.round((googleByMonth.get(lyKey)  ?? 0) * 100) / 100,
    };
  });

  return NextResponse.json(result);
}
