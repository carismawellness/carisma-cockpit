/**
 * We360.ai token manager — credentials-based, auto-refreshing.
 *
 * We360 runs a shared Keycloak realm (`ind-prod`). Each customer is a tenant;
 * the tenant id doubles as the OAuth `client_id` ("customer_id" in We360 docs)
 * AND the `X-Tenant-Id` header required by every api.in.we360.ai call.
 *
 * Login (per We360 docs):
 *   POST https://auth.in.we360.ai/realms/ind-prod/protocol/openid-connect/token
 *   Content-Type: application/x-www-form-urlencoded
 *     client_id=<customer_id>  username=<email>  password=<pw>  grant_type=password
 *   → access_token (≈10 h TTL) + refresh_token
 *
 * Flow mirrors lib/talexio/auth.ts:
 *   1. In-memory cache (warm Vercel instance reuse).
 *   2. Supabase `integration_tokens` (survives cold starts).
 *   3. Re-login with WE360_EMAIL + WE360_PASSWORD + WE360_CUSTOMER_ID.
 *
 * Never store a hard-coded token. Store credentials only (env).
 */

import { createClient } from "@supabase/supabase-js";

const KEYCLOAK_TOKEN_URL =
  "https://auth.in.we360.ai/realms/ind-prod/protocol/openid-connect/token";
const PLATFORM   = "we360";
const BUFFER_SEC = 600; // refresh when < 10 min remaining

// ── In-memory cache (lives for the lifetime of a warm function instance) ──────
let _cachedToken: string | null = null;
let _cachedExpiry = 0; // Unix seconds

function customerId(): string {
  const cid = process.env.WE360_CUSTOMER_ID;
  if (!cid) throw new Error("WE360_CUSTOMER_ID not configured");
  return cid;
}

/** Tenant id = OAuth client_id = X-Tenant-Id header value. */
export function we360TenantId(): string {
  return customerId();
}

function parseExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    return payload.exp ?? 0;
  } catch {
    return 0;
  }
}

function isValid(expiry: number): boolean {
  return expiry > 0 && Date.now() / 1000 < expiry - BUFFER_SEC;
}

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

async function saveToken(token: string, expiry: number): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    await supabase.from("integration_tokens").upsert(
      {
        platform:   PLATFORM,
        brand_id:   null,
        token,
        expires_at: new Date(expiry * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "platform,brand_id" },
    );
  } catch {
    // Non-fatal — in-memory cache still works for this instance.
  }
}

async function loadFromSupabase(): Promise<string | null> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("integration_tokens")
      .select("token, expires_at")
      .eq("platform", PLATFORM)
      .is("brand_id", null)
      .maybeSingle();
    if (!data?.token) return null;
    const expiry = data.expires_at
      ? Math.floor(new Date(data.expires_at).getTime() / 1000)
      : parseExpiry(data.token);
    if (!isValid(expiry)) return null;
    _cachedToken  = data.token;
    _cachedExpiry = expiry;
    return data.token;
  } catch {
    return null;
  }
}

async function login(): Promise<string> {
  const email    = process.env.WE360_EMAIL;
  const password = process.env.WE360_PASSWORD;
  if (!email || !password) {
    throw new Error("WE360_EMAIL / WE360_PASSWORD not configured");
  }

  const body = new URLSearchParams({
    client_id:  customerId(),
    username:   email,
    password,
    grant_type: "password",
  });

  const resp = await fetch(KEYCLOAK_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`We360 login failed ${resp.status}: ${text}`);
  }

  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("We360 login returned no access_token");

  const token  = json.access_token;
  const expiry = parseExpiry(token);
  _cachedToken  = token;
  _cachedExpiry = expiry;
  await saveToken(token, expiry);
  return token;
}

/** Returns a valid We360 access token, refreshing as needed. */
export async function we360Token(): Promise<string> {
  if (_cachedToken && isValid(_cachedExpiry)) return _cachedToken;
  const fromDb = await loadFromSupabase();
  if (fromDb) return fromDb;
  return login();
}
