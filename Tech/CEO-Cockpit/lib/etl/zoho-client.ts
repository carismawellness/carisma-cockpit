const AUTH_BASE = "https://accounts.zoho.eu/oauth/v2";
const API_BASE  = "https://www.zohoapis.eu/books/v3";

type TokenCache = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

// Module-level rate limiter: enforce a minimum gap between consecutive Zoho
// API calls per org.  600ms → max ~1.6 req/s per org, well under the 5 req/s
// burst limit and the 60 req/min quota.
const _lastCallAt = new Map<string, number>();
async function rateLimit(org: string) {
  const MIN_MS = 600;
  const last   = _lastCallAt.get(org) ?? 0;
  const wait   = MIN_MS - (Date.now() - last);
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  _lastCallAt.set(org, Date.now());
}

async function refreshAccessToken(org: "spa" | "aesthetics"): Promise<string> {
  // Aesthetics may use its own Zoho API client; fall back to shared CLIENT_ID/SECRET if not set.
  const clientId =
    org === "aesthetics"
      ? (process.env.ZOHO_BOOKS_AESTH_CLIENT_ID ?? process.env.ZOHO_BOOKS_CLIENT_ID!)
      : process.env.ZOHO_BOOKS_CLIENT_ID!;
  const clientSecret =
    org === "aesthetics"
      ? (process.env.ZOHO_BOOKS_AESTH_CLIENT_SECRET ?? process.env.ZOHO_BOOKS_CLIENT_SECRET!)
      : process.env.ZOHO_BOOKS_CLIENT_SECRET!;
  const refreshToken =
    org === "spa"
      ? (process.env.ZOHO_BOOKS_SPA_REFRESH_TOKEN ?? process.env.ZOHO_BOOKS_REFRESH_TOKEN!)
      : process.env.ZOHO_BOOKS_REFRESH_TOKEN!;

  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     clientId,
    client_secret: clientSecret,
    grant_type:    "refresh_token",
  });

  const resp = await fetch(`${AUTH_BASE}/token?${params}`, { method: "POST" });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as Record<string, unknown>;
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  const expiresAt = Date.now() + (Number(data.expires_in ?? 3600)) * 1000 - 60_000;
  tokenCache.set(`${clientId}:${org}`, { accessToken: data.access_token as string, expiresAt });
  return data.access_token as string;
}

async function getAccessToken(org: "spa" | "aesthetics"): Promise<string> {
  const clientId =
    org === "aesthetics"
      ? (process.env.ZOHO_BOOKS_AESTH_CLIENT_ID ?? process.env.ZOHO_BOOKS_CLIENT_ID!)
      : process.env.ZOHO_BOOKS_CLIENT_ID!;
  const key    = `${clientId}:${org}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.accessToken;
  return refreshAccessToken(org);
}

const ORG_ENV_KEYS = {
  spa:        "ZOHO_BOOKS_SPA_ORG_ID",
  aesthetics: "ZOHO_BOOKS_AESTH_ORG_ID",
} as const;

export class ZohoBooksClient {
  private orgId: string;
  readonly org: "spa" | "aesthetics";

  constructor(org: "spa" | "aesthetics") {
    this.org   = org;
    this.orgId = process.env[ORG_ENV_KEYS[org]]!;
  }

  async get(endpoint: string, params?: Record<string, string>): Promise<unknown> {
    await rateLimit(this.org);
    const token = await getAccessToken(this.org);
    const qs    = new URLSearchParams({ organization_id: this.orgId, ...(params ?? {}) });
    const resp  = await fetch(`${API_BASE}/${endpoint}?${qs}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Zoho API error ${resp.status} on ${endpoint}: ${text}`);
    }
    return resp.json();
  }

  async getAllPages(
    endpoint: string,
    listKey: string,
    params?: Record<string, string>,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;
    while (true) {
      const data = await this.get(endpoint, {
        ...(params ?? {}),
        page:     String(page),
        per_page: "200",
      }) as Record<string, unknown>;
      const items = (data[listKey] as unknown[]) ?? [];
      results.push(...items);
      const ctx = data.page_context as Record<string, unknown> | undefined;
      if (!ctx?.has_more_page) break;
      page++;
    }
    return results;
  }
}
