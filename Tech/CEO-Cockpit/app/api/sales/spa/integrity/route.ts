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

type Status = "ok" | "warn" | "error";

interface Check {
  name:         string;
  status:       Status;
  source_total: number;  // live Cockpit CSV, inc-VAT
  stored_total: number;  // spa_revenue_daily, inc-VAT
  diff:         number;  // source - stored
  diff_pct:     number;
  source_rows:  number;
  stored_rows:  number;
  note?:        string;
}

// Drift bands. Tight because we expect bit-exact agreement post-migration 073.
const OK_PCT   = 0.5;   // ≤ 0.5% drift = ✓
const WARN_PCT = 5;     // ≤ 5% drift = ⚠
                        //  > 5% = ❌

function classify(diffPct: number): Status {
  const abs = Math.abs(diffPct);
  if (abs <= OK_PCT)   return "ok";
  if (abs <= WARN_PCT) return "warn";
  return "error";
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
        status: classify(diffPct),
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

    // Annotate the source-newer-than-stored case (expected between ETL runs).
    if (servicesCheck.diff > 0) servicesCheck.note = "Sheet has new entries not yet synced to Supabase.";
    if (retailCheck.diff > 0)   retailCheck.note   = "Sheet has new entries not yet synced to Supabase.";
    if (servicesCheck.diff < 0) servicesCheck.note = "Sheet has fewer rows than Supabase — possible sheet edit/deletion since last ETL.";
    if (retailCheck.diff < 0)   retailCheck.note   = "Sheet has fewer rows than Supabase — possible sheet edit/deletion since last ETL.";

    const overall: Status = [servicesCheck, retailCheck, totalCheck]
      .reduce<Status>((worst, c) => {
        if (worst === "error" || c.status === "error") return "error";
        if (worst === "warn"  || c.status === "warn")  return "warn";
        return "ok";
      }, "ok");

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
