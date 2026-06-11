/**
 * GET /api/marketing/gsc-rankings?brand=spa&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns one row per tracked keyword over the requested window:
 *   - keyword
 *   - clicks, impressions (summed over the window)
 *   - ctr (overall: clicks / impressions)
 *   - position (impression-weighted average over the window)
 *   - positionPrev (same metric for the immediately-preceding equal-length window)
 *   - positionChange (positionPrev - position; positive = improved rank)
 *   - trend: [{ date, position, clicks }, ...] daily series within the window
 *
 * Backwards-compat: if `from`/`to` are missing, falls back to last `days` days
 * (defaults to 28). The parent dashboard's date filter is the source of truth.
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

function dayDiff(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400_000) + 1;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const daysParam = searchParams.get("days");

  if (!brand || !VALID.includes(brand)) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
  }

  // Resolve current window
  let startCurIso: string;
  let endCurIso: string;
  if (fromParam && toParam) {
    startCurIso = fromParam;
    endCurIso = toParam;
  } else {
    const days = Math.max(1, Math.min(365, parseInt(daysParam ?? "28", 10) || 28));
    const today = new Date();
    endCurIso = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    startCurIso = start.toISOString().slice(0, 10);
  }

  const days = dayDiff(startCurIso, endCurIso);
  const endPrevIso = addDays(startCurIso, -1);
  const startPrevIso = addDays(endPrevIso, -(days - 1));

  const supabase = getAdminClient();

  // Pull both windows in one query for efficiency
  const { data, error } = await supabase
    .from("gsc_keyword_daily")
    .select("date,keyword,clicks,impressions,position")
    .eq("brand_id", BRAND_ID[brand])
    .gte("date", startPrevIso)
    .lte("date", endCurIso)
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
    const current = all.filter((r) => r.date >= startCurIso && r.date <= endCurIso);
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
    window: { startDate: startCurIso, endDate: endCurIso, days },
    keywords: result,
  });
}
