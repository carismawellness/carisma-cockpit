/**
 * POST /api/settings/crm-agent-mapping/setup
 *
 * One-time idempotent migration: creates crm_agent_mapping table and seeds
 * the initial agent roster. Safe to call multiple times — uses IF NOT EXISTS
 * and ON CONFLICT DO NOTHING.
 *
 * Requires the Supabase service role key to be set (server-side only).
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SEED_AGENTS = [
  { agent_slug: "juliana",  display_name: "Juliana",  position: "sdr",  brand_slug: "spa"        },
  { agent_slug: "vj",       display_name: "VJ",       position: "sdr",  brand_slug: "spa"        },
  { agent_slug: "april",    display_name: "April",    position: "sdr",  brand_slug: "aesthetics" },
  { agent_slug: "dorianne", display_name: "Dorianne", position: "sdr",  brand_slug: "slimming"   },
  { agent_slug: "queenee",  display_name: "Queenee",  position: "sdr",  brand_slug: "slimming"   },
  { agent_slug: "anni",     display_name: "Anni",     position: "sdr",  brand_slug: null         },
  { agent_slug: "nicci",    display_name: "Nicci",    position: "sdr",  brand_slug: null         },
  { agent_slug: "nathalia", display_name: "Nathalia", position: "sdr",  brand_slug: null         },
  { agent_slug: "adeel",    display_name: "Adeel",    position: "chat", brand_slug: null         },
  { agent_slug: "rana",     display_name: "Rana",     position: "chat", brand_slug: null         },
  { agent_slug: "abid",     display_name: "Abid",     position: "chat", brand_slug: null         },
  { agent_slug: "km",       display_name: "K&M",      position: "chat", brand_slug: null         },
];

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Check if table already exists by attempting a count query
  const { error: checkErr } = await supabase
    .from("crm_agent_mapping")
    .select("id", { count: "exact", head: true });

  if (checkErr && checkErr.code === "PGRST205") {
    // Table doesn't exist — need to run SQL migration via Supabase dashboard
    return NextResponse.json({
      ok: false,
      message: "crm_agent_mapping table does not exist. Run migration 067_create_crm_agent_mapping.sql in the Supabase SQL editor, then call this endpoint again.",
    }, { status: 503 });
  }

  if (checkErr) {
    return NextResponse.json({ ok: false, error: checkErr.message }, { status: 500 });
  }

  // Table exists — upsert seed data
  const { error: upsertErr } = await supabase
    .from("crm_agent_mapping")
    .upsert(SEED_AGENTS, { onConflict: "agent_slug", ignoreDuplicates: true });

  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  const { data: agents } = await supabase
    .from("crm_agent_mapping")
    .select("agent_slug, position, brand_slug")
    .order("position", { ascending: false })
    .order("agent_slug");

  return NextResponse.json({ ok: true, agents });
}
