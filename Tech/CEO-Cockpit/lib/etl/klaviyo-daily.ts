/**
 * Klaviyo daily aggregate ETL
 *
 * Persists daily email health metrics to klaviyo_daily:
 *   - subscriber counts (via profiles API)
 *   - active flow count
 *   - campaign aggregate rates (open, click, unsubscribe, bounce)
 *
 * Env vars required:
 *   KLAVIYO_API_KEY_SPA
 *   KLAVIYO_API_KEY_AES
 *   KLAVIYO_API_KEY_SLIM
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { upsert, selectRaw } from "@/lib/etl/supabase-etl";

const KLAVIYO_BASE     = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

const KLAVIYO_API_KEYS: Record<string, string | undefined> = {
  spa:        process.env.KLAVIYO_API_KEY_SPA,
  aesthetics: process.env.KLAVIYO_API_KEY_AES,
  slimming:   process.env.KLAVIYO_API_KEY_SLIM,
};

const BRAND_SLUGS = ["spa", "aesthetics", "slimming"] as const;
type BrandSlug = typeof BRAND_SLUGS[number];

function klaviyoHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization:  `Klaviyo-API-Key ${apiKey}`,
    revision:       KLAVIYO_REVISION,
    "Content-Type": "application/json",
    Accept:         "application/json",
  };
}

function sleep(ms: number): Promise<void> {
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
    const waitMs = after ? Math.min(parseInt(after, 10) * 1000, 60000) : 1000 * (attempt + 1);
    await sleep(waitMs);
  }
  throw new Error("Klaviyo rate limit exceeded after max retries");
}

async function getBrandId(slug: string): Promise<string> {
  const rows = await selectRaw("brands", { slug: `eq.${slug}`, select: "id" });
  if (!rows.length) throw new Error(`Brand not found: ${slug}`);
  return rows[0].id as string;
}

/** Get total subscriber count via profiles endpoint */
async function fetchSubscriberCount(apiKey: string): Promise<number> {
  try {
    // Fetch lists with profile_count field
    const res = await fetchWithRetry(
      `${KLAVIYO_BASE}/lists/?fields[list]=name,profile_count`,
      { headers: klaviyoHeaders(apiKey) },
    );
    if (!res.ok) return 0;

    const json = await res.json() as { data?: { attributes?: { profile_count?: number } }[] };
    const lists = json.data ?? [];

    // Sum profile_count across all lists (may double-count contacts in multiple lists)
    // Use the largest single list as a proxy if sums seem unreliable
    let sum = 0;
    for (const list of lists) {
      sum += list.attributes?.profile_count ?? 0;
    }
    return sum;
  } catch {
    return 0;
  }
}

