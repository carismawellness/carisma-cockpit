// app/api/health/cockpit/route.ts
//
// Health check for the Cockpit Datasheet ETL pipeline. Returns OK only when
// every Cockpit tab is reachable AND returns a CSV with the canonical
// header row for that tab.
//
// Hit this endpoint from any external monitor (Better Uptime / Pingdom /
// Vercel Cron / GitHub Actions cron) on a 15-min cadence — if it ever
// returns 503, the Spa/Aesthetics/Slimming dashboards will start showing
// €0 within hours. Catch the regression BEFORE the user does.
//
// History: created 2026-06-15 after a Google quirk in the gviz endpoint
// silently broke every sales surface for several hours. The integrity
// badge was unable to detect the failure because both source and stored
// sums had collapsed to €0 simultaneously — see commit "feat(cockpit ETL):
// fail loud when CSV headers don't match expectations".

import { NextResponse } from "next/server";
import { cockpitCsvUrl, COCKPIT_TABS } from "@/lib/constants/cockpit-sheets";
import { parseCSV } from "@/lib/etl/csv";

export const dynamic = "force-dynamic";

// Canonical header set for each tab. KEEP IN SYNC with the per-ETL
// REQUIRED_HEADERS constants in lib/etl/*-sales.ts / *-by-employee.ts.
// If any tab's first row drops one of these strings, the dashboards will
// start showing €0 within one cron cycle — this endpoint catches it earlier.
const TAB_HEADERS = {
  [COCKPIT_TABS.SPA_SERVICES.name]:    ["Status", "Service Date", "Sales Point", "Employee(s)", "Service Name", "Unit Price"],
  [COCKPIT_TABS.SPA_RETAIL.name]:      ["Date", "VAT Exclusive Amount", "Point of Sales", "Brand"],
  [COCKPIT_TABS.AESTHETICS.name]:      ["Costumer", "Service / Products", "Date of service", "Price", "Employee"],
  [COCKPIT_TABS.SLM_SALES.name]:       ["Date", "Client", "Full price", "Paid", "Employee"],
  [COCKPIT_TABS.SLM_TRANSACTIONS.name]:["Date", "Client", "Treatment", "Price", "Therapist"],
} as const;

interface TabResult {
  tab:           string;
  ok:            boolean;
  http_status:   number;
  row_count:     number;
  headers_ok:    boolean;
  missing:       string[];
  first_row:     string;
  fetch_ms:      number;
  error?:        string;
}

async function checkTab(tabName: string, required: readonly string[]): Promise<TabResult> {
  const url   = cockpitCsvUrl(tabName);
  const start = performance.now();

  try {
    const resp = await fetch(url, { redirect: "follow" });
    const fetchMs = Math.round(performance.now() - start);

    if (!resp.ok) {
      return {
        tab: tabName, ok: false,
        http_status: resp.status,
        row_count: 0,
        headers_ok: false,
        missing: [...required],
        first_row: "",
        fetch_ms: fetchMs,
        error: `HTTP ${resp.status} — sheet may be unshared, deleted, or Google quirk.`,
      };
    }

    const text = await resp.text();
    const rows = parseCSV(text);
    if (rows.length === 0) {
      return {
        tab: tabName, ok: false,
        http_status: 200,
        row_count: 0,
        headers_ok: false,
        missing: [...required],
        first_row: "",
        fetch_ms: fetchMs,
        error: "CSV had zero rows after parsing.",
      };
    }

    const headerCells = rows[0].map(c => c.trim());
    const headerSet   = new Set(headerCells);
    const missing     = required.filter(h => !headerSet.has(h));

    return {
      tab: tabName,
      ok: missing.length === 0,
      http_status: 200,
      row_count: rows.length,
      headers_ok: missing.length === 0,
      missing,
      first_row: headerCells.slice(0, 6).join(" | "),
      fetch_ms: fetchMs,
    };
  } catch (err: unknown) {
    const fetchMs = Math.round(performance.now() - start);
    return {
      tab: tabName, ok: false,
      http_status: 0,
      row_count: 0,
      headers_ok: false,
      missing: [...required],
      first_row: "",
      fetch_ms: fetchMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const results = await Promise.all(
    Object.entries(TAB_HEADERS).map(([name, required]) => checkTab(name, required)),
  );

  const overall = results.every(r => r.ok) ? "ok" : "fail";
  const failing = results.filter(r => !r.ok).map(r => r.tab);

  return NextResponse.json(
    {
      overall,
      generated_at: new Date().toISOString(),
      failing_tabs: failing,
      results,
    },
    {
      // 503 on failure so external monitors can alarm on a non-2xx status.
      status: overall === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
