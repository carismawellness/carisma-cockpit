/**
 * GET /api/marketing/gsc-rankings?brand=spa[&days=28]
 *
 * Returns one row per tracked keyword for the brand:
 *   - keyword
 *   - clicks, impressions (summed over last `days` days)
 *   - ctr (overall: clicks / impressions)
 *   - position (impression-weighted average over the window)
 *   - positionPrev (same metric for the previous equal-length window)
 *   - positionChange (positionPrev - position; positive = improved)
 *   - trend: [{ date, position, clicks }, ...] daily series for the window
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { TRACKED_KEYWORDS, type BrandSlug } from "@/lib/constants/gsc-keywords";

export const maxDuration = 30;

const VALID: BrandSlug[] = ["spa", "aesthetics", "slimming"];
const BRAND_ID: Record<BrandSlug, number> = {
  spa: 1,
  aesthetics: 2,
  slimming: 3,
};

interface DailyRow {
  date: string;
  keyword: string;
  clicks: number;
  impressions: number;
  position: number | null;
}

interface AggregatedKeyword {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  positionPrev: number | null;
  positionChange: number | null;
  trend: { date: string; position: number | null; clicks: number }[];
  lastSeen: string | null;
}

function aggregate(rows: DailyRow[]): {
  totalClicks: number;
  totalImpressions: number;
  position: number | null;
} {
  let totalClicks = 0;
  let totalImpressions = 0;
  let weighted = 0;
  let weight = 0;
  for (const r of rows) {
    totalClicks += r.clicks ?? 0;
    totalImpressions += r.impressions ?? 0;
    if (r.position !== null && (r.impressions ?? 0) > 0) {
      weighted += Number(r.position) * Number(r.impressions);
      weight += Number(r.impressions);
    }
  }
  return {
    totalClicks,
    totalImpressions,
    position: weight > 0 ? weighted / weight : null,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const days = Math.max(1, Math.min(180, parseInt(searchParams.get("days") ?? "28", 10) || 28));

  if (!brand || !VALID.includes(brand)) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
  }

  // current window: ending today, days long
  // previous window: same length immediately before current
  const today = new Date();
  const endIso = today.toISOString().slice(0, 10);
  const startCur = new Date(today);
  startCur.setDate(startCur.getDate() - (days - 1));
  const startCurIso = startCur.toISOString().slice(0, 10);
  const endPrev = new Date(startCur);
  endPrev.setDate(endPrev.getDate() - 1);
  const endPrevIso = endPrev.toISOString().slice(0, 10);
  const startPrev = new Date(endPrev);
  startPrev.setDate(startPrev.getDate() - (days - 1));
  const startPrevIso = startPrev.toISOString().slice(0, 10);

  const supabase = getAdminClient();

  // Pull both windows in one query for efficiency
  const { data, error } = await supabase
    .from("gsc_keyword_daily")
    .select("date,keyword,clicks,impressions,position")
    .eq("brand_id", BRAND_ID[brand])
    .gte("date", startPrevIso)
    .lte("date", endIso)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message, keywords: [] }, { status: 500 });
  }
  const rows = (data ?? []) as DailyRow[];

  const tracked = TRACKED_KEYWORDS[brand].map((k) => k.toLowerCase());
  const byKeyword = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const k = r.keyword.toLowerCase();
    if (!byKeyword.has(k)) byKeyword.set(k, []);
    byKeyword.get(k)!.push(r);
  }

  const result: AggregatedKeyword[] = tracked.map((kw) => {
    const all = byKeyword.get(kw) ?? [];
    const current = all.filter((r) => r.date >= startCurIso && r.date <= endIso);
    const previous = all.filter((r) => r.date >= startPrevIso && r.date <= endPrevIso);
    const curAgg = aggregate(current);
    const prevAgg = aggregate(previous);
    const lastSeen = all.length > 0 ? all[all.length - 1].date : null;

    return {
      keyword: kw,
      clicks: curAgg.totalClicks,
      impressions: curAgg.totalImpressions,
      ctr:
        curAgg.totalImpressions > 0
          ? curAgg.totalClicks / curAgg.totalImpressions
          : null,
      position: curAgg.position,
      positionPrev: prevAgg.position,
      positionChange:
        curAgg.position !== null && prevAgg.position !== null
          ? prevAgg.position - curAgg.position
          : null,
      trend: current.map((r) => ({
        date: r.date,
        position: r.position !== null ? Number(r.position) : null,
        clicks: r.clicks ?? 0,
      })),
      lastSeen,
    };
  });

  return NextResponse.json({
    brand,
    window: { startDate: startCurIso, endDate: endIso, days },
    keywords: result,
  });
}
