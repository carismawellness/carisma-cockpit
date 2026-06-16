import { NextResponse } from "next/server";

export const maxDuration = 30;

// Diagnostic endpoint — returns credential metadata (never the raw values) + OAuth test result.
// Remove after the Google Ads OAuth issue is resolved.
export async function GET() {
  const clientId     = process.env.GOOGLE_ADS_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? "";
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "";
  const devToken     = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
  const mccId        = process.env.GOOGLE_ADS_MCC_ID ?? "";

  function charCodes(s: string): number[] {
    if (!s) return [];
    // First 3 and last 3 char codes (enough to spot hidden chars without exposing the value)
    const codes: number[] = [];
    for (let i = 0; i < Math.min(3, s.length); i++) codes.push(s.charCodeAt(i));
    if (s.length > 6) codes.push(-1); // separator
    for (let i = Math.max(3, s.length - 3); i < s.length; i++) codes.push(s.charCodeAt(i));
    return codes;
  }

  const meta = {
    clientId:     { len: clientId.length,     prefix: clientId.slice(0, 20),     suffix: clientId.slice(-10),     edgeCodes: charCodes(clientId)     },
    clientSecret: { len: clientSecret.length, prefix: clientSecret.slice(0, 8),  suffix: clientSecret.slice(-5),  edgeCodes: charCodes(clientSecret) },
    refreshToken: { len: refreshToken.length, prefix: refreshToken.slice(0, 8),  suffix: refreshToken.slice(-5),  edgeCodes: charCodes(refreshToken) },
    devToken:     { len: devToken.length,     prefix: devToken.slice(0, 8),      suffix: devToken.slice(-5),      edgeCodes: charCodes(devToken)     },
    mccId:        { len: mccId.length,        prefix: mccId.slice(0, 10),        edgeCodes: charCodes(mccId)     },
  };

  // Trim versions (what getAccessToken sends after defensive cleanup)
  const cleanClientId     = clientId.replace(/\n/g, "").trim();
  const cleanClientSecret = clientSecret.replace(/\n/g, "").trim();
  const cleanRefreshToken = refreshToken.replace(/\n/g, "").trim();

  const trimEffect = {
    clientId:     clientId.length     !== cleanClientId.length,
    clientSecret: clientSecret.length !== cleanClientSecret.length,
    refreshToken: refreshToken.length !== cleanRefreshToken.length,
  };

  // Attempt the actual OAuth call using exactly the same logic as getAccessToken()
  let oauthResult: { ok: boolean; status?: number; body?: unknown; error?: string } = { ok: false };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        client_id:     cleanClientId,
        client_secret: cleanClientSecret,
        refresh_token: cleanRefreshToken,
        grant_type:    "refresh_token",
      }),
    });
    const body = await res.json();
    oauthResult = {
      ok:     res.ok,
      status: res.status,
      body:   res.ok
        ? { access_token_prefix: (body as { access_token?: string }).access_token?.slice(0, 20) + "…", scope: (body as { scope?: string }).scope }
        : body,
    };
  } catch (err) {
    oauthResult = { ok: false, error: String(err) };
  }

  return NextResponse.json({ meta, trimEffect, oauthResult });
}