/** Count active (live) flows */
async function fetchActiveFlowCount(apiKey: string): Promise<number> {
  try {
    const res = await fetchWithRetry(
      `${KLAVIYO_BASE}/flows/?filter=equals(status,'live')&fields[flow]=status`,
      { headers: klaviyoHeaders(apiKey) },
    );
    if (!res.ok) return 0;
    const json = await res.json() as { data?: unknown[] };
    return json.data?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Discover conversion metric ID (required for report endpoints) */
async function discoverConversionMetricId(apiKey: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(
      `${KLAVIYO_BASE}/metrics/?fields[metric]=name`,
      { headers: klaviyoHeaders(apiKey) },
    );
    if (!res.ok) return null;
    const json = await res.json() as { data?: { id: string; attributes?: { name?: string } }[] };
    const metrics = json.data ?? [];
    const placed = metrics.find((m) => m.attributes?.name === "Placed Order");
    return placed?.id ?? metrics[0]?.id ?? null;
  } catch {
    return null;
  }
}

interface CampaignAggregates {
  campaigns_sent:        number;
  total_recipients:      number;
  total_delivered:       number;
  open_rate_pct:         number | null;
  click_rate_pct:        number | null;
  unsubscribe_rate_pct:  number | null;
  bounce_rate_pct:       number | null;
}

/** Fetch campaign aggregate metrics for a date range */
async function fetchCampaignAggregates(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
): Promise<CampaignAggregates> {
  const empty: CampaignAggregates = {
    campaigns_sent: 0,
    total_recipients: 0,
    total_delivered: 0,
    open_rate_pct: null,
    click_rate_pct: null,
    unsubscribe_rate_pct: null,
    bounce_rate_pct: null,
  };

  const conversionMetricId = await discoverConversionMetricId(apiKey);
  if (!conversionMetricId) return empty;

  await sleep(1000);

  const body = {
    data: {
      type: "campaign-values-report",
      attributes: {
        statistics: [
          "recipients", "delivered", "open_rate", "click_rate",
          "unsubscribe_rate", "bounce_rate",
        ],
        timeframe: {
          key:   "custom",
          start: `${dateFrom}T00:00:00+00:00`,
          end:   `${dateTo}T23:59:59+00:00`,
        },
        conversion_metric_id: conversionMetricId,
        filter: 'equals(send_channel,"email")',
      },
    },
  };

  const res = await fetchWithRetry(
    `${KLAVIYO_BASE}/campaign-values-reports/`,
    { method: "POST", headers: klaviyoHeaders(apiKey), body: JSON.stringify(body) },
  );

  if (!res.ok) return empty;

  const json = await res.json() as {
    data?: { attributes?: { results?: Record<string, number>[] } };
  };
  const results = json.data?.attributes?.results ?? [];

  let totalRecipients = 0;
  let totalDelivered  = 0;
  let weightedOpen    = 0;
  let weightedClick   = 0;
  let weightedUnsub   = 0;
  let weightedBounce  = 0;

  for (const r of results) {
    const recipients = r.recipients ?? 0;
    const delivered  = r.delivered  ?? 0;
    totalRecipients += recipients;
    totalDelivered  += delivered;
    weightedOpen    += (r.open_rate         ?? 0) * delivered;
    weightedClick   += (r.click_rate        ?? 0) * delivered;
    weightedUnsub   += (r.unsubscribe_rate  ?? 0) * delivered;
    weightedBounce  += (r.bounce_rate       ?? 0) * recipients;
  }

  return {
    campaigns_sent:       results.length,
    total_recipients:     totalRecipients,
    total_delivered:      totalDelivered,
    open_rate_pct:        totalDelivered > 0 ? Math.round((weightedOpen   / totalDelivered) * 100 * 10000) / 10000 : null,
    click_rate_pct:       totalDelivered > 0 ? Math.round((weightedClick  / totalDelivered) * 100 * 10000) / 10000 : null,
    unsubscribe_rate_pct: totalDelivered > 0 ? Math.round((weightedUnsub  / totalDelivered) * 100 * 10000) / 10000 : null,
    bounce_rate_pct:      totalRecipients > 0 ? Math.round((weightedBounce / totalRecipients) * 100 * 10000) / 10000 : null,
  };
}

export interface KlaviyoDailyEtlResult {
  rows_upserted: number;
  log: string;
}

export async function runKlaviyoDailyEtl(opts: {
  date:      string;   // YYYY-MM-DD — the day to snapshot
  brandSlug?: BrandSlug;
}): Promise<KlaviyoDailyEtlResult> {
  const { date, brandSlug } = opts;

  const brandsToProcess = brandSlug
    ? [brandSlug]
    : (BRAND_SLUGS as readonly string[]) as BrandSlug[];

  const log: string[] = [];
  let totalUpserted = 0;

  for (const slug of brandsToProcess) {
    const apiKey = KLAVIYO_API_KEYS[slug];
    if (!apiKey) {
      log.push(`[${slug}] KLAVIYO_API_KEY_${slug === "aesthetics" ? "AES" : slug.toUpperCase()} not set — skipped`);
      continue;
    }

    try {
      const brandId = await getBrandId(slug);

      log.push(`[${slug}] fetching Klaviyo data for ${date}`);

      const [subscriberCount, activeFlows, aggregates] = await Promise.all([
        fetchSubscriberCount(apiKey),
        fetchActiveFlowCount(apiKey),
        fetchCampaignAggregates(apiKey, date, date),
      ]);

      const row: Record<string, unknown> = {
        date,
        brand_id:              brandId,
        total_subscribers:     subscriberCount,
        active_subscribers:    subscriberCount, // same — Klaviyo doesn't distinguish easily
        campaigns_sent:        aggregates.campaigns_sent,
        active_flows:          activeFlows,
        total_recipients:      aggregates.total_recipients,
        total_delivered:       aggregates.total_delivered,
        open_rate_pct:         aggregates.open_rate_pct,
        click_rate_pct:        aggregates.click_rate_pct,
        unsubscribe_rate_pct:  aggregates.unsubscribe_rate_pct,
        bounce_rate_pct:       aggregates.bounce_rate_pct,
        etl_synced_at:         new Date().toISOString(),
      };

      const upserted = await upsert("klaviyo_daily", [row], "date,brand_id");
      totalUpserted += upserted;
      log.push(
        `[${slug}] ✓ subscribers=${subscriberCount} active_flows=${activeFlows} ` +
        `recipients=${aggregates.total_recipients} delivered=${aggregates.total_delivered}`
      );
    } catch (err) {
      log.push(`[${slug}] ERROR — ${String(err)}`);
    }
  }

  return { rows_upserted: totalUpserted, log: log.join("\n") };
}
