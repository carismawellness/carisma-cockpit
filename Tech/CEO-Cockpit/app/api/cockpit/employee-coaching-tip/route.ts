// /api/cockpit/employee-coaching-tip
// GET ?slug=&brand=&from=&to=&commission_total=&retail_revenue=&avg_ticket=&active_days=&prev_commission_total=
//
// Returns a daily AI coaching tip for the employee.
// First checks Supabase cache (today's tip). If stale/missing, calls Claude Haiku
// to generate a new one, caches it, and returns it.
// Degrades gracefully to rule-based tips if Anthropic API is unavailable.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

function fallbackTip(
  commissionTotal: number,
  retailRevenue: number,
  avgTicket: number,
  prevCommissionTotal?: number,
): string {
  if (prevCommissionTotal && commissionTotal > prevCommissionTotal * 1.1) {
    return `Strong momentum — up ${((commissionTotal / prevCommissionTotal - 1) * 100).toFixed(0)}% vs last period. Keep the same energy through the end of the month.`;
  }
  if (retailRevenue >= 640) {
    return `Retail at €${retailRevenue.toFixed(0)} — €${(800 - retailRevenue).toFixed(0)} from your €100 bonus. One targeted recommendation per client today could get you there.`;
  }
  if (avgTicket < 75) {
    return `Average ticket at €${avgTicket.toFixed(0)} — adding a scalp treatment or express add-on to 2 bookings a day can push this above €90 and meaningfully lift your commission.`;
  }
  return `Consistent €${avgTicket.toFixed(0)} average ticket — clients trust your recommendations. Today, focus on one premium service upgrade per appointment to compound that trust into earnings.`;
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const slug = p.get("slug") ?? "";
  const brand = p.get("brand") ?? "spa";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  const commissionTotal = Number(p.get("commission_total") ?? 0);
  const retailRevenue = Number(p.get("retail_revenue") ?? 0);
  const avgTicket = Number(p.get("avg_ticket") ?? 0);
  const activeDays = Number(p.get("active_days") ?? 0);
  const prevCommissionTotal = p.get("prev_commission_total")
    ? Number(p.get("prev_commission_total"))
    : undefined;

  if (!slug) return NextResponse.json({ tip: fallbackTip(commissionTotal, retailRevenue, avgTicket, prevCommissionTotal) });

  const db = getAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Check cache first
  try {
    const { data: cached } = await db
      .from("employee_daily_tip")
      .select("tip_text")
      .eq("slug", slug)
      .eq("brand", brand)
      .gte("generated_at", `${today}T00:00:00Z`)
      .lt("generated_at", `${today}T23:59:59Z`)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.tip_text) {
      return NextResponse.json({ tip: cached.tip_text });
    }
  } catch (_e) {
    // Table may not exist yet — skip cache, generate tip
  }

  // Generate tip with Claude Haiku
  let tip: string;
  try {
    const pctChange = prevCommissionTotal && prevCommissionTotal > 0
      ? `${((commissionTotal / prevCommissionTotal - 1) * 100).toFixed(1)}%`
      : "N/A";
    const direction = prevCommissionTotal
      ? commissionTotal >= prevCommissionTotal ? "up" : "down"
      : "unknown";

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `You are Sarah, a high-performance coach for spa therapists in Malta. Generate ONE specific, encouraging coaching insight (1-2 short sentences max) based on this therapist's current performance. Be direct, warm, and reference their actual numbers. Never start with "I" or "You". Never use bullet points or markdown.

Performance:
- Commission this period: €${commissionTotal.toFixed(2)}
- Retail revenue: €${retailRevenue.toFixed(2)} (target: €800)
- Average ticket: €${avgTicket.toFixed(2)}
- Active days: ${activeDays}
- vs last period: ${direction} ${pctChange}

Generate exactly one or two short sentences. Be specific to these numbers.`,
      }],
    });

    const content = message.content[0];
    tip = content.type === "text" ? content.text.trim() : fallbackTip(commissionTotal, retailRevenue, avgTicket, prevCommissionTotal);
  } catch (_e) {
    tip = fallbackTip(commissionTotal, retailRevenue, avgTicket, prevCommissionTotal);
  }

  // Cache the tip (best-effort — if table doesn't exist, just return the tip)
  try {
    await db.from("employee_daily_tip").upsert({
      slug,
      brand,
      tip_text: tip,
      generated_at: new Date().toISOString(),
      period_from: from || null,
      period_to: to || null,
    }, { onConflict: "slug, brand, (generated_at::date)" });
  } catch (_e) {
    // Ignore — migration may not be applied yet
  }

  return NextResponse.json({ tip });
}
