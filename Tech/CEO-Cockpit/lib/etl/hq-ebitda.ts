import { ZohoBooksClient } from "./zoho-client";
import { upsert, select } from "./supabase-etl";
import { fetchPlAccounts } from "./zoho-pl-parser";

// ── CoA map loader ────────────────────────────────────────────────────────────
// HQ has its own zoho_org='hq' mapping in Supabase.
// Falls back to name-based detection for any unmapped accounts.

export async function loadHqCoaMap(): Promise<Record<string, [string, string]>> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const qs   = new URLSearchParams({
    select:        "account_code,ebitda_line,coa_split_rules(rule_type,config)",
    zoho_org:      "eq.hq",
    ebitda_line:   "not.is.null",
    split_rule_id: "not.is.null",
  });
  const resp = await fetch(`${base}/rest/v1/zoho_coa_mapping?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`Failed to load HQ CoA: ${resp.status}`);
  const data = await resp.json() as Record<string, unknown>[];

  const result: Record<string, [string, string]> = {};
  for (const row of data) {
    const code = String(row.account_code ?? "").trim();
    const line = row.ebitda_line as string;
    if (line === "excluded") { result[code] = ["excluded", "excluded"]; continue; }
    result[code] = ["hq", line];
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
    coaMap?: Record<string, [string, string]>;
    fromDateOverride?: string;
    toDateOverride?: string;
    tagId?: string;
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

  const coaMap = opts.coaMap ?? {};
  if (!Object.keys(coaMap).length) {
    log.push(`${monthKey}: HQ CoA map is empty — sync accounts on the HQ tab in COA Mapping first`);
    return { rowsUpserted: 0, log };
  }

  // Fetch full SPA org P&L (no tag filter). Only accounts present in the HQ CoA map
  // are processed — everything else is ignored. This avoids needing Zoho tag option IDs
  // and gives the user control via the COA Mapping UI.
  log.push(`${monthKey}: fetching full SPA P&L from Zoho Books (${Object.keys(coaMap).length} HQ-mapped accounts)…`);
  const rawAccounts = await fetchPlAccounts(client, fromDate, toDate);
  if (!rawAccounts.length) {
    log.push(`${monthKey}: no HQ-tagged accounts returned`);
    return { rowsUpserted: 0, log };
  }

  const BASE_LINES = new Set(["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"]);
  const totals: Record<string, number> = {
    revenue: 0, cogs: 0, wages: 0, advertising: 0, rent: 0, utilities: 0, sga: 0,
  };

  for (const acc of rawAccounts) {
    if (acc.amount === 0) continue;
    // Only process accounts explicitly mapped in the HQ CoA map
    if (!(acc.code in coaMap)) continue;
    const [, mappedLine] = coaMap[acc.code];
    if (mappedLine === "excluded") continue;
    let line = mappedLine;
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
