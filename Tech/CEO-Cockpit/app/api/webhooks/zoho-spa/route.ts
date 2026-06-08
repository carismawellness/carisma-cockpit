import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (token !== process.env.ZOHO_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400 });
  }

  // Zoho webhook payload: top-level key is the entity type.
  // journalentry is included — Zoho sends journal webhook events with that key.
  const entity = (
    payload.invoice    ?? payload.bill        ?? payload.expense  ??
    payload.creditnote ?? payload.vendorcredit ?? payload.journalentry ?? payload.journal ?? {}
  ) as Record<string, string>;
  const txnDate = entity.date;

  let date_from: string, date_to: string;
  if (txnDate) {
    // Transaction event — re-sync just that month
    const [year, month] = txnDate.split("-").map(Number);
    date_from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    date_to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  } else {
    // Contact or unknown event (e.g. COA recode) — re-sync last 12 months
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    date_from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    date_to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // Derive the base URL from the incoming request so the ETL call always
  // targets the same deployment that received the webhook (avoids VERCEL_URL
  // pointing to a stale preview deployment).
  const base = new URL(req.url).origin;
  const body = JSON.stringify({ date_from, date_to, force: true });

  // Use after() so the ETL runs after the 200 response is sent but the
  // Vercel function instance is kept alive until it completes.
  // Previously this was fire-and-forget (no await, no waitUntil) which meant
  // Vercel could terminate the function before the ETL finished.
  after(async () => {
    await fetch(`${base}/api/etl/zoho-spa-transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  });

  return NextResponse.json({ received: true, month: date_from.slice(0, 7) }, { status: 200 });
}
