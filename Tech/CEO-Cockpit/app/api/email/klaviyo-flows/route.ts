/**
 * Klaviyo flows API — live, focused only on per-flow metrics for a date range.
 *
 * Lighter than /api/email/klaviyo: skips campaigns + subscriber count, only
 * issues flows + flow-values-report. Used by the FlowsTable component on each
 * brand marketing dashboard.
 */
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

type BrandSlug = "spa" | "aesthetics" | "slimming";
const VALID_BRANDS = new Set<BrandSlug>(["spa", "aesthetics", "slimming"]);

const KLAVIYO_API_KEYS: Record<BrandSlug, string | undefined> = {
  spa: process.env.KLAVIYO_API_KEY_SPA,
  aesthetics: process.env.KLAVIYO_API_KEY_AES,
  slimming: process.env.KLAVIYO_API_KEY_SLIM,
};

const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const after = res.headers.get("Retry-After");
    const waitMs = after
      ? Math.min(parseInt(after, 10) * 1000, 30000)
      : 1000 * (attempt + 1);
    await sleep(waitMs);
  }
  return fetch(url, init);
}

async function discoverConversionMetricId(apiKey: string): Promise<string | null> {
  try {
    const url = new URL(`${KLAVIYO_BASE}/metrics/`);
    url.searchParams.set("fields[metric]", "name");
    const res = await fetchWithRetry(url.toString(), { headers: headers(apiKey) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { id: string; attributes?: { name?: string } }[];
    };
    const metrics = json.data ?? [];
    const placed = metrics.find((m) => m.attributes?.name === "Placed Order");
    return placed?.id ?? metrics[0]?.id ?? null;
  } catch {
    return null;
  }
}

export interface FlowRow {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  recipients: number;
  delivered: number;
  openRate: number; // 0-1
  clickRate: number; // 0-1
  unsubscribeRate: number; // 0-1
  bounceRate: number; // 0-1
  clicks: number;
  opensUnique: number;
}

export interface KlaviyoFlowsResponse {
  flows: FlowRow[];
  tokenMissing?: boolean;
  error?: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo =
    searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json(
      { flows: [], error: "Invalid brand" },
      { status: 400 },
    );
  }

  const apiKey = KLAVIYO_API_KEYS[brand];
  if (!apiKey) {
    return NextResponse.json(
      { flows: [], tokenMissing: true, error: "API key not configured" },
      { status: 500 },
    );
  }

  try {
    // 1. Get flow metadata (names + statuses)
    const flowsRes = await fetchWithRetry(
      `${KLAVIYO_BASE}/flows/?fields[flow]=name,status,trigger_type`,
      { headers: headers(apiKey) },
    );
    if (!flowsRes.ok) {
      return NextResponse.json({ flows: [], error: `flows fetch ${flowsRes.status}` });
    }
    const flowsJson = (await flowsRes.json()) as {
      data?: {
        id: string;
        attributes?: { name?: string; status?: string; trigger_type?: string };
      }[];
    };
    const flowMeta = new Map<string, { name: string; status: string; triggerType: string }>();
    for (const f of flowsJson.data ?? []) {
      flowMeta.set(f.id, {
        name: f.attributes?.name ?? "Unknown Flow",
        status: f.attributes?.status ?? "unknown",
        triggerType: f.attributes?.trigger_type ?? "unknown",
      });
    }

    // 2. Run flow-values-report
    const conversionMetricId = await discoverConversionMetricId(apiKey);
    if (!conversionMetricId) {
      return NextResponse.json({ flows: [], error: "no conversion metric" });
    }
    await sleep(800);

    const body = {
      data: {
        type: "flow-values-report",
        attributes: {
          statistics: [
            "recipients", "delivered", "open_rate", "click_rate",
            "unsubscribe_rate", "bounce_rate", "clicks", "opens_unique",
          ],
          timeframe: {
            key: "custom",
            start: `${dateFrom}T00:00:00+00:00`,
            end: `${dateTo}T23:59:59+00:00`,
          },
          conversion_metric_id: conversionMetricId,
        },
      },
    };
    const reportRes = await fetchWithRetry(
      `${KLAVIYO_BASE}/flow-values-reports/`,
      { method: "POST", headers: headers(apiKey), body: JSON.stringify(body) },
    );
    if (!reportRes.ok) {
      return NextResponse.json({
        flows: [],
        error: `flow-values-report ${reportRes.status}`,
      });
    }
    const reportJson = (await reportRes.json()) as {
      data?: { attributes?: { results?: Record<string, unknown>[] } };
    };
    const results = reportJson.data?.attributes?.results ?? [];

    // 3. Aggregate by flow_id (Klaviyo can return multiple rows per flow grouping)
    const agg = new Map<
      string,
      {
        recipients: number; delivered: number; clicks: number; opensUnique: number;
        openWeighted: number; clickWeighted: number; unsubWeighted: number; bounceWeighted: number;
      }
    >();
    for (const result of results) {
      const r = result as {
        groupings?: { flow_id?: string };
        statistics?: Record<string, number>;
      };
      const id = r.groupings?.flow_id ?? "unknown";
      const s = r.statistics ?? {};
      const recipients = Number(s.recipients ?? 0);
      const delivered = Number(s.delivered ?? 0);
      const existing = agg.get(id);
      if (existing) {
        existing.recipients += recipients;
        existing.delivered += delivered;
        existing.clicks += Number(s.clicks ?? 0);
        existing.opensUnique += Number(s.opens_unique ?? 0);
        existing.openWeighted += Number(s.open_rate ?? 0) * delivered;
        existing.clickWeighted += Number(s.click_rate ?? 0) * delivered;
        existing.unsubWeighted += Number(s.unsubscribe_rate ?? 0) * delivered;
        existing.bounceWeighted += Number(s.bounce_rate ?? 0) * recipients;
      } else {
        agg.set(id, {
          recipients, delivered,
          clicks: Number(s.clicks ?? 0),
          opensUnique: Number(s.opens_unique ?? 0),
          openWeighted: Number(s.open_rate ?? 0) * delivered,
          clickWeighted: Number(s.click_rate ?? 0) * delivered,
          unsubWeighted: Number(s.unsubscribe_rate ?? 0) * delivered,
          bounceWeighted: Number(s.bounce_rate ?? 0) * recipients,
        });
      }
    }

    const flows: FlowRow[] = [];
    for (const [id, a] of agg) {
      const meta = flowMeta.get(id);
      flows.push({
        id,
        name: meta?.name ?? "Unknown Flow",
        status: meta?.status ?? "unknown",
        triggerType: meta?.triggerType ?? "unknown",
        recipients: a.recipients,
        delivered: a.delivered,
        openRate: a.delivered > 0 ? a.openWeighted / a.delivered : 0,
        clickRate: a.delivered > 0 ? a.clickWeighted / a.delivered : 0,
        unsubscribeRate: a.delivered > 0 ? a.unsubWeighted / a.delivered : 0,
        bounceRate: a.recipients > 0 ? a.bounceWeighted / a.recipients : 0,
        clicks: a.clicks,
        opensUnique: a.opensUnique,
      });
    }
    flows.sort((x, y) => y.recipients - x.recipients);

    return NextResponse.json({ flows });
  } catch (err) {
    return NextResponse.json({
      flows: [],
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
