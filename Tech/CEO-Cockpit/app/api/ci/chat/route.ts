import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { chatSchema, checkRateLimit } from "@/lib/validations";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are Carisma Intelligence (CI), the AI analytics assistant for Carisma Wellness Group.
You have access to the company's business data across three brands (Spa, Aesthetics, Slimming) and five departments (Marketing, Sales/CRM, Finance, HR, Operations).

When asked about data, generate a SQL query to answer the question. The database has these tables:
- sales_weekly (week_start, location_id, brand_id, revenue_ex_vat, retail_pct, addon_pct, hotel_capture_pct)
- sales_by_rep (date, staff_id, brand_id, revenue, bookings_count, deposit_pct)
- crm_daily (date, brand_id, total_leads, leads_meta, leads_crm, speed_to_lead_median_min, conversion_rate_pct, total_calls, outbound_calls, appointments_booked)
- crm_by_rep (date, staff_id, brand_id, calls_made, appointments_booked, conversions, conversion_rate_pct)
- marketing_daily (date, brand_id, platform, spend, leads, cpl, roas, ctr_pct)
- ga4_daily (date, brand_id, sessions, total_users, bounce_rate_pct, conversions)
- gsc_daily (date, brand_id, clicks, impressions, avg_position)
- klaviyo_campaigns (date, brand_id, campaign_name, sends, opens, revenue)
- ebitda_monthly (month, brand_id, revenue, ebitda, ebitda_margin_pct)
- budget_vs_actual (month, brand_id, department, budgeted, actual, variance_pct)
- hr_weekly (week_start, location_id, brand_id, hc_pct, utilization_pct, headcount)
- we360_daily (date, staff_id, productivity_pct)
- therapist_utilization (week_start, staff_id, location_id, utilization_pct, bookings_count)
- operations_weekly (week_start, location_id, brand_id, google_reviews_avg, complaints_count)
- consult_funnel (week_start, brand_id, consults_booked, consults_attended, showup_pct, conversion_pct, aov)
- brands (id, slug, name)
- locations (id, brand_id, slug, name)
- staff (id, name, role, brand_id)

KPI Targets: Spa CPL <EUR8, Aes CPL <EUR12, Slim CPL <USD10, ROAS >5.0, Conversion >25%, HC% <40%, Utilization >75%, Speed to Lead <5min.

Always be specific with numbers. Reference targets when relevant. Be concise but thorough.
When you generate SQL, wrap it in <sql> tags so it can be extracted and executed.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

async function loadChatHistory(userId: string): Promise<ChatMessage[]> {
  const serviceSupabase = getAdminClient();
  const { data } = await serviceSupabase
    .from("ci_chat_history")
    .select("role, message")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return [];

  // Reverse to chronological order
  return data.reverse().map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.message,
  }));
}

export async function POST(request: NextRequest) {
  const serviceSupabase = getAdminClient();
  try {
    // Authenticate the user via session cookie
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit: 20 requests per hour
    if (!checkRateLimit(user.id, 20)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { message } = parsed.data;

    // Save the user's message to chat history
    await serviceSupabase.from("ci_chat_history").insert({
      user_id: user.id,
      role: "user",
      message,
    });

    // Load last 20 messages for conversation context
    const history = await loadChatHistory(user.id);

    // Build messages array: history already includes the just-saved user message
    const conversationMessages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // First call: may produce SQL or direct answer
    const firstResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: conversationMessages,
    });

    const firstText = firstResponse.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("");

    const sqlMatch = firstText.match(/<sql>([\s\S]*?)<\/sql>/);
    let queryResult: unknown = null;
    let sqlQuery: string | null = null;

    if (sqlMatch) {
      sqlQuery = sqlMatch[1].trim();
      try {
        const { data, error } = await serviceSupabase.rpc(
          "execute_readonly_query",
          { query_text: sqlQuery }
        );
        if (!error) {
          queryResult = data;
        }
      } catch {
        // SQL execution failed
      }
    }

    // If we have query results, stream the interpretation response
    // If no SQL was needed, stream the original response
    if (queryResult) {
      // Build interpretation messages (non-streamed tool loop already done)
      const interpretMessages: Anthropic.MessageParam[] = [
        ...conversationMessages,
        {
          role: "assistant",
          content: `I queried the database and got: ${JSON.stringify(queryResult)}`,
        },
        {
          role: "user",
          content: "Now interpret these results specifically and concisely.",
        },
      ];

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: interpretMessages,
      });

      return createStreamResponse(stream, user.id, sqlQuery, queryResult);
    }

    // No SQL needed — check if we can stream the first response directly
    // Since we already have the full first response, just stream it as-is
    // (Re-request with streaming for a true streaming experience)
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: conversationMessages,
    });

    return createStreamResponse(stream, user.id, sqlQuery, queryResult);
  } catch {
    return NextResponse.json({ error: "CI Chat failed" }, { status: 500 });
  }
}

function createStreamResponse(
  stream: ReturnType<typeof anthropic.messages.stream>,
  userId: string,
  sqlQuery: string | null,
  queryResult: unknown
): Response {
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const serviceSupabase = getAdminClient();
      try {
        let fullText = "";

        // Send sql_query metadata upfront if available
        if (sqlQuery) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ sql_query: sqlQuery })}\n\n`
            )
          );
        }

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullText += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          }
        }

        // Save assistant response to chat history
        await serviceSupabase.from("ci_chat_history").insert({
          user_id: userId,
          role: "assistant",
          message: fullText,
          sql_query: sqlQuery,
          context: queryResult ? { data: queryResult } : null,
        });

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Stream failed" })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
