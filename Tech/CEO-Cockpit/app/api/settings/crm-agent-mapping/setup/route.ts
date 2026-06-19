/**
 * POST /api/settings/crm-agent-mapping/setup
 *
 * Idempotent seed: upserts the canonical agent roster. Safe to call multiple
 * times — uses ON CONFLICT (agent_slug) DO UPDATE so stale rows get corrected.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export const SEED_AGENTS = [
  // ── Spa ──────────────────────────────────────────────────────────────
  { agent_slug: "vj",       display_name: "VJ",       position: "sdr",  brand_slug: "spa",        is_active: true  },
  { agent_slug: "juliana",  display_name: "Juliana",  position: "sdr",  brand_slug: "spa",        is_active: true  },
  { agent_slug: "km",       display_name: "K&M",      position: "chat", brand_slug: "spa",        is_active: true  },
  // ── Aesthetics ───────────────────────────────────────────────────────
  { agent_slug: "april",    display_name: "April",    position: "sdr",  brand_slug: "aesthetics", is_active: true  },
  { agent_slug: "nathalia", display_name: "Nathalia", position: "sdr",  brand_slug: "aesthetics", is_active: true  },
  { agent_slug: "rana",     display_name: "Rana",     position: "chat", brand_slug: "aesthetics", is_active: true  },
  { agent_slug: "rey",      display_name: "Rey",      position: "sdr",  brand_slug: "aesthetics", is_active: true  },
  // ── Slimming ─────────────────────────────────────────────────────────
  { agent_slug: "dorianne", display_name: "Dorianne", position: "sdr",  brand_slug: "slimming",   is_active: true  },
  { agent_slug: "queenee",  display_name: "Queenee",  position: "sdr",  brand_slug: "slimming",   is_active: true  },
  { agent_slug: "abid",     display_name: "Abid",     position: "chat", brand_slug: "slimming",   is_active: true  },
  // ── Inactive / former ────────────────────────────────────────────────
  { agent_slug: "anni",     display_name: "Anni",     position: "sdr",  brand_slug: null,         is_active: false },
  { agent_slug: "nicci",    display_name: "Nicci",    position: "sdr",  brand_slug: null,         is_active: false },
  { agent_slug: "adeel",    display_name: "Adeel",    position: "chat", brand_slug: null,         is_active: false },
] as const;

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error: checkErr } = await supabase
    .from("crm_agent_mapping")
    .select("id", { count: "exact", head: true });

  if (checkErr && checkErr.code === "PGRST205") {
    return NextResponse.json({
      ok: false,
      message: "crm_agent_mapping table does not exist. Run migration 067_create_crm_agent_mapping.sql in the Supabase SQL editor first.",
    }, { status: 503 });
  }

  if (checkErr) {
    return NextResponse.json({ ok: false, error: checkErr.message }, { status: 500 });
  }

  const { error: upsertErr } = await supabase
    .from("crm_agent_mapping")
    .upsert(SEED_AGENTS, { onConflict: "agent_slug", ignoreDuplicates: false });

  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  const { data: agents } = await supabase
    .from("crm_agent_mapping")
    .select("agent_slug, display_name, position, brand_slug, is_active")
    .order("is_active", { ascending: false })
    .order("position", { ascending: false })
    .order("brand_slug", { ascending: true, nullsFirst: false })
    .order("display_name");

  return NextResponse.json({ ok: true, agents });
}
