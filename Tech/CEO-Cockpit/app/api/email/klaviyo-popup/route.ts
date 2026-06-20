import { NextRequest, NextResponse } from "next/server";

type BrandSlug = "spa" | "aesthetics" | "slimming";

const VALID_BRANDS = new Set<BrandSlug>(["spa", "aesthetics", "slimming"]);

const KLAVIYO_API_KEYS: Record<BrandSlug, string | undefined> = {
  spa:        process.env.KLAVIYO_API_KEY_SPA,
  aesthetics: process.env.KLAVIYO_API_KEY_AES,
  slimming:   process.env.KLAVIYO_API_KEY_SLIM,
};

const KLAVIYO_BASE     = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

function kHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization:  `Klaviyo-API-Key ${apiKey}`,
    revision:       KLAVIYO_REVISION,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };
}

async function kFetch(url: string, init: RequestInit, retries = 3): Promise<Response> {
  let res!: Response;
  for (let i = 0; i < retries; i++) {
    res = await fetch(url, init);
    if (res.status !== 429) return res;
    const after = parseInt(res.headers.get("Retry-After") ?? "2", 10);
    await new Promise((r) => setTimeout(r, Math.min(after * 1000, 8000)));
  }
  return res;
}

interface MetricAggrResult {
  data?: {
    attributes?: {
      dates?: string[];
      values?: number[][];
    };
  };
}

async function fetchMetricTotal(
  apiKey: string,
  metricId: string,
  from: string,
  to: string,
): Promise<number> {
  const body = JSON.stringify({
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: metricId,
        measurements: ["count"],
        interval: "month",
        page_size: 500,
        timezone: "UTC",
        filter: [
          `greater-or-equal(datetime,${from}T00:00:00+00:00)`,
          `less-or-equal(datetime,${to}T23:59:59+00:00)`,
        ],
      },
    },
  });

  const res = await kFetch(`${KLAVIYO_BASE}/metric-aggregates/`, {
    method: "POST",
    headers: kHeaders(apiKey),
    body,
  });

  if (!res.ok) return 0;
  const json: MetricAggrResult = await res.json();
  const values = json.data?.attributes?.values ?? [];
  return values.flat().reduce((s: number, v: number) => s + (v ?? 0), 0);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const from  = searchParams.get("from") ?? "2026-01-01";
  const to    = searchParams.get("to")   ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json({ error: "Invalid brand" }, { status: 400 });
  }

  const apiKey = KLAVIYO_API_KEYS[brand];
  if (!apiKey) {
    return NextResponse.json(
      { error: `Klaviyo API key not configured for ${brand}` },
      { status: 503 },
    );
  }

  try {
    // 1. Discover metric IDs — look for Viewed/Submitted Form events
    const metricsRes = await kFetch(
      `${KLAVIYO_BASE}/metrics/?fields[metric]=name`,
      { headers: kHeaders(apiKey) },
    );
    if (!metricsRes.ok) {
      return NextResponse.json({ error: `Klaviyo metrics list: ${metricsRes.status}` }, { status: 502 });
    }

    type MetricItem = { id: string; attributes?: { name?: string } };
    const metricsJson: { data?: MetricItem[] } = await metricsRes.json();
    const metrics = metricsJson.data ?? [];

    // Match by name — Klaviyo uses "Viewed Klaviyo Form" / "Submitted Klaviyo Form"
    const viewedMetric    = metrics.find((m) => /viewed.*form/i.test(m.attributes?.name ?? ""));
    const submittedMetric = metrics.find((m) => /submitted.*form/i.test(m.attributes?.name ?? ""));

    if (!viewedMetric || !submittedMetric) {
      // Form tracking not set up — return hasData: false gracefully
      return NextResponse.json({
        hasData:          false,
        viewedCount:      0,
        submittedCount:   0,
        captureRatePct:   null,
        viewedMetricId:   viewedMetric?.id   ?? null,
        submittedMetricId: submittedMetric?.id ?? null,
        note:             "Klaviyo popup form tracking not detected for this account.",
      });
    }

    // 2. Fetch aggregate counts for the date range
    const [viewedCount, submittedCount] = await Promise.all([
      fetchMetricTotal(apiKey, viewedMetric.id,    from, to),
      fetchMetricTotal(apiKey, submittedMetric.id, from, to),
    ]);

    const captureRatePct = viewedCount > 0
      ? Math.round((submittedCount / viewedCount) * 1000) / 10  // 1 decimal
      : null;

    return NextResponse.json({
      hasData:          true,
      viewedCount,
      submittedCount,
      captureRatePct,
      targetPct:        8,
      viewedMetricId:   viewedMetric.id,
      submittedMetricId: submittedMetric.id,
    }, {
      headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
