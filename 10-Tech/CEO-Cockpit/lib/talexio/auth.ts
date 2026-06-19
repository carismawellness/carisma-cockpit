/**
 * Talexio token manager — credentials-based, auto-refreshing.
 *
 * Flow:
 *   1. Check module-level in-memory cache (survives warm Vercel instance reuse).
 *   2. Check Supabase `integration_tokens` table (survives cold starts).
 *   3. Re-login with TALEXIO_EMAIL + TALEXIO_PASSWORD → store result.
 *
 * Never store a hard-coded token. Store credentials only.
 */

import { createClient } from "@supabase/supabase-js";

const GRAPHQL_URL = "https://api.talexiohr.com/graphql";
const ORIGIN      = "https://carismaspawellness.talexiohr.com";
const PLATFORM    = "talexio";
const BUFFER_SEC  = 3600; // refresh when < 1 h remaining

const LOGIN_MUTATION = `
  mutation Login(
    $emailAddress: String!
    $password: String!
    $captchaAnswer: String!
    $rememberMe: Boolean
  ) {
    loginUser(
      emailAddress: $emailAddress
      password: $password
      captchaAnswer: $captchaAnswer
      rememberMe: $rememberMe
    ) {
      token
      domain
      expiry
    }
  }
`;

// ── In-memory cache (lives for the lifetime of a warm function instance) ──────
let _cachedToken: string | null  = null;
let _cachedExpiry: number        = 0;   // Unix seconds

function parseExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    // Talexio uses "expiryDate" (ISO string); fall back to standard "exp" (Unix)
    if (payload.expiryDate) {
      return Math.floor(new Date(payload.expiryDate).getTime() / 1000);
    }
    return payload.exp ?? 0;
  } catch {
    return 0;
  }
}

function isValid(expiry: number): boolean {
  return expiry > 0 && Date.now() / 1000 < expiry - BUFFER_SEC;
}

// ── Admin Supabase client (service role — never exposed to browser) ───────────
function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key);
}

// ── Persist refreshed token to Supabase ──────────────────────────────────────
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
    // Non-fatal — in-memory cache still works for this instance
  }
}

// ── Load token from Supabase ──────────────────────────────────────────────────
async function loadFromSupabase(): Promise<string | null> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("integration_tokens")
      .select("token, expires_at")
      .eq("platform", PLATFORM)
      .is("brand_id", null)
      .single();

    if (!data?.token) return null;
    const expiry = data.expires_at
      ? Math.floor(new Date(data.expires_at).getTime() / 1000)
      : parseExpiry(data.token);

    if (!isValid(expiry)) return null;

    // Warm the in-memory cache
    _cachedToken  = data.token;
    _cachedExpiry = expiry;
    return data.token;
  } catch {
    return null;
  }
}

// ── Re-login with credentials ─────────────────────────────────────────────────
async function loginWithCredentials(): Promise<string> {
  const email    = process.env.TALEXIO_EMAIL;
  const password = process.env.TALEXIO_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Talexio token expired and no credentials configured. " +
      "Set TALEXIO_EMAIL + TALEXIO_PASSWORD in environment variables.",
    );
  }

  const res = await fetch(GRAPHQL_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({
      query:     LOGIN_MUTATION,
      variables: {
        emailAddress:  email,
        password,
        captchaAnswer: "",
        rememberMe:    true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Talexio login HTTP ${res.status}`);
  }

  const json = await res.json();
  const loginData = json?.data?.loginUser;

  if (!loginData?.token) {
    const errMsg = JSON.stringify(json?.errors ?? json);
    throw new Error(`Talexio login failed: ${errMsg}`);
  }

  const token  = loginData.token as string;
  const expiry = parseExpiry(token);

  _cachedToken  = token;
  _cachedExpiry = expiry;

  // Persist so the next cold-start avoids a login round-trip
  await saveToken(token, expiry);

  return token;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a valid bearer token. Refreshes automatically when expired.
 * Never throws due to a missing/expired token — always tries credentials first.
 */
export async function getTalexioToken(): Promise<string> {
  // 1. In-memory cache
  if (_cachedToken && isValid(_cachedExpiry)) {
    return _cachedToken;
  }

  // 2. TALEXIO_TOKEN env var (set by refresh script or Vercel dashboard)
  const envToken = process.env.TALEXIO_TOKEN;
  if (envToken) {
    const expiry = parseExpiry(envToken);
    if (isValid(expiry)) {
      _cachedToken  = envToken;
      _cachedExpiry = expiry;
      return envToken;
    }
  }

  // 3. Supabase persistence (cross-instance)
  const fromDB = await loadFromSupabase();
  if (fromDB) return fromDB;

  // 4. Re-login with credentials
  return loginWithCredentials();
}

/**
 * Execute a GraphQL query against Talexio. Auto-refreshes token.
 */
export async function talexioQuery(
  query: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const token = await getTalexioToken();

  const res = await fetch(GRAPHQL_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
      Origin:         ORIGIN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Talexio API HTTP ${res.status}`);
  }

  const json = await res.json();

  // On auth error: force a fresh login and retry once
  const isAuthError = json?.errors?.some(
    (e: { message?: string }) =>
      /login again|unauthorized|unauthenticated|401/i.test(e.message ?? ""),
  );

  if (isAuthError) {
    // Invalidate caches and force re-login
    _cachedToken  = null;
    _cachedExpiry = 0;
    const freshToken = await loginWithCredentials();

    const retry = await fetch(GRAPHQL_URL, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${freshToken}`,
        Origin:         ORIGIN,
      },
      body: JSON.stringify({ query, variables }),
    });
    return retry.json();
  }

  return json;
}
