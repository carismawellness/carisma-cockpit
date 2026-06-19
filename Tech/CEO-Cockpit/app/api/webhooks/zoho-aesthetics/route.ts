import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

export const maxDuration = 60;

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

  const entity = (
    payload.invoice    ?? payload.bill        ?? payload.expense  ??
    payload.creditnote ?? payload.vendorcredit ?? payload.journalentry ?? payload.journal ?? {}
  ) as Record<string, string>;
  const txnDate = entity.date;

  let date_from: string, date_to: string;
  if (txnDate) {
    const [year, month] = txnDate.split("-").map(Number);
    date_from = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    date_to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  } else {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    date_from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    date_to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  const base = new URL(req.url).origin;
  const body = JSON.stringify({ date_from, date_to, force: true });

  // Forward the cron secret so the gated /api/etl/* route accepts this
  // server-to-server call (it carries no session cookies).
  const etlHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CRON_SECRET) etlHeaders["Authorization"] = `Bearer ${process.env.CRON_SECRET}`;

  after(async () => {
    await fetch(`${base}/api/etl/zoho-aesthetics-transactions`, {
      method: "POST",
      headers: etlHeaders,
      body,
    });
  });

  return NextResponse.json({ received: true, month: date_from.slice(0, 7) }, { status: 200 });
}
