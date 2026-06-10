import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export async function GET(req: NextRequest) {
  // Auth: when CRON_SECRET is set, Vercel sends it as `Authorization: Bearer`
  // on cron invocations — require it (also enables manual curl triggers).
  // When it's NOT set, fall back to the x-vercel-cron header so the nightly
  // job keeps working, but warn loudly.
  const cronSecret = process.env.CRON_SECRET;
  const isLocal = !process.env.VERCEL_URL;
  const authorized = cronSecret
    ? req.headers.get("authorization") === `Bearer ${cronSecret}`
    : req.headers.get("x-vercel-cron") === "1";
  if (!cronSecret) {
    console.warn(
      "[SECURITY] CRON_SECRET is not set — cron auth falls back to the x-vercel-cron header. Set CRON_SECRET in Vercel env vars."
    );
  }
  if (!authorized && !isLocal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // First day of 2 months ago
  const from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  // Last day of current month
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const pad  = (n: number) => String(n).padStart(2, "0");
  const fmt  = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const date_from = fmt(from);
  const date_to   = fmt(to);

  const payload = JSON.stringify({ date_from, date_to, force: true });
  // Forward the cron secret so the gated /api/etl/* routes accept these
  // server-to-server calls (they carry no session cookies).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cronSecret) headers["Authorization"] = `Bearer ${cronSecret}`;

  // Marketing ETLs use the same window as the main ETL (first of 2 months ago → today)
  // This ensures Meta/Google data aligns with CRM and revenue data in all dashboards.
  const mktFrom = from;
  const mktPayload = JSON.stringify({ date_from: fmt(mktFrom), date_to: fmt(now) });

  // Klaviyo syncs yesterday's aggregate snapshot
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const klaviyoPayload = JSON.stringify({ date: fmt(yesterday) });

  // Talexio HR ETL syncs headcount/payroll/shifts for today's date.
  const today = fmt(now);

  // Phase 1: run source ETLs in parallel
  const [revenueRes, spaRes, aestheticsRes, crmAgentsRes, ghlCrmRes,
         metaCampaignsRes, googleCampaignsRes, klaviyoRes, talexioHrRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/etl/revenue-refresh`,              { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/zoho-spa-transactions`,        { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/zoho-aesthetics-transactions`, { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/crm-agents`,                   { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/ghl-crm`,                      { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/meta-campaigns`,               { method: "POST", headers, body: mktPayload }),
    fetch(`${BASE_URL}/api/etl/google-campaigns`,             { method: "POST", headers, body: mktPayload }),
    fetch(`${BASE_URL}/api/etl/klaviyo-sync`,                 { method: "POST", headers, body: klaviyoPayload }),
    fetch(`${BASE_URL}/api/etl/talexio-hr?date=${today}`,     { method: "POST", headers }),
  ]);

  // Phase 2: lead reconciliation depends on ghl-crm + meta-campaigns completing first
  const reconPayload = JSON.stringify({ date_from: fmt(mktFrom), date_to: fmt(now) });
  const [leadReconRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/etl/lead-reconciliation`, { method: "POST", headers, body: reconPayload }),
  ]);

  const outcome = (r: PromiseSettledResult<Response>) =>
    r.status === "fulfilled" && r.value.ok ? "ok" : "error";

  return NextResponse.json({
    status: "ok",
    date_from,
    date_to,
    results: {
      revenue:              outcome(revenueRes),
      zoho_spa:             outcome(spaRes),
      zoho_aesthetics:      outcome(aestheticsRes),
      crm_agents:           outcome(crmAgentsRes),
      ghl_crm:              outcome(ghlCrmRes),
      meta_campaigns:       outcome(metaCampaignsRes),
      google_campaigns:     outcome(googleCampaignsRes),
      klaviyo:              outcome(klaviyoRes),
      talexio_hr:           outcome(talexioHrRes),
      lead_reconciliation:  outcome(leadReconRes),
    },
  });
}
