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
  const contact  = req.nextUrl.searchParams.get("contact");
  const subLine  = req.nextUrl.searchParams.get("sub_line");
  const org      = req.nextUrl.searchParams.get("org") ?? "spa";
  const dateFrom = req.nextUrl.searchParams.get("date_from");
  const dateTo   = req.nextUrl.searchParams.get("date_to");

  const params: string[] = [
    `org=eq.${org}`,
    `select=date,contact_name,account_name,account_code,ebitda_line,ebitda_sub_line,amount,venue`,
    `order=date.desc`,
    `limit=200`,
  ];
  if (contact)  params.push(`contact_name=ilike.*${contact}*`);
  if (subLine)  params.push(`ebitda_sub_line=eq.${subLine}`);
  if (dateFrom) params.push(`date=gte.${dateFrom}`);
  if (dateTo)   params.push(`date=lte.${dateTo}`);

  const resp = await fetch(`${sbUrl("transactions_raw")}?${params.join("&")}`, { headers: sbHeaders() });
  if (!resp.ok) return NextResponse.json({ error: await resp.text() }, { status: 500 });
  const rows = await resp.json() as { contact_name: string; account_name: string; amount: number; venue: string; ebitda_sub_line: string }[];

  // Summarise by contact for quick overview
  const byContact: Record<string, { total: number; venues: Set<string>; account_names: Set<string> }> = {};
  for (const r of rows) {
    const k = r.contact_name || "(no contact)";
    if (!byContact[k]) byContact[k] = { total: 0, venues: new Set(), account_names: new Set() };
    byContact[k].total += r.amount;
    byContact[k].venues.add(r.venue);
    byContact[k].account_names.add(r.account_name);
  }
  const summary = Object.entries(byContact)
    .map(([contact_name, v]) => ({ contact_name, total: +v.total.toFixed(2), venues: [...v.venues], account_names: [...v.account_names] }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({ count: rows.length, summary, rows });
}
