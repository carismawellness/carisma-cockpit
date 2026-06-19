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
import { ETLLogger } from "@/lib/etl/etl-logger";

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

/** Retry on 429 with a cap. Klaviyo sometimes returns Retry-After in the
 *  thousands of seconds (steady-state limit). Cap waits at 8s so a single
 *  blocked list/report doesn't consume the entire Vercel function budget. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, init);
    last = res;
    if (res.status !== 429) return res;
    const after = res.headers.get("Retry-After");
    const waitMs = after
      ? Math.min(parseInt(after, 10) * 1000, 8000)
      : Math.min(1500 * (attempt + 1), 8000);
    await sleep(waitMs);
  }
  return last as Response; // give up — caller handles !ok
}

async function getBrandId(slug: string): Promise<string> {
  const rows = await selectRaw("brands", { slug: `eq.${slug}`, select: "id" });
  if (!rows.length) throw new Error(`Brand not found: ${slug}`);
  return rows[0].id as string;
}

/** Get total subscriber count by summing per-list profile_count.
 *
 * Klaviyo's /lists/ collection endpoint does NOT expose profile_count as a
 * sparse field. The count is only available on the single-list endpoint via
 * `additional-fields[list]=profile_count`. Sequential GET per list with
 * delays to stay under the 75/sec, 750/min limit. Returns the sum (treat as
 * "reach"; contacts in multiple lists are counted multiple times). */
