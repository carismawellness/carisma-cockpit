/**
 * POST /api/etl/crm-agents
 *
 * Syncs all 12 agent tabs from the CRM Master Google Sheet into Supabase
 * crm_agent_daily. Idempotent — uses ON CONFLICT DO UPDATE.
 *
 * Called by the nightly cron at /api/cron/nightly-refresh.
 * Can also be triggered manually: POST {} (no body required).
 *
 * HOW THIS STAYS AUTH-FREE FOREVER
 * --------------------------------
 * Data is fetched via the public CSV export endpoint, one URL per agent tab:
 *   https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}
 *
 * NO OAuth. NO refresh tokens. NO Vercel env-var ceremony when a token expires.
 * Requirement: the CRM Master Sheet stays shared as "Anyone with link can view"
 * (URL has a 44-char random id — unguessable).
 *
 * NEVER replace this with the Google Sheets API (v4) — that path needs OAuth
 * and broke production silently on 2026-06-09 when the refresh token expired.
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ETLLogger } from "@/lib/etl/etl-logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ── CRM Master Sheet config ──────────────────────────────────────────────────

const SPREADSHEET_ID = "1bHF_7bXic08pcyXQhq310zG6McqXD50oT0EuVkjzDdI";

// [slug, tabName (for logs/errors), gid (for CSV export URL)]
const AGENTS: [string, string, string][] = [
  ["adeel",    "Adeel",    "1319375977"],
  ["rana",     "Rana",     "942691187"],
  ["abid",     "Abid",     "1013922515"],
  ["km",       "K&M",      "416594585"],
  ["vj",       "VJ",       "1072221139"],
  ["dorianne", "Dorianne", "1663601718"],
  ["juliana",  "Juliana",  "396160365"],
  ["anni",     "Anni",     "1807577352"],
  ["nicci",    "Nicci",    "2054161680"],
  ["nathalia", "Nathalia", "1658710608"],
  ["april",    "April",    "1955992165"],
  ["rey",      "Rey",      "992572180"],
  ["queenee",  "Queenee",  "703206369"],
];

// Agents whose source sheet uses the SDR layout (Outbound / Inbound / Chat,
// columns A–U). Verified by reading each tab's header row 2026-06-10.
//   Chat layout: abid, rana, km, adeel
//   SDR layout:  everyone else
const SDR_AGENTS = new Set([
  "vj", "nicci", "dorianne", "juliana", "anni", "april", "rey", "queenee", "nathalia",
]);
const CHUNK_SIZE = 200;

// ── CSV fetch (public sheet — no auth) ───────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

async function fetchSheetTab(gid: string, tabName: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { redirect: "follow" });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`CSV fetch failed for tab "${tabName}" (gid=${gid}): ${resp.status} — ${text.slice(0, 200)}. Check that the sheet is shared "Anyone with link can view".`);
  }

  const text  = await resp.text();
  return text.split("\n").filter(l => l.length > 0).map(parseCSVRow);
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

const PG_INT_MAX = 2_147_483_647; // PostgreSQL integer max (2^31 - 1)

function parseInteger(val: string): number {
  const v = val.replace(/[^\d]/g, "");
  if (!v) return 0;
  const n = parseInt(v, 10) || 0;
  // Guard against corrupted cells (e.g. a phone number accidentally in a dial-count cell).
  // Values above PG_INT_MAX would cause "out of range for type integer" upsert errors.
  return Math.min(n, PG_INT_MAX);
}

function parsePercent(val: string): number {
  const v = val.replace("%", "").trim();
  if (!v) return 0;
  return parseFloat(v) || 0;
}

function parseDate(val: string): string | null {
  const v = val.trim();
  if (!v || v.toLowerCase() === "date") return null;
  // CRM sheet has mixed date formats:
  //   • Older rows entered as text strings — M/D/YYYY (US), e.g. "4/14/2026"
  //   • Newer rows auto-formatted by Sheets — D/M/YYYY (Malta locale),
  //     e.g. "27/8/2027" (Google's CSV export honours the sheet's locale)
  // Strategy: parse as M/D first; if month > 12, swap to D/M.
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, d] = m;
  const y = m[3];
  const year = y.length === 2 ? `20${y}` : y;
  if (parseInt(mo, 10) > 12) {
    [mo, d] = [d, mo]; // value was D/M/YYYY — swap
  }
  if (parseInt(mo, 10) > 12 || parseInt(d, 10) > 31) return null;
  const iso = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  // Reject dates more than 14 days in the future — guards against 2-digit year typos
  // (e.g. "29" → 2029) and copy-paste errors that produce far-future rows.
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14)
    .toISOString().slice(0, 10);
  if (iso > cutoff) return null;
  return iso;
}

// ── Row builders ──────────────────────────────────────────────────────────────

type CrmRow = {
  agent_slug:          string;
  date:                string;
  booking_eff_pct:     number;
  booking_rate_pct:    number;
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
  talk_time_outbound:  number;
  talk_time_inbound:   number;
  talk_time_total:     number;
};

function buildChatRow(slug: string, date: string, row: string[]): CrmRow {
  return {
    agent_slug:          slug,
    date,
    booking_eff_pct:     0,
    booking_rate_pct:    0,
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
    talk_time_outbound:  0,
    talk_time_inbound:   0,
    talk_time_total:     0,
  };
}

function buildSdrRow(slug: string, date: string, row: string[]): CrmRow {
  // SDR sheets after Talk Time column insertion: columns A–Z (26 cols)
  //   A=Date | B=Out Sales | C=Out Dials | D=Out Answered
  //   E=Out Talk Time (NEW) | F=Out Booked | G=Out Dep
  //   H=Booking Eff | I=Booking Rate
  //   J=In Sales | K=In Recv
  //   L=In Talk Time (NEW) | M=In Booked | N=In Dep
  //   O=Chat Sales | P=Chat Convs | Q=Chat Booked | R=Chat Dep
  //   S=Tot Sales | T=Tot Booked | U=Tot Dep
  //   V=Tot Talk Time (NEW) | W=Rate | X=Dials | Y=Dep% | Z=AOV
  const outDials  = parseInteger(cell(row, 2));   // C
  const inRecv    = parseInteger(cell(row, 10));  // K (was 9)
  const chatConvs = parseInteger(cell(row, 15));  // P (was 13)
  return {
    agent_slug:          slug,
    date,
    booking_eff_pct:     parsePercent(cell(row, 7)),   // H (was 6)
    booking_rate_pct:    parsePercent(cell(row, 8)),   // I (was 7)
    lc_sales:            parseCurrency(cell(row, 14)), // O (was 12)
    lc_messages:         chatConvs,                    // P (was 13)
    lc_booked:           parseInteger(cell(row, 16)),  // Q (was 14)
    lc_deposit:          parseInteger(cell(row, 17)),  // R (was 15)
    crm_sales:           parseCurrency(cell(row, 9)),  // J (was 8)
    crm_messages:        inRecv,                       // K (was 9 → 10 but inRecv already updated)
    crm_booked:          parseInteger(cell(row, 12)),  // M (was 10)
    crm_deposit:         parseInteger(cell(row, 13)),  // N (was 11)
    other_sales:         parseCurrency(cell(row, 1)),  // B
    other_messages:      outDials,                     // C
    other_booked:        parseInteger(cell(row, 5)),   // F (was 4)
    other_deposit:       parseInteger(cell(row, 6)),   // G (was 5)
    total_messages:      Math.min(outDials + inRecv + chatConvs, PG_INT_MAX),
    total_booked:        parseInteger(cell(row, 19)),  // T (was 17)
    total_deposit_count: parseInteger(cell(row, 20)),  // U (was 18)
    conversion_rate_pct: parsePercent(cell(row, 22)),  // W (was 19)
    total_sales:         parseCurrency(cell(row, 18)), // S (was 16)
    deposit_pct:         parsePercent(cell(row, 24)),  // Y (was 21)
    aov:                 parseCurrency(cell(row, 25)), // Z (was 22)
    talk_time_outbound:  parseInteger(cell(row, 4)),   // E (NEW)
    talk_time_inbound:   parseInteger(cell(row, 11)),  // L (NEW)
    talk_time_total:     parseInteger(cell(row, 21)),  // V (NEW)
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

  const logger = new ETLLogger("crm_agents");
  await logger.start();

  const log: string[] = [];
  let totalRows = 0;
  const errors: string[] = [];

  for (const [slug, tabName, gid] of AGENTS) {
    try {
      const raw = await fetchSheetTab(gid, tabName);
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

  if (errors.length === AGENTS.length) await logger.fail(errors.join(" | ").slice(0, 500));
  else                                 await logger.complete(totalRows);

  const status = errors.length === 0 ? "ok" : "partial";
  return NextResponse.json({
    status,
    total_rows: totalRows,
    agents_synced: AGENTS.length - errors.length,
    errors: errors.length > 0 ? errors : undefined,
    log: log.join("\n"),
  }, { status: errors.length === AGENTS.length ? 500 : 200 });
}
