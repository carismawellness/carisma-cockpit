import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { fetchPlAccounts } from "./zoho-pl-parser";

// ── HQ tag option ID discovery ────────────────────────────────────────────────
// Fetches Zoho reporting tags and finds the numeric option ID for the "HQ" option.
// This replaces the old ZOHO_BOOKS_HQ_TAG_ID env var — no manual config needed.

async function getHqTagOptionId(client: ZohoBooksClient): Promise<string | null> {
  try {
    // Step 1: list all tag groups — tag_options here is a comma-separated string
    const list = await client.get("settings/tags", {}) as {
      reporting_tags?: Array<{ tag_id: string; tag_options?: string }>;
      tags?:           Array<{ tag_id: string; tag_options?: string }>;
    };
    const groups = list.reporting_tags ?? list.tags ?? [];
    const group = groups.find(t =>
      (t.tag_options ?? "").split(",").map(s => s.trim().toLowerCase()).includes("hq")
    );
    if (!group) return null;

    // Step 2: fetch the specific tag group to get individual option IDs
    const detail = await client.get(`settings/tags/${group.tag_id}`, {}) as {
      tag?: { tag_options?: Array<{ tag_option_id: string; value: string }> };
    };
    const option = (detail.tag?.tag_options ?? []).find(
      o => o.value.trim().toLowerCase() === "hq"
    );
    return option?.tag_option_id ?? null;
  } catch {
    return null;
  }
}

// ── CoA map loader ────────────────────────────────────────────────────────────
// Reads EBITDA line assignments from the SPA COA mapping.
// Split rules are not needed here — Zoho tag filtering already scopes the amounts to HQ.

export async function loadHqCoaMap(): Promise<Record<string, string>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({
    select:      "account_code,ebitda_line",
    zoho_org:    "eq.spa",
    ebitda_line: "not.is.null",
  });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to load HQ CoA: ${resp.status}`);
  const data = await resp.json() as { account_code: string; ebitda_line: string }[];

  const result: Record<string, string> = {};
  for (const row of data) {
    const code = String(row.account_code ?? "").trim();
    if (row.ebitda_line && row.ebitda_line !== "excluded") result[code] = row.ebitda_line;
  }
  return result;
}

// ── Idempotency check ─────────────────────────────────────────────────────────

async function monthAlreadySynced(monthKey: string): Promise<boolean> {
  try { return (await select("hq_ebitda_monthly", { month: monthKey })).length > 0; }
  catch { return false; }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }

// ── Core month runner ─────────────────────────────────────────────────────────

export async function runHqEbitdaMonth(
  client: ZohoBooksClient,
  year: number,
  month: number,
  opts: {
    force?: boolean;
    coaMap?: Record<string, string>;
    fromDateOverride?: string;
    toDateOverride?: string;
  } = {},
): Promise<{ rowsUpserted: number; log: string[] }> {
  const log: string[] = [];
  const monthDays = daysInMonth(year, month);
  const fromDate  = opts.fromDateOverride ?? `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate    = opts.toDateOverride   ?? `${year}-${String(month).padStart(2, "0")}-${String(monthDays).padStart(2, "0")}`;
  const monthKey  = `${year}-${String(month).padStart(2, "0")}-01`;

  if (!opts.force && await monthAlreadySynced(monthKey)) {
    log.push(`${monthKey}: cached — skipping`);
    return { rowsUpserted: 0, log };
  }

  // Discover the HQ tag option ID from Zoho at runtime
  const tagOptionId = await getHqTagOptionId(client);
  if (!tagOptionId) {
    log.push(`${monthKey}: could not find 'HQ' reporting tag option in Zoho — ensure the HQ tag exists under Settings > Reporting Tags in Zoho Books`);
    return { rowsUpserted: 0, log };
  }
  log.push(`${monthKey}: HQ tag option ID = ${tagOptionId}`);

  const coaMap = opts.coaMap ?? {};
  log.push(`${monthKey}: fetching HQ-tagged P&L from Zoho Books…`);
  const rawAccounts = await fetchPlAccounts(client, fromDate, toDate, tagOptionId);
  if (!rawAccounts.length) {
    log.push(`${monthKey}: no HQ-tagged transactions found`);
    return { rowsUpserted: 0, log };
  }

  const BASE_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);
  const totals: Record<string, number> = {
    revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0,
  };

  for (const acc of rawAccounts) {
    if (acc.amount === 0) continue;
    // Use COA map for EBITDA line; fall back to section-based detection
    let line = coaMap[acc.code] ?? (acc.section === "income" ? "revenue" : "sga");
    if (line.startsWith("sga_")) line = "sga";
    if (!BASE_LINES.has(line)) continue;
    totals[line] += acc.amount;
  }

  const nowTs = new Date().toISOString();
  const row = {
    month:          monthKey,
    revenue:        +totals.revenue.toFixed(2),
    cogs:           +totals.cogs.toFixed(2),
    wages:          +totals.wages.toFixed(2),
    advertising:    +totals.advertising.toFixed(2),
    rent:           +totals.rent.toFixed(2),
    utilities:      +totals.utilities.toFixed(2),
    sga:            +totals.sga.toFixed(2),
    zoho_synced_at: nowTs,
  };

  const n = await upsert("hq_ebitda_monthly", [row as Record<string, unknown>], "month");
  log.push(`${monthKey}: ${n} rows upserted`);
  return { rowsUpserted: n, log };
}