async function fetchSubscriberCount(apiKey: string): Promise<number> {
  try {
    const listsRes = await fetchWithRetry(`${KLAVIYO_BASE}/lists/`, {
      headers: klaviyoHeaders(apiKey),
    });
    if (!listsRes.ok) return 0;
    const listsJson = (await listsRes.json()) as { data?: { id: string }[] };
    const lists = listsJson.data ?? [];

    let sum = 0;
    for (const list of lists) {
      const url = `${KLAVIYO_BASE}/lists/${list.id}/?additional-fields%5Blist%5D=profile_count`;
      const r = await fetchWithRetry(url, { headers: klaviyoHeaders(apiKey) });
      if (!r.ok) {
        // On sustained 429 stop trying — we'll resume on the next nightly run.
        if (r.status === 429) break;
        continue;
      }
      const j = (await r.json()) as {
        data?: { attributes?: { profile_count?: number } };
      };
      sum += j.data?.attributes?.profile_count ?? 0;
      await sleep(250);
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

interface ReportResult {
  groupings?: Record<string, string>;
  statistics?: Record<string, number>;
}

/** Run a *-values-report POST and return results.
 *  Each result row has shape: { groupings: {campaign_id|flow_id}, statistics: {recipients, delivered, ...} } */
/** Set by fetchCampaignAggregates so the ETL log can surface why a report
 *  returned 0 rows (the most common case is a 429 throttle). */
let lastReportError: string | null = null;

async function fetchReport(
  apiKey: string,
  endpoint: "campaign-values-reports" | "flow-values-reports",
  reportType: "campaign-values-report" | "flow-values-report",
  dateFrom: string,
  dateTo: string,
  conversionMetricId: string,
): Promise<ReportResult[]> {
  // Klaviyo's custom_timeframe resource accepts only { start, end } — NO `key`
  // field (despite many examples online showing `key: "custom"`). Sending the
  // key triggers 400 "'key' is not a valid field for the resource 'custom_timeframe'".
  const body = {
    data: {
      type: reportType,
      attributes: {
        statistics: [
          "recipients", "delivered", "open_rate", "click_rate",
          "unsubscribe_rate", "bounce_rate", "clicks", "clicks_unique",
          "opens_unique",
        ],
        timeframe: {
          start: `${dateFrom}T00:00:00+00:00`,
          end:   `${dateTo}T23:59:59+00:00`,
        },
        conversion_metric_id: conversionMetricId,
        filter: 'equals(send_channel,"email")',
      },
    },
  };
  const res = await fetchWithRetry(
    `${KLAVIYO_BASE}/${endpoint}/`,
    { method: "POST", headers: klaviyoHeaders(apiKey), body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    lastReportError = `${endpoint} ${res.status}: ${txt.slice(0, 400)}`;
    return [];
  }
  const json = (await res.json()) as {
    data?: { attributes?: { results?: ReportResult[] } };
  };
  return json.data?.attributes?.results ?? [];
}

/** Fetch campaign + flow aggregate metrics for a date range.
 *  The aggregate combines both send channels so dashboards reflect total
 *  email reach, regardless of whether the account uses campaigns or flows. */
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
  const campaignResults = await fetchReport(
    apiKey, "campaign-values-reports", "campaign-values-report",
    dateFrom, dateTo, conversionMetricId,
  );
  await sleep(1000);
  const flowResults = await fetchReport(
    apiKey, "flow-values-reports", "flow-values-report",
    dateFrom, dateTo, conversionMetricId,
  );

  let totalRecipients = 0;
  let totalDelivered  = 0;
  let weightedOpen    = 0;
  let weightedClick   = 0;
  let weightedUnsub   = 0;
  let weightedBounce  = 0;

  for (const r of [...campaignResults, ...flowResults]) {
    const s = r.statistics ?? {};
    const recipients = Number(s.recipients ?? 0);
    const delivered  = Number(s.delivered  ?? 0);
    totalRecipients += recipients;
    totalDelivered  += delivered;
    weightedOpen    += Number(s.open_rate         ?? 0) * delivered;
    weightedClick   += Number(s.click_rate        ?? 0) * delivered;
    weightedUnsub   += Number(s.unsubscribe_rate  ?? 0) * delivered;
    weightedBounce  += Number(s.bounce_rate       ?? 0) * recipients;
  }

  return {
    campaigns_sent:       campaignResults.length,
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
  /** YYYY-MM-DD — the snapshot date (stored as date column). */
  date:      string;
  /** Optional date range. If omitted, both default to `date` (single-day). */
  dateFrom?: string;
  dateTo?:   string;
  brandSlug?: BrandSlug;
}): Promise<KlaviyoDailyEtlResult> {
  // Observability wrapper — records start/success/fail to etl_sync_log
  // (log key "klaviyo"). Data logic lives in the inner function.
  const logger = new ETLLogger("klaviyo");
  await logger.start();
  try {
    const result = await runKlaviyoDailyEtlInner(opts);
    if (result.rows_upserted === 0 && result.log.includes("ERROR")) {
      await logger.fail(result.log.slice(0, 500));
    } else {
      await logger.complete(result.rows_upserted);
    }
    return result;
  } catch (err) {
    await logger.fail(String(err));
    throw err;
  }
}

async function runKlaviyoDailyEtlInner(opts: {
  date:      string;
  dateFrom?: string;
  dateTo?:   string;
  brandSlug?: BrandSlug;
}): Promise<KlaviyoDailyEtlResult> {
  const { date, brandSlug } = opts;
  const dateFrom = opts.dateFrom ?? date;
  const dateTo   = opts.dateTo   ?? date;

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

      log.push(`[${slug}] fetching Klaviyo data for ${dateFrom}…${dateTo} (stored as ${date})`);
      lastReportError = null;

      // Sequential, not parallel — these all hit Klaviyo's burst limit (75/sec).
      // Reports are more important than subscribers for dashboard rates.
      const aggregates = await fetchCampaignAggregates(apiKey, dateFrom, dateTo);
      await sleep(800);
      const activeFlows = await fetchActiveFlowCount(apiKey);
      await sleep(800);
      const subscriberCount = await fetchSubscriberCount(apiKey);

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
        `recipients=${aggregates.total_recipients} delivered=${aggregates.total_delivered}` +
        (lastReportError ? ` [report_err: ${lastReportError}]` : ``)
      );
    } catch (err) {
      log.push(`[${slug}] ERROR — ${String(err)}`);
    }
  }

  return { rows_upserted: totalUpserted, log: log.join("\n") };
}
