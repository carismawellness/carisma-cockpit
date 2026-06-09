import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { rootCauseSchema, checkRateLimit } from "@/lib/validations";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const ROOT_CAUSE_PROMPT = `You are Carisma Intelligence (CI). Given a metric that has deviated from its target, perform root cause analysis.
Consider common causes in the wellness/aesthetics industry: seasonality, staffing changes, marketing spend shifts, competitor activity, operational issues.
Provide 2-3 likely root causes ranked by probability, and suggest 1-2 actions for each.
Be specific and data-driven.`;

export async function POST(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  try {
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 5 requests per hour
    if (!checkRateLimit(`rootcause:${user.id}`, 5)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = rootCauseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { alertId, metric, value, target, department } = parsed.data;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: ROOT_CAUSE_PROMPT,
      messages: [
        {
          role: "user",
          content: `Department: ${department}\nMetric: ${metric}\nCurrent value: ${value}\nTarget: ${target ?? "N/A"}\n\nWhat are the likely root causes?`,
        },
      ],
    });

    const analysis = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Log to audit
    await serviceSupabase.from("ci_audit_log").insert({
      user_id: user.id,
      action: "root_cause_analysis",
      details: { alertId, metric, value, target, department },
    });

    return NextResponse.json({ analysis, alertId });
  } catch {
    return NextResponse.json(
      { error: "CI Root Cause analysis failed" },
      { status: 500 }
    );
  }
}
