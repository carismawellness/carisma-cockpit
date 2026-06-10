import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export async function POST(req: NextRequest) {
  let date_from: string, date_to: string, force = false;
  try {
    const body = await req.json();
    date_from = body.date_from;
    date_to   = body.date_to;
    force     = body.force === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!date_from || !date_to) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const payload = JSON.stringify({ date_from, date_to, force });
  const headers = { "Content-Type": "application/json" };

  const [cockpitRes, aestheticsRes, slimmingSalesRes, slimmingTxRes, spaEmpRes] = await Promise.allSettled([
    fetch(`${BASE_URL}/api/etl/cockpit-revenue`,        { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/aesthetics-sales`,     { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/slimming-sales`,       { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/slimming-treatments`,  { method: "POST", headers, body: payload }),
    fetch(`${BASE_URL}/api/etl/spa-services-by-employee`, { method: "POST", headers, body: payload }),
  ]);

  const outcome = (r: PromiseSettledResult<Response>) =>
    r.status === "fulfilled" && r.value.ok ? "ok" : "error";

  return NextResponse.json({
    status: "ok",
    results: {
      cockpit:              outcome(cockpitRes),
      aesthetics:         outcome(aestheticsRes),
      slimming_sales:     outcome(slimmingSalesRes),
      slimming_treatments: outcome(slimmingTxRes),
      spa_employees:      outcome(spaEmpRes),
    },
  });
}
