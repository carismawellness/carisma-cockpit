import { NextRequest, NextResponse } from "next/server";
import type {
  KlaviyoApiResponse,
  KlaviyoCampaignData,
  KlaviyoFlowData,
  KlaviyoOverview,
} from "@/lib/types/klaviyo";

export const maxDuration = 300;

type BrandSlug = "spa" | "aesthetics" | "slimming";

const VALID_BRANDS = new Set<string>(["spa", "aesthetics", "slimming"]);

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

const emptyOverview: KlaviyoOverview = {
  totalSubscribers: 0,
  overallOpenRate: 0,
  overallClickRate: 0,
  overallUnsubscribeRate: 0,
  overallBounceRate: 0,
  totalRecipients: 0,
  totalDelivered: 0,
  totalCampaignsSent: 0,
  totalActiveFlows: 0,
};

const emptyResponse: KlaviyoApiResponse = {
  campaigns: [],
  flows: [],
  overview: emptyOverview,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Discover any metric ID to satisfy conversion_metric_id requirement.
 *  Prefers "Placed Order" but falls back to first available metric. */
async function discoverConversionMetricId(
  apiKey: string,
): Promise<string | null> {
  try {
    const url = new URL(`${KLAVIYO_BASE}/metrics/`);
    url.searchParams.set("fields[metric]", "name");

    const res = await fetchWithRetry(url.toString(), {
      headers: headers(apiKey),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const metrics = json?.data ?? [];

    // Prefer "Placed Order"
    const placedOrder = metrics.find(
      (m: { attributes?: { name?: string } }) =>
        m.attributes?.name === "Placed Order",
    );
    if (placedOrder?.id) return placedOrder.id;

    // Fallback to first metric
    return metrics[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Build the POST body for campaign-values-reports or flow-values-reports */
function reportBody(
  type: "campaign-values-report" | "flow-values-report",
  from: string,
  to: string,
  conversionMetricId: string,
) {
  return {
    data: {
      type,
      attributes: {
        statistics: [
          "recipients",
          "delivered",
          "open_rate",
          "click_rate",
          "unsubscribe_rate",
          "bounce_rate",
          "clicks",
          "clicks_unique",
          "opens_unique",
        ],
        // custom_timeframe resource accepts { start, end } — no `key` field
        timeframe: {
          start: `${from}T00:00:00+00:00`,
          end: `${to}T23:59:59+00:00`,
        },
        conversion_metric_id: conversionMetricId,
        filter: 'equals(send_channel,"email")',
      },
    },
  };
}

/** Sleep helper for rate-limit backoff */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with automatic 429 retry — respects Retry-After header */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    res = await fetch(url, init);
    if (res.status !== 429) return res;
    // Parse Retry-After header or extract seconds from error body
    const retryAfter = res.headers.get("Retry-After");
    let waitMs = Math.min(1500 * (attempt + 1), 8000); // exponential, capped
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs)) waitMs = Math.min(secs * 1000, 8000);
    }
    await sleep(waitMs);
  }
  return res!;
}

/** Fetch a report endpoint with retry and fallback */
async function fetchReport(
  apiKey: string,
  endpoint: string,
  type: "campaign-values-report" | "flow-values-report",
  from: string,
  to: string,
  conversionMetricId: string | null,
): Promise<{ results: Record<string, unknown>[]; error?: string }> {
  if (!conversionMetricId) {
    return { results: [], error: `${endpoint}: no conversion metric found` };
  }

  const hdrs = headers(apiKey);

  // First attempt — custom date range
  const body = reportBody(type, from, to, conversionMetricId);
  let res = await fetchWithRetry(`${KLAVIYO_BASE}/${endpoint}/`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  });

  // If custom timeframe fails, try "this_year" as fallback
  if (!res.ok) {
    await sleep(1000);
    const fallbackBody = {
      data: {
        type,
        attributes: {
          statistics: [
            "recipients",
            "delivered",
            "open_rate",
            "click_rate",
            "unsubscribe_rate",
            "bounce_rate",
            "clicks",
            "clicks_unique",
            "opens_unique",
          ],
          timeframe: { key: "this_year" },
          conversion_metric_id: conversionMetricId,
          filter: 'equals(send_channel,"email")',
        },
      },
    };
    res = await fetchWithRetry(`${KLAVIYO_BASE}/${endpoint}/`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(fallbackBody),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    return { results: [], error: `${endpoint} failed (${res.status}): ${errText}` };
  }

  const json = await res.json();
  const results = json?.data?.attributes?.results ?? [];
  return { results };
}

/** Fetch all sent campaigns with pagination */
async function fetchCampaigns(apiKey: string): Promise<Record<string, unknown>[]> {
  const hdrs = headers(apiKey);
  const allCampaigns: Record<string, unknown>[] = [];
  let url: string | null =
    `${KLAVIYO_BASE}/campaigns/?filter=equals(messages.channel,'email'),equals(status,'Sent')&fields[campaign]=name,status,send_strategy,created_at`;

  while (url) {
    const res: Response = await fetch(url, { headers: hdrs, next: { revalidate: 300 } });
    if (!res.ok) break;
    const json: Record<string, unknown> = await res.json();
    if (json?.data) allCampaigns.push(...(json.data as Record<string, unknown>[]));
    url = (json?.links as Record<string, string> | undefined)?.next ?? null;
  }

  return allCampaigns;
}

/** Fetch subscriber count by summing per-list profile_count.
 *
 * Klaviyo's /lists/ collection endpoint does NOT expose profile_count as a
 * sparse field. The count is only available on the single-list endpoint via
 * `additional-fields[list]=profile_count`. So we list all lists, then issue
 * one GET per list, with delays to stay under the 75/sec, 750/min limit.
 *
 * Returns the sum (may double-count contacts in multiple lists; treat as
 * "reach" rather than "unique subscribers"). */
async function fetchSubscriberCount(apiKey: string): Promise<number> {
  const hdrs = headers(apiKey);
  try {
    const listsRes = await fetch(`${KLAVIYO_BASE}/lists/`, {
      headers: hdrs,
      next: { revalidate: 300 },
    });
    if (!listsRes.ok) return 0;
    const listsJson = (await listsRes.json()) as { data?: { id: string }[] };
    const lists = listsJson?.data ?? [];

    let total = 0;
    for (const list of lists) {
      const url = `${KLAVIYO_BASE}/lists/${list.id}/?additional-fields%5Blist%5D=profile_count`;
      const r = await fetchWithRetry(url, { headers: hdrs });
      if (!r.ok) {
        if (r.status === 429) break;
        continue;
      }
      const j = (await r.json()) as {
        data?: { attributes?: { profile_count?: number } };
      };
      total += j?.data?.attributes?.profile_count ?? 0;
      await sleep(250);
    }
    return total;
  } catch {
    return 0;
  }
}

/** Fetch all flows */
async function fetchFlows(apiKey: string): Promise<Record<string, unknown>[]> {
  const hdrs = headers(apiKey);
  const allFlows: Record<string, unknown>[] = [];
  let url: string | null =
    `${KLAVIYO_BASE}/flows/?fields[flow]=name,status,trigger_type`;

  while (url) {
    const res: Response = await fetch(url, { headers: hdrs, next: { revalidate: 300 } });
    if (!res.ok) break;
    const json: Record<string, unknown> = await res.json();
    if (json?.data) allFlows.push(...(json.data as Record<string, unknown>[]));
    url = (json?.links as Record<string, string> | undefined)?.next ?? null;
  }

  return allFlows;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brand = searchParams.get("brand") as BrandSlug | null;
  const dateFrom = searchParams.get("from") ?? "2026-01-01";
  const dateTo =
    searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  if (!brand || !VALID_BRANDS.has(brand)) {
    return NextResponse.json(
      { ...emptyResponse, error: "Invalid brand" },
      { status: 400 },
    );
  }

  const apiKey = KLAVIYO_API_KEYS[brand];
  if (!apiKey) {
    return NextResponse.json(
      {
        ...emptyResponse,
        error: `Klaviyo API key not configured for ${brand}`,
        tokenMissing: true,
      } satisfies KlaviyoApiResponse,
      { status: 500 },
    );
  }

  try {
    // Discover conversion metric ID first (required for report endpoints)
    const conversionMetricId = await discoverConversionMetricId(apiKey);

    await sleep(1000);

    // Fetch metadata in parallel
    const [rawCampaigns, rawFlows, subscriberCount] = await Promise.all([
      fetchCampaigns(apiKey),
      fetchFlows(apiKey),
      fetchSubscriberCount(apiKey),
    ]);

    // Delay before report calls
    await sleep(1200);

    // Now fetch the reporting data (POST endpoints — can't use next.revalidate)
    // Run sequentially to avoid hitting rate limits
    const campaignReport = await fetchReport(
      apiKey,
      "campaign-values-reports",
      "campaign-values-report",
      dateFrom,
      dateTo,
      conversionMetricId,
    );

    await sleep(1000);

    const flowReport = await fetchReport(
      apiKey,
      "flow-values-reports",
      "flow-values-report",
      dateFrom,
      dateTo,
      conversionMetricId,
    );

    // -----------------------------------------------------------------------
    // Build campaign data — match report results to campaign metadata
    // -----------------------------------------------------------------------

    // Build a map of campaign id → metadata
    const campaignMetaMap = new Map<string, { name: string; sentDate: string }>();
    for (const c of rawCampaigns) {
      const id = (c as { id: string }).id;
      const attrs = c as { attributes?: { name?: string; send_strategy?: { datetime?: string }; created_at?: string } };
      const sentDate =
        attrs.attributes?.send_strategy?.datetime ??
        attrs.attributes?.created_at ??
        "";
      campaignMetaMap.set(id, {
        name: attrs.attributes?.name ?? "Unknown Campaign",
        sentDate,
      });
    }

    // Filter campaigns by date range
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    toDate.setHours(23, 59, 59, 999);

    const filteredCampaignIds = new Set<string>();
    for (const [id, meta] of campaignMetaMap) {
      if (!meta.sentDate) {
        filteredCampaignIds.add(id); // Include if no date (can't filter)
        continue;
      }
      const sent = new Date(meta.sentDate);
      if (sent >= fromDate && sent <= toDate) {
        filteredCampaignIds.add(id);
      }
    }

    // Map report results to campaign data
    // Klaviyo report format: { groupings: { campaign_id }, statistics: { ... }, campaign_details: { id, attributes: { name } } }
    const campaigns: KlaviyoCampaignData[] = [];
    for (const result of campaignReport.results) {
      const r = result as {
        groupings?: { campaign_id?: string };
        statistics?: Record<string, number>;
        campaign_details?: {
          id?: string;
          attributes?: { name?: string; send_time?: string };
        };
      };
      const id = r.groupings?.campaign_id ?? r.campaign_details?.id ?? "";
      // Only include campaigns in date range
      if (id && !filteredCampaignIds.has(id)) continue;

      const meta = campaignMetaMap.get(id);
      const stats = r.statistics ?? {};

      campaigns.push({
        id,
        name: r.campaign_details?.attributes?.name ?? meta?.name ?? "Unknown Campaign",
        sentDate: meta?.sentDate ?? r.campaign_details?.attributes?.send_time ?? "",
        recipients: Number(stats.recipients ?? 0),
        delivered: Number(stats.delivered ?? 0),
        openRate: Number(stats.open_rate ?? 0),
        clickRate: Number(stats.click_rate ?? 0),
        unsubscribeRate: Number(stats.unsubscribe_rate ?? 0),
        bounceRate: Number(stats.bounce_rate ?? 0),
        clicks: Number(stats.clicks ?? 0),
        opensUnique: Number(stats.opens_unique ?? 0),
      });
    }

    // -----------------------------------------------------------------------
    // Build flow data — aggregate by flow_id
    // -----------------------------------------------------------------------

    // Build flow metadata map
    const flowMetaMap = new Map<
      string,
      { name: string; status: string; triggerType: string }
    >();
    for (const f of rawFlows) {
      const flow = f as {
        id: string;
        attributes?: { name?: string; status?: string; trigger_type?: string };
      };
      flowMetaMap.set(flow.id, {
        name: flow.attributes?.name ?? "Unknown Flow",
        status: flow.attributes?.status ?? "unknown",
        triggerType: flow.attributes?.trigger_type ?? "unknown",
      });
    }

    // Aggregate flow report results by flow_id
    const flowAggMap = new Map<
      string,
      {
        recipients: number;
        delivered: number;
        clicks: number;
        opensUnique: number;
        openRateWeighted: number;
        clickRateWeighted: number;
        unsubRateWeighted: number;
        bounceRateWeighted: number;
      }
    >();

    for (const result of flowReport.results) {
      // Klaviyo flow report format: { groupings: { flow_id }, statistics: { ... }, flow_details: { id, attributes: { name } } }
      const r = result as {
        groupings?: { flow_id?: string };
        statistics?: Record<string, number>;
        flow_details?: { id?: string; attributes?: { name?: string; status?: string; trigger_type?: string } } | null;
      };
      const flowId = r.groupings?.flow_id ?? r.flow_details?.id ?? "unknown";
      const stats = r.statistics ?? {};

      const recipients = Number(stats.recipients ?? 0);
      const delivered = Number(stats.delivered ?? 0);

      const existing = flowAggMap.get(flowId);
      if (existing) {
        existing.recipients += recipients;
        existing.delivered += delivered;
        existing.clicks += Number(stats.clicks ?? 0);
        existing.opensUnique += Number(stats.opens_unique ?? 0);
        existing.openRateWeighted += Number(stats.open_rate ?? 0) * delivered;
        existing.clickRateWeighted += Number(stats.click_rate ?? 0) * delivered;
        existing.unsubRateWeighted += Number(stats.unsubscribe_rate ?? 0) * delivered;
        existing.bounceRateWeighted += Number(stats.bounce_rate ?? 0) * recipients;
      } else {
        flowAggMap.set(flowId, {
          recipients,
          delivered,
          clicks: Number(stats.clicks ?? 0),
          opensUnique: Number(stats.opens_unique ?? 0),
          openRateWeighted: Number(stats.open_rate ?? 0) * delivered,
          clickRateWeighted: Number(stats.click_rate ?? 0) * delivered,
          unsubRateWeighted: Number(stats.unsubscribe_rate ?? 0) * delivered,
          bounceRateWeighted: Number(stats.bounce_rate ?? 0) * recipients,
        });
      }
    }

    const flows: KlaviyoFlowData[] = [];
    for (const [flowId, agg] of flowAggMap) {
      const meta = flowMetaMap.get(flowId);
      flows.push({
        id: flowId,
        name: meta?.name ?? "Unknown Flow",
        status: meta?.status ?? "unknown",
        triggerType: meta?.triggerType ?? "unknown",
        recipients: agg.recipients,
        delivered: agg.delivered,
        openRate: agg.delivered > 0 ? agg.openRateWeighted / agg.delivered : 0,
        clickRate:
          agg.delivered > 0 ? agg.clickRateWeighted / agg.delivered : 0,
        unsubscribeRate:
          agg.delivered > 0 ? agg.unsubRateWeighted / agg.delivered : 0,
        bounceRate:
          agg.recipients > 0 ? agg.bounceRateWeighted / agg.recipients : 0,
        clicks: agg.clicks,
        opensUnique: agg.opensUnique,
      });
    }

    // -----------------------------------------------------------------------
    // Calculate overview with weighted averages
    // -----------------------------------------------------------------------

    let totalRecipients = 0;
    let totalDelivered = 0;
    let weightedOpenRate = 0;
    let weightedClickRate = 0;
    let weightedUnsubRate = 0;
    let weightedBounceRate = 0;

    const allItems = [...campaigns, ...flows];
    for (const item of allItems) {
      totalRecipients += item.recipients;
      totalDelivered += item.delivered;
      weightedOpenRate += item.openRate * item.delivered;
      weightedClickRate += item.clickRate * item.delivered;
      weightedUnsubRate += item.unsubscribeRate * item.delivered;
      weightedBounceRate += item.bounceRate * item.recipients;
    }

    const activeFlows = rawFlows.filter(
      (f) =>
        (f as { attributes?: { status?: string } }).attributes?.status ===
        "live",
    ).length;

    const overview: KlaviyoOverview = {
      totalSubscribers: subscriberCount,
      overallOpenRate:
        totalDelivered > 0 ? weightedOpenRate / totalDelivered : 0,
      overallClickRate:
        totalDelivered > 0 ? weightedClickRate / totalDelivered : 0,
      overallUnsubscribeRate:
        totalDelivered > 0 ? weightedUnsubRate / totalDelivered : 0,
      overallBounceRate:
        totalRecipients > 0 ? weightedBounceRate / totalRecipients : 0,
      totalRecipients,
      totalDelivered,
      totalCampaignsSent: campaigns.length,
      totalActiveFlows: activeFlows,
    };

    const response: KlaviyoApiResponse = { campaigns, flows, overview };

    // Append any partial errors as warnings
    const warnings: string[] = [];
    if (campaignReport.error) warnings.push(campaignReport.error);
    if (flowReport.error) warnings.push(flowReport.error);
    if (warnings.length > 0) {
      response.error = warnings.join("; ");
    }

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      {
        ...emptyResponse,
        error: err instanceof Error ? err.message : "Unknown error",
      } satisfies KlaviyoApiResponse,
      { status: 500 },
    );
  }
}
