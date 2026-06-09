/**
 * GET /api/crm/individual?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns per-agent CRM KPI data aggregated over the requested date range.
 * Reads from Supabase `crm_agent_daily` table (populated by Tools/sync_crm_agents_to_supabase.py).
 *
 * Response shape:
 * {
 *   agents: {
 *     slug: string;
 *     name: string;
 *     rows: CrmAgentRow[];       // raw daily rows, sorted by date asc
 *     totals: AgentTotals;
 *   }[];   // sorted by total_sales DESC
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ── Agent config ──────────────────────────────────────────────────────────────

const AGENT_NAMES: Record<string, string> = {
  adeel:    "Adeel",
  rana:     "Rana",
  abid:     "Abid",
  km:       "K&M",
  vj:       "VJ",
  dorianne: "Dorianne",
  juliana:  "Juliana",
  anni:     "Anni",
  nicci:    "Nicci",
  nathalia: "Nathalia",
  april:    "April",
  queenee:  "Queenee",
};

const AGENT_ORDER = [
  "adeel", "rana", "abid", "km", "vj",
  "dorianne", "juliana", "anni", "nicci", "nathalia", "april", "queenee",
];

// ── Types ─────────────────────────────────────────────────────────────────────

type CrmAgentRow = {
  id: number;
  agent_slug: string;
  date: string;
  lc_sales: number;
  lc_messages: number;
  lc_booked: number;
  lc_deposit: number;
  crm_sales: number;
  crm_messages: number;
  crm_booked: number;
  crm_deposit: number;
  other_sales: number;
  other_messages: number;
  other_booked: number;
  other_deposit: number;
  total_messages: number;
  total_booked: number;
  total_deposit_count: number;
  conversion_rate_pct: number;
  total_sales: number;
  deposit_pct: number;
  aov: number;
  etl_synced_at: string;
};

type AgentTotals = {
  total_sales: number;
  avg_conversion_rate: number;
  avg_deposit_pct: number;
  avg_aov: number;
  total_bookings: number;
  total_messages: number;
  active_days: number;
};

type AgentResult = {
  slug: string;
  name: string;
  rows: CrmAgentRow[];
  totals: AgentTotals;
};

// ── Aggregation helpers ───────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function computeTotals(rows: CrmAgentRow[]): AgentTotals {
  // Active days: days where the agent had any sales or bookings
  const activeDays = rows.filter(
    (r) => r.total_sales > 0 || r.total_booked > 0
  );

  const total_sales    = rows.reduce((s, r) => s + (r.total_sales    ?? 0), 0);
  const total_bookings = rows.reduce((s, r) => s + (r.total_booked   ?? 0), 0);
  const total_messages = rows.reduce((s, r) => s + (r.total_messages ?? 0), 0);

  // Averages over active days only, excluding zero values
  const nonZeroConversion = activeDays
    .map((r) => r.conversion_rate_pct ?? 0)
    .filter((v) => v > 0);

  const nonZeroDeposit = activeDays
    .map((r) => r.deposit_pct ?? 0)
    .filter((v) => v > 0);

  const nonZeroAov = activeDays
    .map((r) => r.aov ?? 0)
    .filter((v) => v > 0);

  return {
    total_sales:         +total_sales.toFixed(2),
    avg_conversion_rate: +avg(nonZeroConversion).toFixed(2),
    avg_deposit_pct:     +avg(nonZeroDeposit).toFixed(2),
    avg_aov:             +avg(nonZeroAov).toFixed(2),
    total_bookings,
    total_messages,
    active_days:         activeDays.length,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "Query params 'from' and 'to' (YYYY-MM-DD) are required." },
      { status: 400 }
    );
  }

  // Validate date format
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to)) {
    return NextResponse.json(
      { error: "Dates must be in YYYY-MM-DD format." },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase environment variables not configured." },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all rows for the date range across all agents
  const { data, error } = await supabase
    .from("crm_agent_daily")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `Supabase query failed: ${error.message}` },
      { status: 500 }
    );
  }

  const allRows = (data ?? []) as CrmAgentRow[];

  // Group rows by agent slug
  const rowsBySlug = new Map<string, CrmAgentRow[]>();
  for (const row of allRows) {
    const slug = row.agent_slug;
    if (!rowsBySlug.has(slug)) rowsBySlug.set(slug, []);
    rowsBySlug.get(slug)!.push(row);
  }

  // Build one result per agent in AGENT_ORDER, then sort by total_sales DESC
  const agents: AgentResult[] = AGENT_ORDER.map((slug) => {
    const rows   = rowsBySlug.get(slug) ?? [];
    const totals = computeTotals(rows);
    return {
      slug,
      name:   AGENT_NAMES[slug] ?? slug,
      rows,
      totals,
    };
  });

  agents.sort((a, b) => b.totals.total_sales - a.totals.total_sales);

  return NextResponse.json({ agents });
}
