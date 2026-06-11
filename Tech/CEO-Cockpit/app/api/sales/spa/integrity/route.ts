/**
 * GET /api/sales/spa/integrity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Triangulates Spa revenue: live Cockpit Datasheet CSV vs Supabase
 * spa_revenue_daily aggregate. Returns an ok/warn/error status with the
 * underlying numbers so the dashboard can render a verification badge.
 *
 * Why this exists: numbers have moved between renders in the past (VAT
 * convention churn, ETL drift). With this endpoint the page can prove on
 * every load that what it's displaying matches the source-of-truth sheet.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cockpitCsvUrl, COCKPIT_TABS } from "@/lib/constants/cockpit-sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VAT_RATE = 0.18;

// ── CSV helpers (mirror cockpit-revenue.ts / spa-analytics) ─────────────────

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

async function fetchCockpitCsv(gid: string): Promise<Record<string, string>[]> {
  const url  = cockpitCsvUrl(gid);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Cockpit fetch failed: ${resp.status}`);
  const text  = await resp.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const nonEmpty = parseCSVRow(lines[i]).filter((c) => c.trim()).length;
    if (nonEmpty >= 3) { headerIdx = i; break; }
  }
  const headers = parseCSVRow(lines[headerIdx]);
  return lines.slice(headerIdx + 1).map((line) => {
    const cells = parseCSVRow(line);
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

const MONTH_NAMES: Record<string, number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11,
  jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

function parseCockpitDate(raw: string): Date | null {
  raw = raw.trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const mo = MONTH_NAMES[dmy[2].toLowerCase()];
    if (mo !== undefined) return new Date(+dmy[3], mo, +dmy[1]);
  }
  for (const fmt of [
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(+y, +m - 1, +d); },
    (s: string) => { const [d, m, y] = s.split("/"); return new Date(2000 + +y, +m - 1, +d); },
    (s: string) => new Date(s),
  ]) {
    try { const d = fmt(raw); if (!isNaN(d.getTime())) return d; } catch { /* */ }
  }
  return null;
}

function stripCol(row: Record<string, string>, key: string): string {
  return (row[key] ?? row[`${key} `] ?? "").trim();
}

function safeFloat(val: string): number {
  return parseFloat(String(val).replace(/,/g, "").trim() || "0") || 0;
}

// ── Triangulation ───────────────────────────────────────────────────────────

// Status semantics:
//   ok          — source ≈ stored within band; numbers are trustworthy.
//   pending     — source > stored (sheet ahead of Supabase by > band). Expected
//                 between ETL runs — the nightly cron writes Supabase from the
//                 sheet, so fresh rows sit on the sheet until the next run.
//                 NOT a failure; numbers are accurate up to the last ETL.
//   warn        — stored > source by a small amount (≤ warn band). Unusual —
//                 could be a sheet deletion since last ETL or a small
//                 round-trip discrepancy worth keeping an eye on.
//   error       — stored > source by a lot, or any direction beyond warn band
//                 AND the last ETL is stale (> 36h). Investigate.
type Status = "ok" | "pending" | "warn" | "error";

interface Check {
  name:         string;
  status:       Status;
  source_total: number;  // live Cockpit CSV, inc-VAT
  stored_total: number;  // spa_revenue_daily, inc-VAT
  diff:         number;  // source - stored (positive = sheet ahead)
  diff_pct:     number;
  source_rows:  number;
  stored_rows:  number;  // daily aggregate rows in Supabase (NOT line items)
  note?:        string;
}

// Drift bands. Tight because we expect bit-exact agreement post-migration 073.
const OK_PCT   = 0.5;   // ≤ 0.5% drift = ✓
const WARN_PCT = 5;     // > OK_PCT, ≤ this = ⚠ when stored > source (or stale ETL)
const STALE_ETL_HOURS = 36;

