/**
 * Google Search Console — daily keyword ranking ETL.
 *
 * For each tracked keyword (lib/constants/gsc-keywords.ts), pulls one row per
 * day from GSC over the requested window and upserts into gsc_keyword_daily.
 *
 * GSC has a 2–3 day data lag, so the default sync window ends 3 days ago.
 *
 * Auth: uses the existing Google OAuth refresh token in GOOGLE_REFRESH_TOKEN
 * (or GOOGLE_SHEETS_REFRESH_TOKEN as a fallback). The token must include the
 * `https://www.googleapis.com/auth/webmasters.readonly` scope — if it doesn't,
 * re-do OAuth at https://developers.google.com/oauthplayground/ with that
 * scope added and update the env var.
 */

import { upsert, selectRaw } from "@/lib/etl/supabase-etl";
import {
  GSC_SITE_URLS,
  TRACKED_KEYWORDS,
  type BrandSlug,
} from "@/lib/constants/gsc-keywords";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_BASE = "https://searchconsole.googleapis.com/v1";

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken =
    process.env.GOOGLE_REFRESH_TOKEN ?? process.env.GOOGLE_SHEETS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google OAuth credentials missing (GOOGLE_CLIENT_ID / _SECRET / _REFRESH_TOKEN)",
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPE,
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    scope?: string;
  };
  if (json.error)
    throw new Error(`OAuth: ${json.error} — ${json.error_description ?? ""}`);
  if (json.scope && !json.scope.includes("webmasters")) {
    throw new Error(
      `Refresh token does not include webmasters scope. Got: ${json.scope}`,
    );
  }
  return json.access_token!;
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function fetchKeywordDaily(
  accessToken: string,
  siteUrl: string,
  keyword: string,
  startDate: string,
  endDate: string,
): Promise<GscRow[]> {
  const url = `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const body = {
    startDate,
    endDate,
    dimensions: ["date"],
    dimensionFilterGroups: [
      {
        filters: [{ dimension: "query", operator: "equals", expression: keyword }],
      },
    ],
    rowLimit: 1000,
    type: "web",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GSC ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as { rows?: GscRow[] };
  return json.rows ?? [];
}

async function getBrandId(slug: string): Promise<number> {
  const rows = await selectRaw("brands", { slug: `eq.${slug}`, select: "id" });
  if (!rows.length) throw new Error(`Brand not found: ${slug}`);
  return Number(rows[0].id);
}

export interface GscEtlResult {
  rows_upserted: number;
  log: string;
}

interface RunOpts {
  /** YYYY-MM-DD start of GSC date range. Default: 30 days before endDate. */
  startDate?: string;
  /** YYYY-MM-DD end of GSC date range. Default: 3 days ago. */
  endDate?: string;
  /** Only run for one brand. Default: all 3. */
  brandSlug?: BrandSlug;
}

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}

function defaultStartDate(endIso: string): string {
  const end = new Date(endIso);
  end.setDate(end.getDate() - 29);
  return end.toISOString().slice(0, 10);
}

const BRANDS: BrandSlug[] = ["spa", "aesthetics", "slimming"];

export async function runGscKeywordEtl(opts: RunOpts = {}): Promise<GscEtlResult> {
  const endDate = opts.endDate ?? defaultEndDate();
  const startDate = opts.startDate ?? defaultStartDate(endDate);
  const brands = opts.brandSlug ? [opts.brandSlug] : BRANDS;

  const log: string[] = [];
  let totalUpserted = 0;

  const accessToken = await getAccessToken();
  log.push(`[gsc] got access token; window ${startDate} → ${endDate}`);

  for (const slug of brands) {
    const siteUrl = GSC_SITE_URLS[slug];
    const keywords = TRACKED_KEYWORDS[slug];
    let brandId: number;
    try {
      brandId = await getBrandId(slug);
    } catch (err) {
      log.push(`[${slug}] ERROR — ${String(err)}`);
      continue;
    }

    let brandUpserts = 0;
    for (const keyword of keywords) {
      try {
        const rows = await fetchKeywordDaily(
          accessToken,
          siteUrl,
          keyword,
          startDate,
          endDate,
        );
        if (rows.length === 0) {
          // No impressions for this keyword in the window — still record zeros
          // for the end date so the dashboard knows "we checked" vs "we never tried".
          const blank = [{
            date: endDate,
            brand_id: brandId,
            keyword,
            clicks: 0,
            impressions: 0,
            ctr: null,
            position: null,
            etl_synced_at: new Date().toISOString(),
          }];
          const n = await upsert("gsc_keyword_daily", blank, "date,brand_id,keyword");
          brandUpserts += n;
          continue;
        }

        const records = rows.map((r) => ({
          date: r.keys[0],
          brand_id: brandId,
          keyword,
          clicks: r.clicks ?? 0,
          impressions: r.impressions ?? 0,
          ctr: r.ctr ?? null,
          position: r.position ?? null,
          etl_synced_at: new Date().toISOString(),
        }));
        const n = await upsert(
          "gsc_keyword_daily",
          records as unknown as Record<string, unknown>[],
          "date,brand_id,keyword",
        );
        brandUpserts += n;
      } catch (err) {
        log.push(`[${slug}/${keyword}] ERROR — ${String(err)}`);
      }
    }
    log.push(`[${slug}] ${brandUpserts} rows upserted across ${keywords.length} keywords`);
    totalUpserted += brandUpserts;
  }

  return { rows_upserted: totalUpserted, log: log.join("\n") };
}
