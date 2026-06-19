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
import { fetchAll } from "@/lib/supabase/fetch-all";
import { isExcludedCrmDate } from "@/lib/constants/excluded-dates";

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
  booking_eff_pct: number;
  booking_rate_pct: number;
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
  talk_time_outbound: number;
  talk_time_inbound: number;
  talk_time_total: number;
};

type AgentTotals = {
  total_sales: number;
  avg_conversion_rate: number;
  avg_booking_eff: number;
  avg_booking_rate: number;
  avg_deposit_pct: number;
  avg_aov: number;
  total_bookings: number;
  total_deposits: number;
  total_messages: number;
  active_days: number;
  total_talk_time: number;
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

// Per-row total revenue derived from channel breakdown.
// The sheet's "Total Sales" column is often empty for SDR tabs, so always
// derive from lc + crm + other to guarantee a consistent number.
function rowRevenue(r: CrmAgentRow): number {
  const channelSum = (r.lc_sales ?? 0) + (r.crm_sales ?? 0) + (r.other_sales ?? 0);
  return channelSum > 0 ? channelSum : (r.total_sales ?? 0);
}

function computeTotals(rows: CrmAgentRow[]): AgentTotals {
  // Active days: days where the agent had any sales or bookings
  const activeDays = rows.filter(
    (r) => rowRevenue(r) > 0 || r.total_booked > 0
  );

  const total_sales     = rows.reduce((s, r) => s + rowRevenue(r),               0);
  const total_bookings  = rows.reduce((s, r) => s + (r.total_booked        ?? 0), 0);
  const total_deposits  = rows.reduce((s, r) => s + (r.total_deposit_count ?? 0), 0);
  const total_messages  = rows.reduce((s, r) => s + (r.total_messages      ?? 0), 0);
  const total_talk_time = rows.reduce((s, r) => s + (r.talk_time_total     ?? 0), 0);

  // Averages over active days only, excluding zero values
  const nonZeroConversion = activeDays
    .map((r) => r.conversion_rate_pct ?? 0)
    .filter((v) => v > 0);

  const nonZeroBookingEff = activeDays
    .map((r) => r.booking_eff_pct ?? 0)
    .filter((v) => v > 0);

  const nonZeroBookingRate = activeDays
    .map((r) => r.booking_rate_pct ?? 0)
    .filter((v) => v > 0);

  const nonZeroDeposit = activeDays
    .map((r) => r.deposit_pct ?? 0)
    .filter((v) => v > 0);

  // AOV: derived from actual revenue ÷ bookings for the period (the per-row
  // `aov` column is 0 for SDR tabs, so averaging it would always yield 0).
  const avg_aov = total_bookings > 0 ? total_sales / total_bookings : 0;

  return {
    total_sales:         +total_sales.toFixed(2),
    avg_conversion_rate: +avg(nonZeroConversion).toFixed(2),
    avg_booking_eff:     +avg(nonZeroBookingEff).toFixed(2),
    avg_booking_rate:    +avg(nonZeroBookingRate).toFixed(2),
    avg_deposit_pct:     +avg(nonZeroDeposit).toFixed(2),
    avg_aov:             +avg_aov.toFixed(2),
    total_bookings,
    total_deposits,
    total_messages,
    active_days:         activeDays.length,
    total_talk_time,
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

  // Fetch all rows for the date range across all agents — paginated to bypass PostgREST max_rows
  const fetched = await fetchAll(
    (off, lim) =>
      supabase
        .from("crm_agent_daily")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .range(off, off + lim - 1),
    "crm_agent_daily",
  ) as CrmAgentRow[];

  // Strip migration / quarantined dates so per-agent totals aren't biased.
  const allRows = fetched.filter((r) => !isExcludedCrmDate(r.date));

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
