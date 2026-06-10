/**
 * GET  /api/settings/crm-agent-mapping   — list all agents
 * PUT  /api/settings/crm-agent-mapping   — upsert one agent row
 *      body: { agent_slug, display_name, position, brand_slug, is_active }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export type AgentMappingRow = {
  id:           number;
  agent_slug:   string;
  display_name: string;
  position:     "sdr" | "chat";
  brand_slug:   "spa" | "aesthetics" | "slimming" | null;
  is_active:    boolean;
};

export async function GET() {
  const { data, error } = await supabase()
    .from("crm_agent_mapping")
    .select("id, agent_slug, display_name, position, brand_slug, is_active")
    .order("position", { ascending: false })  // sdr first
    .order("brand_slug", { ascending: true, nullsFirst: false })
    .order("display_name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agents: data as AgentMappingRow[] });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.agent_slug) {
    return NextResponse.json({ error: "agent_slug required" }, { status: 400 });
  }

  const { agent_slug, display_name, position, brand_slug, is_active } = body;

  const { data, error } = await supabase()
    .from("crm_agent_mapping")
    .upsert(
      { agent_slug, display_name, position, brand_slug: brand_slug ?? null, is_active: is_active ?? true, updated_at: new Date().toISOString() },
      { onConflict: "agent_slug" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}
