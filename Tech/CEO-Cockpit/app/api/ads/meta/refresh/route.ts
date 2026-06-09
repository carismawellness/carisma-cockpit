import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabaseAdmin = getAdminClient();
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    // If we have app credentials, exchange for long-lived token
    let longLivedToken = token;
    let expiresAt: Date | null = null;

    if (appId && appSecret) {
      const exchangeUrl = new URL("https://graph.facebook.com/v22.0/oauth/access_token");
      exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
      exchangeUrl.searchParams.set("client_id", appId);
      exchangeUrl.searchParams.set("client_secret", appSecret);
      exchangeUrl.searchParams.set("fb_exchange_token", token);

      const res = await fetch(exchangeUrl.toString());
      const data = await res.json();

      if (data.access_token) {
        longLivedToken = data.access_token;
        // Meta long-lived tokens expire in ~60 days
        const expiresIn = data.expires_in ?? 5184000; // default 60 days
        expiresAt = new Date(Date.now() + expiresIn * 1000);
      }
    } else {
      // No app credentials — assume token is already long-lived, set 60 day expiry
      expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }

    // Verify the token works by making a simple API call
    const verifyRes = await fetch(
      `https://graph.facebook.com/v22.0/me?access_token=${longLivedToken}`
    );
    const verifyData = await verifyRes.json();

    if (verifyData.error) {
      return NextResponse.json(
        { error: `Token verification failed: ${verifyData.error.message}` },
        { status: 400 },
      );
    }

    // Store in Supabase (upsert — one row for meta_ads platform, null brand = global)
    const { error: dbError } = await supabaseAdmin
      .from("integration_tokens")
      .upsert(
        {
          platform: "meta_ads",
          brand_id: null,
          token: longLivedToken,
          expires_at: expiresAt?.toISOString(),
          metadata: { user_name: verifyData.name, user_id: verifyData.id },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform,brand_id" },
      );

    if (dbError) {
      // If DB storage fails, still return the token (can be set in env manually)
      console.error("Failed to store token in DB:", dbError);
    }

    return NextResponse.json({
      success: true,
      expiresAt: expiresAt?.toISOString(),
      userName: verifyData.name,
      tokenStored: !dbError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// GET: Check token status
export async function GET() {
  const supabaseAdmin = getAdminClient();
  try {
    // Try Supabase first
    const { data } = await supabaseAdmin
      .from("integration_tokens")
      .select("expires_at, metadata, updated_at")
      .eq("platform", "meta_ads")
      .is("brand_id", null)
      .single();

    if (data?.expires_at) {
      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);

      return NextResponse.json({
        hasToken: true,
        source: "database",
        expiresAt: data.expires_at,
        daysRemaining,
        isExpired: daysRemaining <= 0,
        isExpiringSoon: daysRemaining <= 7,
        userName: data.metadata?.user_name,
        lastUpdated: data.updated_at,
      });
    }

    // Fallback: check env var
    const envToken = process.env.META_ACCESS_TOKEN;
    if (envToken && envToken !== "REPLACE_WITH_NEW_TOKEN") {
      return NextResponse.json({
        hasToken: true,
        source: "environment",
        expiresAt: null,
        daysRemaining: null,
        isExpired: false,
        isExpiringSoon: null,
        userName: null,
      });
    }

    return NextResponse.json({
      hasToken: false,
      source: null,
      isExpired: true,
    });
  } catch {
    return NextResponse.json({
      hasToken: !!process.env.META_ACCESS_TOKEN,
      source: "environment",
      error: "Could not check database",
    });
  }
}
