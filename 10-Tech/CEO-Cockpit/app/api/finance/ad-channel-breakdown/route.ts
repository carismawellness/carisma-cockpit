/**
 * GET /api/finance/ad-channel-breakdown?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *
 * Returns advertising spend split by channel (Meta/Google/Klaviyo/Misc)
 * sourced from transactions_raw (which has contact_name = "Meta", "Google" etc).
 *
 * Since transactions_raw has no venue column for advertising, returns brand-level
 * channel totals and shares. The EBITDA page applies these shares proportionally
 * to each venue's advertising total to produce per-venue per-channel figures.
 *
 * Response:
 *   channelTotals: { Meta, Google, Klaviyo, Misc }   — absolute amounts
 *   channelShares: { Meta, Google, Klaviyo, Misc }   — 0-1 fractions of total
 *   grandTotal:    number
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CHANNEL_PATTERNS: Array<{ patterns: string[]; channel: string }> = [
  { patterns: ["meta", "facebook", "instagram", "whatsapp"], channel: "Meta" },
  { patterns: ["google", "youtube"],                          channel: "Google" },
  { patterns: ["klaviyo"],                                   channel: "Klaviyo" },
];

function resolveChannel(contact: string): string {
  const lower = (contact || "").toLowerCase();
  for (const { patterns, channel } of CHANNEL_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) return channel;
  }
  return "Misc";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to required" }, { status: 400 });
  }

  try {
    const supabase = getAdminClient();

    // Fetch advertising transactions from transactions_raw
    const { data: rows, error } = await supabase
      .from("transactions_raw")
      .select("contact_name, amount")
      .eq("ebitda_line", "advertising")
      .gte("date", dateFrom)
      .lte("date", dateTo);

    if (error) throw new Error(error.message);

    // Aggregate by channel
    const channelTotals: Record<string, number> = { Meta: 0, Google: 0, Klaviyo: 0, Misc: 0 };
    for (const row of rows ?? []) {
      const ch = resolveChannel(row.contact_name ?? "");
      channelTotals[ch] = (channelTotals[ch] ?? 0) + Number(row.amount ?? 0);
    }

    const grandTotal = Object.values(channelTotals).reduce((a, b) => a + b, 0);
    const channelShares: Record<string, number> = {};
    for (const [ch, amt] of Object.entries(channelTotals)) {
      channelShares[ch] = grandTotal > 0 ? amt / grandTotal : 0;
    }

    return NextResponse.json({ channelTotals, channelShares, grandTotal, date_from: dateFrom, date_to: dateTo });
  } catch (e) {
    return NextResponse.json(
      { error: `ad-channel-breakdown failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
