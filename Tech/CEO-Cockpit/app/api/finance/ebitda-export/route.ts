/**
 * /api/finance/ebitda-export
 *
 * Server-side proxy that:
 *   1. Calls /api/finance/ebitda-aggregated to fetch the EBITDA snapshot for
 *      the requested date window (including totals + fallback metadata).
 *   2. Wraps it in the payload shape that the Apps Script `ebitda_export`
 *      handler (writeEbitdaExportTab) expects.
 *   3. Base64-encodes the payload and POSTs it to the Apps Script Web App
 *      with the shared token, which inserts a timestamped tab in the
 *      Accounting Master sheet.
 *
 * Keeps the Apps Script token server-side; the browser only sees the
 * resulting tab name / URL.
 */

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbwU345ph3xkGH7cHQWze7wm1Bepyr-2ATFYpFnusRbGgjIGtVLIDBC_jL6NT1McJksN/exec";
const APPS_SCRIPT_TOKEN = "cbk-ebida-a7f3e91c2d";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function handle(req: NextRequest) {
  const dateFrom = req.nextUrl.searchParams.get("date_from") ?? "";
  const dateTo   = req.nextUrl.searchParams.get("date_to")   ?? "";

  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) {
    return NextResponse.json(
      { ok: false, error: "date_from and date_to must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  // 1) Build the aggregated snapshot by calling our own route. Using the
  //    request's own origin keeps this working on Vercel, preview deploys,
  //    and localhost without env vars.
  const origin = req.nextUrl.origin;
  const aggUrl = `${origin}/api/finance/ebitda-aggregated?date_from=${dateFrom}&date_to=${dateTo}`;
  const aggRes = await fetch(aggUrl, { method: "GET", cache: "no-store" });
  const aggJson = await aggRes.json().catch(() => null);
  if (!aggRes.ok || !aggJson) {
    return NextResponse.json(
      { ok: false, error: `Failed to fetch aggregated data: HTTP ${aggRes.status}` },
      { status: 502 },
    );
  }

  // 2) Build the export payload shape writeEbitdaExportTab expects.
  const payload = {
    date_from:        aggJson.date_from ?? dateFrom,
    date_to:          aggJson.date_to   ?? dateTo,
    generated_at:     new Date().toISOString(),
    brands:           aggJson.brands     ?? [],
    categories:       aggJson.categories ?? [],
    totals:           aggJson.totals     ?? {},
    fallback_applied: aggJson.fallback_applied ?? [],
  };

  // 3) Base64-encode (URL-safe is unnecessary; Apps Script base64Decode handles
  //    standard alphabet) and POST to Apps Script. POST body keeps us under
  //    any URL-length limits for big fallback_applied arrays.
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  // Apps Script Web Apps accept x-www-form-urlencoded POSTs and merge into
  // e.parameter, so the same `p.action === "ebitda_export"` branch fires.
  const form = new URLSearchParams();
  form.set("token",   APPS_SCRIPT_TOKEN);
  form.set("action",  "ebitda_export");
  form.set("payload", b64);

  const gsRes = await fetch(APPS_SCRIPT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    form.toString(),
    redirect: "follow",
  });

  const text = await gsRes.text();
  let gsJson: { ok?: boolean; tab_url?: string; error?: string } | null = null;
  try { gsJson = JSON.parse(text); } catch { /* leave null */ }

  if (!gsRes.ok || !gsJson || gsJson.error) {
    return NextResponse.json(
      {
        ok:    false,
        error: gsJson?.error ?? `Apps Script HTTP ${gsRes.status}`,
        raw:   text.slice(0, 500),
      },
      { status: 502 },
    );
  }

  // Single canonical tab — the Apps Script always overwrites "EBITDA
  // Export". Show the period in the toast so the user knows which window
  // they just snapshotted.
  const tabUrl = gsJson.tab_url ?? "";
  const tab = `EBITDA Export · ${payload.date_from} → ${payload.date_to}`;

  return NextResponse.json({ ok: true, tab, tab_url: tabUrl });
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }
