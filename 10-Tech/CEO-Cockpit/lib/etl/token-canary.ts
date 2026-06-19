/**
 * Token-health canary — cheap authenticated calls that exercise every
 * credential the ETL layer depends on, so an expired/revoked token
 * (invalid_grant, 401, …) is caught the moment the nightly cron runs
 * instead of days later when someone notices stale dashboards.
 *
 * Checks:
 *   zoho_spa / zoho_aesthetics — OAuth refresh-token → tiny GET /currencies
 *   google_sheets              — OAuth refresh-token grant + spreadsheet metadata fetch
 *   talexio                    — credential login / cached-token validity
 *   klaviyo_{spa,aes,slim}     — GET /api/accounts/ (lightest authenticated GET)
 *   ghl_{spa,aesthetics,slimming} — GET /locations/{id} (lightest authenticated GET)
 *   meta_{spa,aes,slim}        — GET graph /me?fields=id (token validity)
 *
 * Every check has a strict timeout (8s) and never throws — the canary can
 * never hang or break the cron. Results are optionally recorded to
 * etl_sync_log under the log key "token-canary".
 */

import { ZohoBooksClient } from "./zoho-client";
import { getTalexioToken } from "@/lib/talexio/auth";
import { ETLLogger } from "./etl-logger";

export interface CanaryResult {
  service:   string;
  ok:        boolean;
  error?:    string;
  latencyMs: number;
}

const TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function timed(
  service: string,
  fn: () => Promise<void>,
): Promise<CanaryResult> {
  const started = Date.now();
  try {
    await withTimeout(fn());
    return { service, ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      service,
      ok:        false,
      error:     String(err instanceof Error ? err.message : err).slice(0, 300),
      latencyMs: Date.now() - started,
    };
  }
}

// ── Zoho Books (spa + aesthetics orgs) ───────────────────────────────────────

function checkZoho(org: "spa" | "aesthetics"): Promise<CanaryResult> {
  return timed(`zoho_${org}`, async () => {
    if (!process.env.ZOHO_BOOKS_CLIENT_ID || !process.env.ZOHO_BOOKS_CLIENT_SECRET) {
      throw new Error("ZOHO_BOOKS_CLIENT_ID/SECRET not configured");
    }
    // ZohoBooksClient.get() refreshes the OAuth token internally —
    // an expired refresh token surfaces as "Token refresh failed … invalid_grant".
    const client = new ZohoBooksClient(org);
    await client.get("settings/currencies");
  });
}

// ── Google Sheets OAuth refresh token ────────────────────────────────────────

// Known always-shared sheet used only as a metadata-fetch target.
const CANARY_SHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI"; // CRM Master Sheet

