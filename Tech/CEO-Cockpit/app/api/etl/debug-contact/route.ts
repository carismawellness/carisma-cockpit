import { NextRequest, NextResponse } from "next/server";

// GET /api/etl/debug-contact?contact=fresha&org=spa
// Temporary diagnostic: find all transactions_raw rows matching a contact name.
// Shows ebitda_line and ebitda_sub_line so we can diagnose mis-classification.

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}
function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

export async function GET(req: NextRequest) {
  const contact = req.nextUrl.searchParams.get("contact") ?? "fresha";
  const org     = req.nextUrl.searchParams.get("org")     ?? "spa";

  const filter = `org=eq.${org}&contact_name=ilike.*${contact}*&select=date,contact_name,account_name,account_code,ebitda_line,ebitda_sub_line,amount,venue&order=date.desc&limit=50`;
  const resp = await fetch(`${sbUrl("transactions_raw")}?${filter}`, { headers: sbHeaders() });
  if (!resp.ok) return NextResponse.json({ error: await resp.text() }, { status: 500 });
  const rows = await resp.json();
  return NextResponse.json({ count: (rows as unknown[]).length, rows });
}
