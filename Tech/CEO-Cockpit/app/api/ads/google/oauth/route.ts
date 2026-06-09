import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");

  if (!code) {
    // Step 1: Redirect to Google OAuth
    const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const redirectUri = `${req.nextUrl.origin}/api/ads/google/oauth`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return NextResponse.redirect(url.toString());
  }

  // Step 2: Exchange code for tokens
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = `${req.nextUrl.origin}/api/ads/google/oauth`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return NextResponse.json({ error: tokenData.error, description: tokenData.error_description }, { status: 400 });
  }

  const refreshToken = tokenData.refresh_token;

  return new NextResponse(
    `<html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
      <h2>Google Ads OAuth Complete</h2>
      <p>Copy this refresh token and add it to <code>.env.local</code> as <code>GOOGLE_ADS_REFRESH_TOKEN</code>:</p>
      <pre style="background:#f5f5f5;padding:16px;border-radius:8px;word-break:break-all;font-size:14px">${refreshToken}</pre>
      <p style="color:#666;font-size:13px">This token does not expire unless you revoke access.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