function checkGoogleSheets(): Promise<CanaryResult> {
  return timed("google_sheets", async () => {
    const clientId     = process.env.GOOGLE_SHEETS_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_SHEETS_REFRESH_TOKEN ?? process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Google Sheets OAuth env vars not configured");
    }

    // 1. Exercise the refresh token (this is where invalid_grant shows up).
    const body = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    });
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!tokenResp.ok) {
      throw new Error(`token refresh failed (${tokenResp.status}): ${(await tokenResp.text()).slice(0, 200)}`);
    }
    const tokenData = await tokenResp.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error("token refresh returned no access_token");

    // 2. Minimal metadata fetch to confirm the access token actually works.
    const metaResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CANARY_SHEET_ID}?fields=spreadsheetId`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!metaResp.ok) {
      throw new Error(`metadata fetch failed (${metaResp.status}): ${(await metaResp.text()).slice(0, 200)}`);
    }
  });
}

// ── Talexio ──────────────────────────────────────────────────────────────────

function checkTalexio(): Promise<CanaryResult> {
  return timed("talexio", async () => {
    // getTalexioToken() validates the cached token or re-logs-in with
    // TALEXIO_EMAIL/TALEXIO_PASSWORD — exactly the path the HR ETL relies on.
    const token = await getTalexioToken();
    if (!token) throw new Error("empty token");
  });
}

// ── Klaviyo (one API key per brand) ──────────────────────────────────────────

const KLAVIYO_KEYS: Record<string, string | undefined> = {
  spa:  process.env.KLAVIYO_API_KEY_SPA,
  aes:  process.env.KLAVIYO_API_KEY_AES,
  slim: process.env.KLAVIYO_API_KEY_SLIM,
};

function checkKlaviyo(brand: string): Promise<CanaryResult> {
  return timed(`klaviyo_${brand}`, async () => {
    const apiKey = KLAVIYO_KEYS[brand];
    if (!apiKey) throw new Error(`KLAVIYO_API_KEY_${brand.toUpperCase()} not configured`);
    const resp = await fetch("https://a.klaviyo.com/api/accounts/", {
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision:      "2024-10-15",
        Accept:        "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  });
}

// ── GoHighLevel (one private-integration token per sub-account) ──────────────

const GHL_ACCOUNTS: Array<{ slug: string; envKey: string; locationId: string }> = [
  { slug: "spa",        envKey: "GHL_API_KEY",            locationId: "TrtSnBSSKBOkVVNxJ3AM" },
  { slug: "aesthetics", envKey: "GHL_API_KEY_AESTHETICS", locationId: "Goi7kzVK7iwe2woxUHkT" },
  { slug: "slimming",   envKey: "GHL_API_KEY_SLIMMING",   locationId: "imWIWDcnmOfijW0lltPq" },
];

function checkGhl(acc: { slug: string; envKey: string; locationId: string }): Promise<CanaryResult> {
  return timed(`ghl_${acc.slug}`, async () => {
    const apiKey = process.env[acc.envKey];
    if (!apiKey) throw new Error(`${acc.envKey} not configured`);
    const resp = await fetch(
      `https://services.leadconnectorhq.com/locations/${acc.locationId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version:       "2021-07-28",
          Accept:        "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  });
}

// ── Meta (one system-user token per brand portfolio) ─────────────────────────

const META_TOKEN_ENVS: Record<string, string> = {
  spa:  "META_ACCESS_TOKEN_SPA",
  aes:  "META_ACCESS_TOKEN_AES",
  slim: "META_ACCESS_TOKEN_SLIM",
};

function checkMeta(brand: string): Promise<CanaryResult> {
  return timed(`meta_${brand}`, async () => {
    const token =
      process.env[META_TOKEN_ENVS[brand]] || process.env.META_ACCESS_TOKEN;
    if (!token || token === "REPLACE_WITH_NEW_TOKEN") {
      throw new Error(`${META_TOKEN_ENVS[brand]} not configured`);
    }
    // Lightest token-validity check: /me?fields=id
    const resp = await fetch(
      `https://graph.facebook.com/v22.0/me?fields=id&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all credential checks in parallel. Never throws, never hangs
 * (every check is individually time-boxed at 8s).
 *
 * @param opts.record — when true, write an etl_sync_log entry under the
 *                      "token-canary" log key (used by the nightly cron;
 *                      the manual /api/etl/health route does not record).
 */
export async function runTokenCanary(opts?: { record?: boolean }): Promise<CanaryResult[]> {
  const logger = opts?.record ? new ETLLogger("token-canary") : null;
  if (logger) await logger.start();

  const settled = await Promise.allSettled([
    checkZoho("spa"),
    checkZoho("aesthetics"),
    checkGoogleSheets(),
    checkTalexio(),
    checkKlaviyo("spa"),
    checkKlaviyo("aes"),
    checkKlaviyo("slim"),
    ...GHL_ACCOUNTS.map(checkGhl),
    checkMeta("spa"),
    checkMeta("aes"),
    checkMeta("slim"),
  ]);

  // `timed()` never rejects, but defend anyway so the canary cannot throw.
  const results: CanaryResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : { service: `canary_check_${i}`, ok: false, error: String(s.reason).slice(0, 300), latencyMs: 0 },
  );

  const failures = results.filter(r => !r.ok);
  if (logger) {
    if (failures.length === 0) {
      await logger.complete(results.length);
    } else {
      await logger.fail(
        failures.map(f => `${f.service}: ${f.error}`).join(" | ").slice(0, 500),
      );
    }
  }

  for (const f of failures) {
    console.error(`[Token Canary] ${f.service} FAILED — ${f.error}`);
  }

  return results;
}