function classify(diff: number, diffPct: number, etlAgeHours: number | null): Status {
  const abs = Math.abs(diffPct);
  if (abs <= OK_PCT) return "ok";

  const etlStale = etlAgeHours !== null && etlAgeHours > STALE_ETL_HOURS;

  // Sheet ahead of Supabase = expected ETL lag, not a failure.
  if (diff > 0) {
    // Unless the last ETL is stale — then it's actually drift worth flagging.
    if (etlStale && abs > WARN_PCT) return "error";
    if (etlStale)                  return "warn";
    return "pending";
  }

  // Supabase ahead of sheet = unusual. Could be sheet edits/deletions since
  // the last ETL, or a real bug in the sync.
  if (abs <= WARN_PCT) return "warn";
  return "error";
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");
    if (!fromStr || !toStr) {
      return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
    }
    const fromDate = new Date(fromStr);
    const toDate   = new Date(toStr);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    // ── Source A: live Cockpit Service-Spa CSV ───────────────────────────
    const [servicesCsv, retailCsv] = await Promise.all([
      fetchCockpitCsv(COCKPIT_TABS.SPA_SERVICES.gid),
      fetchCockpitCsv(COCKPIT_TABS.SPA_RETAIL.gid),
    ]);

    let sourceServicesTotal = 0;
    let sourceServicesRows  = 0;
    for (const row of servicesCsv) {
      if (!["Given", "Unplanned"].includes(stripCol(row, "Status"))) continue;
      const d = parseCockpitDate(stripCol(row, "Service Date"));
      if (!d || d < fromDate || d > toDate) continue;
      const unitPriceInc = safeFloat(stripCol(row, "Unit Price"));
      sourceServicesTotal += unitPriceInc;       // already inc-VAT
      sourceServicesRows++;
    }

    let sourceRetailTotal = 0;
    let sourceRetailRows  = 0;
    for (const row of retailCsv) {
      const d = parseCockpitDate(stripCol(row, "Date"));
      if (!d || d < fromDate || d > toDate) continue;
      const amountEx = safeFloat(stripCol(row, "VAT Exclusive Amount") || stripCol(row, "VAT Exclusive Amount "));
      sourceRetailTotal += amountEx * (1 + VAT_RATE);  // → inc-VAT
      sourceRetailRows++;
    }

    // ── Source B: Supabase spa_revenue_daily aggregate ───────────────────
    const supabase = await createServerSupabaseClient();
    const { data: rows, error } = await supabase
      .from("spa_revenue_daily")
      .select("services, product_phytomer, product_purest, product_other, lapis_synced_at")
      .gte("date", fromStr)
      .lte("date", toStr);
    if (error) {
      return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    }

    let storedServicesTotal = 0;
    let storedRetailTotal   = 0;
    let lastSync: string | null = null;
    for (const r of rows ?? []) {
      storedServicesTotal += (r.services ?? 0);
      storedRetailTotal   += (r.product_phytomer ?? 0) + (r.product_purest ?? 0) + (r.product_other ?? 0);
      if (r.lapis_synced_at && (!lastSync || r.lapis_synced_at > lastSync)) {
        lastSync = r.lapis_synced_at as string;
      }
    }

    // ── Build checks ─────────────────────────────────────────────────────
    const etlAgeHours = hoursSince(lastSync);

    const mkCheck = (
      name: string,
      src: number,
      stored: number,
      srcRows: number,
      storedRows: number,
    ): Check => {
      const diff = src - stored;
      const diffPct = src > 0 ? (Math.abs(diff) / src) * 100 : (stored > 0 ? 100 : 0);
      return {
        name,
        status: classify(diff, diffPct, etlAgeHours),
        source_total: Math.round(src),
        stored_total: Math.round(stored),
        diff:         Math.round(diff),
        diff_pct:     +diffPct.toFixed(2),
        source_rows:  srcRows,
        stored_rows:  storedRows,
      };
    };

    const servicesCheck = mkCheck(
      "Spa services",
      sourceServicesTotal,
      storedServicesTotal,
      sourceServicesRows,
      (rows ?? []).filter((r) => (r.services ?? 0) > 0).length,
    );
    const retailCheck = mkCheck(
      "Spa retail",
      sourceRetailTotal,
      storedRetailTotal,
      sourceRetailRows,
      (rows ?? []).filter((r) => ((r.product_phytomer ?? 0) + (r.product_purest ?? 0) + (r.product_other ?? 0)) > 0).length,
    );
    const totalCheck = mkCheck(
      "Spa total (services + retail)",
      sourceServicesTotal + sourceRetailTotal,
      storedServicesTotal + storedRetailTotal,
      sourceServicesRows + sourceRetailRows,
      rows?.length ?? 0,
    );

    // Direction-aware notes (status already encodes severity; this is just
    // human-readable colour).
    const etlAgeStr = etlAgeHours !== null
      ? etlAgeHours < 1 ? `${Math.round(etlAgeHours * 60)}m ago`
      : etlAgeHours < 24 ? `${Math.round(etlAgeHours)}h ago`
      : `${Math.round(etlAgeHours / 24)}d ago`
      : "never";

    const annotateDir = (c: Check) => {
      if (c.status === "ok") return;
      if (c.diff > 0)        c.note = `Sheet has €${Math.round(Math.abs(c.diff)).toLocaleString()} more than Supabase — likely fresh rows pending the next ETL (last ETL ${etlAgeStr}).`;
      if (c.diff < 0)        c.note = `Supabase has €${Math.round(Math.abs(c.diff)).toLocaleString()} more than the sheet — possible sheet edit or deletion since last ETL (${etlAgeStr}).`;
    };
    [servicesCheck, retailCheck, totalCheck].forEach(annotateDir);

    // Severity order for the overall badge.
    const rank: Record<Status, number> = { ok: 0, pending: 1, warn: 2, error: 3 };
    const overall: Status = [servicesCheck, retailCheck, totalCheck]
      .reduce<Status>((worst, c) => rank[c.status] > rank[worst] ? c.status : worst, "ok");

    return NextResponse.json({
      overall,
      checks: [servicesCheck, retailCheck, totalCheck],
      last_sync_at: lastSync,
      generated_at: new Date().toISOString(),
      methodology: {
        sources: {
          A: `Live Cockpit Datasheet CSV (${COCKPIT_TABS.SPA_SERVICES.name} + ${COCKPIT_TABS.SPA_RETAIL.name})`,
          B: "Supabase spa_revenue_daily (post-migration 073, inc-VAT)",
        },
        bands: { ok_pct: OK_PCT, warn_pct: WARN_PCT },
        notes: [
          "Services: sum 'Unit Price' (inc-VAT) where Status ∈ {Given, Unplanned}.",
          "Retail: sum 'VAT Exclusive Amount' × 1.18 → inc-VAT.",
          "Source > stored = sheet has rows not yet ETL'd; expected up to ~24h between runs.",
        ],
      },
    });
  } catch (e: unknown) {
    console.error("[api/sales/spa/integrity] error:", e);
    const msg = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
