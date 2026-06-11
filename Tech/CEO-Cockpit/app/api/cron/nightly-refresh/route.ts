import { NextRequest, NextResponse } from "next/server";
import { runTokenCanary, type CanaryResult } from "@/lib/etl/token-canary";
import { sendEtlFailureAlert, type EtlFailure } from "@/lib/alerts/etl-alerts";
import { fetchLatestSuccesses, computeStaleness } from "@/lib/etl/staleness";

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

  // Phase 0: token-health canary — exercises every credential (Zoho, Google
  // Sheets, Talexio, Klaviyo, GHL, Meta) BEFORE the ETLs run, so an expired
  // refresh token (invalid_grant) is caught tonight, not days later.
  // runTokenCanary never throws and is hard time-boxed per check.
  let canary: CanaryResult[] = [];
  try {
    canary = await runTokenCanary({ record: true });
  } catch (err) {
    console.error("[Cron] token canary crashed (continuing):", err);
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
  // NOTE: google-reviews fails until GOOGLE_PLACES_API_KEY is set — harmless,
  // Promise.allSettled keeps one failing job from breaking the others.
  // attendance-daily: backfill the last 2 days (yesterday + today) each night
  const attendanceFrom = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const attendanceTo   = today;

  // Current month param for therapist shifts (e.g. "2026-06")
  const currentMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  const [revenueRes, spaRes, aestheticsRes, crmAgentsRes, ghlCrmRes,
         metaCampaignsRes, googleCampaignsRes, klaviyoRes, klaviyoFlowsRes, talexioHrRes, we360Res,
         googleReviewsRes, diligenceAuditRes, brandStandardsRes, gscRes,
         attendanceDailyRes, therapistShiftsRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/etl/revenue-refresh`,              { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/zoho-spa-transactions`,        { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/zoho-aesthetics-transactions`, { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/crm-agents`,                   { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/ghl-crm`,                      { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/meta-campaigns`,               { method: "POST", headers, body: mktPayload }),
    fetch(`${BASE_URL}/api/etl/google-campaigns`,             { method: "POST", headers, body: mktPayload }),
    fetch(`${BASE_URL}/api/etl/klaviyo-sync`,                 { method: "POST", headers, body: klaviyoPayload }),
    fetch(`${BASE_URL}/api/etl/klaviyo-flows-sync`,           { method: "POST", headers, body: JSON.stringify({ date: today }) }),
    fetch(`${BASE_URL}/api/etl/talexio-hr?date=${today}`,     { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/we360`,                        { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/google-reviews`,               { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/diligence-audit`,              { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/brand-standards`,              { method: "POST", headers }),
    fetch(`${BASE_URL}/api/etl/gsc-sync`,                     { method: "POST", headers, body: "{}" }),
    fetch(`${BASE_URL}/api/etl/attendance-daily?dateFrom=${attendanceFrom}&dateTo=${attendanceTo}`, { method: "POST", headers }),
    // Therapist shift hours for RevPAH denominator (current month only)
    fetch(`${BASE_URL}/api/etl/therapist-shifts-monthly?month=${currentMonth}`, { method: "POST", headers }),
  ]);

  // Phase 2: lead reconciliation depends on ghl-crm + meta-campaigns completing first
  const reconPayload = JSON.stringify({ date_from: fmt(mktFrom), date_to: fmt(now) });
  const [leadReconRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/etl/lead-reconciliation`, { method: "POST", headers, body: reconPayload }),
  ]);

  const outcome = (r: PromiseSettledResult<Response>) =>
    r.status === "fulfilled" && r.value.ok ? "ok" : "error";

  // Extract a useful error message from a settled fetch result.
  const describeError = async (r: PromiseSettledResult<Response>): Promise<string | null> => {
    if (r.status === "rejected") return String(r.reason).slice(0, 400);
    if (r.value.ok) return null;
    let detail = "";
    try { detail = (await r.value.text()).slice(0, 300); } catch { /* body unreadable */ }
    return `HTTP ${r.value.status}${detail ? ` — ${detail}` : ""}`;
  };

  const namedResults: Array<[string, PromiseSettledResult<Response>]> = [
    ["revenue",             revenueRes],
    ["zoho_spa",            spaRes],
    ["zoho_aesthetics",     aestheticsRes],
    ["crm_agents",          crmAgentsRes],
    ["ghl_crm",             ghlCrmRes],
    ["meta_campaigns",      metaCampaignsRes],
    ["google_campaigns",    googleCampaignsRes],
    ["klaviyo",             klaviyoRes],
    ["klaviyo_flows",       klaviyoFlowsRes],
    ["talexio_hr",          talexioHrRes],
    ["we360",               we360Res],
    ["google_reviews",      googleReviewsRes],
    ["diligence_audit",     diligenceAuditRes],
    ["brand_standards",     brandStandardsRes],
    ["gsc_keywords",        gscRes],
    ["attendance_daily",        attendanceDailyRes],
    ["therapist_shifts_monthly", therapistShiftsRes],
    ["lead_reconciliation",     leadReconRes],
  ];

  // ── Consolidated failure alerting (never breaks the cron) ──────────────────
  let alertSent = false;
  const failures: EtlFailure[] = [];
  try {
    // 1. ETL fan-out failures (with error detail where available)
    for (const [source, res] of namedResults) {
      const err = await describeError(res);
      if (err) failures.push({ source, error: err });
    }

    // 2. Token canary failures
    for (const c of canary.filter(c => !c.ok)) {
      failures.push({ source: `token-canary: ${c.service}`, error: c.error ?? "unknown error" });
    }

    // 3. Staleness — sources whose last success predates the previous expected
    //    run (catches ETLs that stopped being called entirely). Checked AFTER
    //    tonight's ETLs so a healthy run never self-reports as stale.
    const staleness = computeStaleness(await fetchLatestSuccesses());
    for (const s of staleness.filter(s => s.stale)) {
      // The canary's own failures are already reported directly above.
      if (s.source === "token_canary") continue;
      // Avoid double-reporting a source that already failed tonight.
      if (failures.some(f => f.source === s.source)) continue;
      failures.push({
        source: s.source,
        error:  s.lastSuccessAt
          ? `stale — last successful sync ${s.ageHours}h ago (expected every ${s.expectedCadenceHours}h)`
          : `stale — no successful sync ever recorded (log key "${s.log_key}")`,
      });
    }

    if (failures.length > 0) {
      const alert = await sendEtlFailureAlert(failures);
      alertSent = alert.sent;
    }
  } catch (err) {
    console.error("[Cron] alerting failed (cron unaffected):", err);
  }

  return NextResponse.json({
    status: "ok",
    date_from,
    date_to,
    results: Object.fromEntries(namedResults.map(([name, r]) => [name, outcome(r)])),
    canary,
    failures,
    alert_sent: alertSent,
  });
}
