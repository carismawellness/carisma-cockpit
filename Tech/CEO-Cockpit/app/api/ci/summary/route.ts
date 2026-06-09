import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadTargets, formatTargetsForPrompt } from "@/lib/utils/lookups";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/* ------------------------------------------------------------------ */
/* POST /api/ci/summary                                                */
/* Generates a weekly executive summary using LLM + dynamic targets.   */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  try {
    // ---- Auth --------------------------------------------------------
    const cronSecret = request.headers.get("x-cron-secret");
    const expectedSecret =
      process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!cronSecret || cronSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ---- Dynamic targets --------------------------------------------
    const targets = await loadTargets();
    const targetsBlock = formatTargetsForPrompt(targets);

    // ---- Pull recent alerts -----------------------------------------
    const { data: alerts } = await serviceSupabase
      .from("ci_alerts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    // ---- Pull last 7 days of key metrics ----------------------------
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateFrom = sevenDaysAgo.toISOString().split("T")[0];
    const dateTo = now.toISOString().split("T")[0];

    const [marketingRes, crmRes, salesRes] = await Promise.all([
      serviceSupabase
        .from("marketing_daily")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo),
      serviceSupabase
        .from("crm_daily")
        .select("*")
        .gte("date", dateFrom)
        .lte("date", dateTo),
      serviceSupabase
        .from("sales_weekly")
        .select("*")
        .gte("week_start", dateFrom)
        .lte("week_start", dateTo),
    ]);

    const SUMMARY_PROMPT = `You are Carisma Intelligence (CI), the AI executive assistant for Carisma Wellness Group.
Generate a concise weekly executive summary for the CEO.

Compare against targets:
${targetsBlock}

Recent alerts (last 50):
${JSON.stringify(alerts || [], null, 2)}

Marketing data (last 7 days):
${JSON.stringify(marketingRes.data || [], null, 2)}

CRM data (last 7 days):
${JSON.stringify(crmRes.data || [], null, 2)}

Sales data (last week):
${JSON.stringify(salesRes.data || [], null, 2)}

Structure:
1. **Top-line**: Revenue, leads, conversions (1-2 sentences)
2. **Wins**: What exceeded targets
3. **Risks**: What missed targets or trending poorly
4. **Actions**: 3-5 recommended next steps

Be specific with numbers. Keep it under 500 words.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: SUMMARY_PROMPT }],
    });

    const summary = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Persist summary
    await serviceSupabase.from("ci_summaries").insert({
      summary,
      period_from: dateFrom,
      period_to: dateTo,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[ci/summary] error:", err);
    return NextResponse.json(
      { error: "Summary generation failed" },
      { status: 500 },
    );
  }
}
