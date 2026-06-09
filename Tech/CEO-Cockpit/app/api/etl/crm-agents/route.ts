/**
 * POST /api/etl/crm-agents
 *
 * Syncs all 12 agent tabs from the CRM Master Google Sheet into Supabase
 * crm_agent_daily. Idempotent — uses ON CONFLICT DO UPDATE.
 *
 * Called by the nightly cron at /api/cron/nightly-refresh.
 * Can also be triggered manually: POST {} (no body required).
 *
 * Required env vars (set in Vercel dashboard):
 *   GOOGLE_SHEETS_REFRESH_TOKEN  — from ~/.go-google-mcp/token.json
 *   GOOGLE_SHEETS_CLIENT_ID      — from ~/.go-google-mcp/client_secrets.json
 *   GOOGLE_SHEETS_CLIENT_SECRET  — from ~/.go-google-mcp/client_secrets.json
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ── Google Sheets config ──────────────────────────────────────────────────────

const SPREADSHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

const AGENTS: [string, string][] = [
  ["adeel",    "Adeel"],
  ["rana",     "Rana"],
  ["abid",     "Abid"],
  ["km",       "K&M"],
  ["vj",       "VJ"],
  ["dorianne", "Dorianne"],
  ["juliana",  "Juliana"],
  ["anni",     "Anni"],
  ["nicci",    "Nicci"],
  ["nathalia", "Nathalia"],
  ["april",    "April"],
  ["queenee",  "Queenee"],
];

const SDR_AGENTS = new Set(["nathalia"]);
const CHUNK_SIZE = 200;

// ── Google OAuth ──────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const refreshToken  = process.env.GOOGLE_SHEETS_REFRESH_TOKEN;
  const clientId      = process.env.GOOGLE_SHEETS_CLIENT_ID;
  const clientSecret  = process.env.GOOGLE_SHEETS_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_SHEETS_REFRESH_TOKEN, GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET"
    );
  }

  const resp = await fetch(GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token refresh failed: ${resp.status} — ${text}`);
  }

  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

async function fetchSheetTab(
  accessToken: string,
  tabName: string
): Promise<string[][]> {
  const encoded = encodeURIComponent(tabName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encoded}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets API error for tab "${tabName}": ${resp.status} — ${text}`);
  }

  const data = await resp.json() as { values?: string[][] };
  return data.values ?? [];
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function cell(row: string[], idx: number): string {
  return (idx < row.length ? row[idx] : "").trim();
}

function parseCurrency(val: string): number {
  const v = val.replace(/[€,\s]/g, "");
  if (!v) return 0;
  return parseFloat(v) || 0;
}

function parseInteger(val: string): number {
  const v = val.replace(/[^\d]/g, "");
  if (!v) return 0;
  return parseInt(v, 10) || 0;
}

function parsePercent(val: string): number {
  const v = val.replace("%", "").trim();
  if (!v) return 0;
  return parseFloat(v) || 0;
}

function parseDate(val: string): string | null {
  const v = val.trim();
  if (!v || v.toLowerCase() === "date") return null;
  // CRM sheet uses M/D/YYYY (US format), e.g. "4/14/2026"
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ── Row builders ──────────────────────────────────────────────────────────────

type CrmRow = {
  agent_slug:          string;
  date:                string;
  lc_sales:            number;
  lc_messages:         number;
  lc_booked:           number;
  lc_deposit:          number;
  crm_sales:           number;
  crm_messages:        number;
  crm_booked:          number;
  crm_deposit:         number;
  other_sales:         number;
  other_messages:      number;
  other_booked:        number;
  other_deposit:       number;
  total_messages:      number;
  total_booked:        number;
  total_deposit_count: number;
  conversion_rate_pct: number;
  total_sales:         number;
  deposit_pct:         number;
  aov:                 number;
};

function buildChatRow(slug: string, date: string, row: string[]): CrmRow {
  return {
    agent_slug:          slug,
    date,
    lc_sales:            parseCurrency(cell(row, 1)),
    lc_messages:         parseInteger(cell(row, 2)),
    lc_booked:           parseInteger(cell(row, 3)),
    lc_deposit:          parseInteger(cell(row, 4)),
    crm_sales:           parseCurrency(cell(row, 5)),
    crm_messages:        parseInteger(cell(row, 6)),
    crm_booked:          parseInteger(cell(row, 7)),
    crm_deposit:         parseInteger(cell(row, 8)),
    other_sales:         parseCurrency(cell(row, 9)),
    other_messages:      parseInteger(cell(row, 10)),
    other_booked:        parseInteger(cell(row, 11)),
    other_deposit:       parseInteger(cell(row, 12)),
    total_messages:      parseInteger(cell(row, 13)),
    total_booked:        parseInteger(cell(row, 14)),
    total_deposit_count: parseInteger(cell(row, 15)),
    conversion_rate_pct: parsePercent(cell(row, 16)),
    total_sales:         parseCurrency(cell(row, 17)),
    deposit_pct:         parsePercent(cell(row, 18)),
    aov:                 parseCurrency(cell(row, 19)),
  };
}

function buildSdrRow(slug: string, date: string, row: string[]): CrmRow {
  // Nathalia: Outbound→other, Inbound→crm, Chat→lc
  return {
    agent_slug:          slug,
    date,
    lc_sales:            parseCurrency(cell(row, 10)),
    lc_messages:         parseInteger(cell(row, 11)),
    lc_booked:           parseInteger(cell(row, 12)),
    lc_deposit:          parseInteger(cell(row, 13)),
    crm_sales:           parseCurrency(cell(row, 6)),
    crm_messages:        parseInteger(cell(row, 7)),
    crm_booked:          parseInteger(cell(row, 8)),
    crm_deposit:         parseInteger(cell(row, 9)),
    other_sales:         parseCurrency(cell(row, 1)),
    other_messages:      parseInteger(cell(row, 2)),
    other_booked:        parseInteger(cell(row, 4)),
    other_deposit:       parseInteger(cell(row, 5)),
    total_messages:      parseInteger(cell(row, 18)),
    total_booked:        parseInteger(cell(row, 15)),
    total_deposit_count: parseInteger(cell(row, 16)),
    conversion_rate_pct: parsePercent(cell(row, 17)),
    total_sales:         parseCurrency(cell(row, 14)),
    deposit_pct:         parsePercent(cell(row, 19)),
    aov:                 0,
  };
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

async function supabaseUpsert(
  supabaseUrl: string,
  supabaseKey: string,
  rows: CrmRow[]
): Promise<void> {
  if (!rows.length) return;

  const supabase = createClient(supabaseUrl, supabaseKey);

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("crm_agent_daily")
      .upsert(chunk, { onConflict: "agent_slug,date" });
    if (error) {
      throw new Error(
        `Supabase upsert error (chunk ${Math.floor(i / CHUNK_SIZE) + 1}): ${error.message}`
      );
    }
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Optional body (unused for now — always full sync)
  try { await req.json(); } catch { /* no body is fine */ }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 }
    );
  }

  const log: string[] = [];
  let totalRows = 0;
  const errors: string[] = [];

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
    log.push("Google OAuth token refreshed");
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  for (const [slug, tabName] of AGENTS) {
    try {
      const raw = await fetchSheetTab(accessToken, tabName);
      const isSdr = SDR_AGENTS.has(slug);

      const rowsByDate = new Map<string, CrmRow>();
      for (const row of raw.slice(2)) {
        const dateIso = parseDate(cell(row, 0));
        if (!dateIso) continue;
        const record = isSdr
          ? buildSdrRow(slug, dateIso, row)
          : buildChatRow(slug, dateIso, row);
        rowsByDate.set(dateIso, record);
      }

      const rows = Array.from(rowsByDate.values());
      await supabaseUpsert(supabaseUrl, supabaseKey, rows);

      log.push(`${slug}: ${rows.length} rows synced`);
      totalRows += rows.length;
    } catch (e) {
      const msg = `${slug}: ${String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  const status = errors.length === 0 ? "ok" : "partial";
  return NextResponse.json({
    status,
    total_rows: totalRows,
    agents_synced: AGENTS.length - errors.length,
    errors: errors.length > 0 ? errors : undefined,
    log: log.join("\n"),
  }, { status: errors.length === AGENTS.length ? 500 : 200 });
}
