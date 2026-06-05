/**
 * GET /api/settings/data-sources
 * Returns last ETL sync status per source + data coverage per table.
 *
 * POST /api/settings/data-sources
 * Body: { source_id: string }  → triggers the ETL for that source (current-month window).
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// ── Source definitions ────────────────────────────────────────────────────────

export const DATA_SOURCE_DEFS = [
  {
    id:          "lapis_revenue",
    name:        "Lapis Revenue (SPA Services & Products)",
    description: "SPA service and product sales exported from the Lapis spa management system via Google Sheets. Also pulls Wholesale, Sales Discount and Sales Refund from Zoho SPA P&L.",
    tables:      ["spa_revenue_monthly"],
    brand:       "SPA",
    frequency:   "Nightly cron + auto on dashboard load for missing months",
    log_key:     "lapis_spa_revenue",
    endpoint:    "/api/etl/lapis-revenue",
    coverage_table: "spa_revenue_monthly",
    coverage_col:   "month",
    manual_note: null,
  },
  {
    id:          "zoho_spa_transactions",
    name:        "Zoho SPA — Transaction-level ETL",
    description: "Bills, expenses, invoices and journal lines from the Zoho Books SPA organisation. Allocates each line to a venue (hyatt, ramla, …, hq) using Zoho tags → COA split rules, then writes to transactions_raw (for EBITDA V2 drill-down) and spa_ebitda_daily / hq_ebitda_daily (for aggregation).",
    tables:      ["transactions_raw", "spa_ebitda_daily", "hq_ebitda_daily"],
    brand:       "SPA",
    frequency:   "Nightly cron (rolling 3-month window)",
    log_key:     "zoho_spa_transactions",
    endpoint:    "/api/etl/zoho-spa-transactions",
    coverage_table: "spa_ebitda_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "zoho_aesthetics_transactions",
    name:        "Zoho Aesthetics — Transaction-level ETL",
    description: "Bills, expenses and journals from the Zoho Books Aesthetics organisation. Splits costs between Aesthetics and Slimming departments using Zoho tags → COA split rules, writing to transactions_raw and aesthetics_ebitda_daily / hq_ebitda_daily.",
    tables:      ["transactions_raw", "aesthetics_ebitda_daily", "hq_ebitda_daily"],
    brand:       "AES / SLIM",
    frequency:   "Nightly cron (rolling 3-month window)",
    log_key:     "zoho_aesthetics_transactions",
    endpoint:    "/api/etl/zoho-aesthetics-transactions",
    coverage_table: "aesthetics_ebitda_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "aesthetics_sales",
    name:        "Aesthetics Sales Revenue",
    description: "Daily treatment and product revenue for the Aesthetics brand, loaded into aesthetics_sales_daily. Used as Net Revenue in EBITDA V2.",
    tables:      ["aesthetics_sales_daily"],
    brand:       "AES",
    frequency:   "Nightly cron",
    log_key:     null,
    endpoint:    "/api/etl/aesthetics-sales",
    coverage_table: "aesthetics_sales_daily",
    coverage_col:   "date_of_service",
    manual_note: null,
  },
  {
    id:          "slimming_sales",
    name:        "Slimming Sales Revenue",
    description: "Daily treatment revenue for the Slimming brand, loaded into slimming_sales_daily. Used as Net Revenue in EBITDA V2.",
    tables:      ["slimming_sales_daily"],
    brand:       "SLIM",
    frequency:   "Nightly cron",
    log_key:     null,
    endpoint:    "/api/etl/slimming-sales",
    coverage_table: "slimming_sales_daily",
    coverage_col:   "date_of_service",
    manual_note: null,
  },
  {
    id:          "salary_supplement",
    name:        "Salary Supplement",
    description: "Monthly wage supplements (bonuses, allowances) sourced from a Google Sheet. Each month must be reviewed and manually frozen in Settings → Salary Supplement before it is included in EBITDA. Months without frozen data automatically fall back to the most recent frozen month in EBITDA V2.",
    tables:      ["salary_supplement_monthly"],
    brand:       "SPA",
    frequency:   "Manual — sync from Google Sheet via Settings → Salary Supplement",
    log_key:     null,
    endpoint:    null,
    coverage_table: "salary_supplement_monthly",
    coverage_col:   "month",
    manual_note: "/settings/salary-supplement",
  },
  {
    id:          "wage_role_mapping",
    name:        "Employee → Role Mapping",
    description: "Maps Zoho contact names to EBITDA wage roles (Manager, Reception, Therapist, CRM). Maintained manually in Settings → Employee Mapping. Used to break wages down by role in EBITDA V2 drill-down.",
    tables:      ["wage_role_mapping"],
    brand:       "ALL",
    frequency:   "On-demand — update via Settings → Employee Mapping",
    log_key:     null,
    endpoint:    null,
    coverage_table: null,
    coverage_col:   null,
    manual_note: "/settings/employee-mapping",
  },
  {
    id:          "coa_mapping",
    name:        "Chart of Accounts Mapping",
    description: "Maps Zoho account codes to EBITDA lines (wages, advertising, SGA …) and venue split rules. Synced from Zoho on demand. Determines how every cost transaction is classified in EBITDA V2.",
    tables:      ["coa_mapping", "coa_split_rules"],
    brand:       "ALL",
    frequency:   "On-demand — sync via Settings → COA Mapping",
    log_key:     null,
    endpoint:    null,
    coverage_table: null,
    coverage_col:   null,
    manual_note: "/settings/coa-mapping",
  },
] as const;

type SourceId = typeof DATA_SOURCE_DEFS[number]["id"];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createServerClient();

  // Last sync per logged source
  const { data: logs } = await supabase
    .from("etl_sync_log")
    .select("source_name, status, rows_upserted, started_at, completed_at, duration_sec, error_message")
    .order("started_at", { ascending: false })
    .limit(200);

  // Group → keep only the most recent entry per source_name
  const latestLog = new Map<string, Record<string, unknown>>();
  for (const row of (logs ?? [])) {
    if (!latestLog.has(row.source_name as string)) latestLog.set(row.source_name as string, row);
  }

  // Data coverage per table
  const coverageQueries: Array<{ id: SourceId; sql: string }> = DATA_SOURCE_DEFS
    .filter(d => d.coverage_table && d.coverage_col)
    .map(d => ({
      id:  d.id as SourceId,
      sql: `SELECT MIN(${d.coverage_col}::text) AS from_date, MAX(${d.coverage_col}::text) AS to_date, COUNT(*) AS rows FROM ${d.coverage_table}`,
    }));

  const coverageResults = await Promise.all(
    coverageQueries.map(async q => {
      const { data } = await supabase.rpc("exec_sql" as never, { sql: q.sql }).single().catch(() => ({ data: null }));
      // Fallback: use direct table query
      return { id: q.id, data };
    }),
  );

  // Build simpler coverage map via direct queries for tables we know
  type Coverage = { from_date: string | null; to_date: string | null; rows: number };
  const coverage: Record<string, Coverage> = {};

  const tableCoverage: Array<[string, string, string]> = [
    ["spa_revenue_monthly",    "month",           "spa_revenue_monthly"],
    ["spa_ebitda_daily",       "date",             "spa_ebitda_daily"],
    ["aesthetics_ebitda_daily","date",             "aesthetics_ebitda_daily"],
    ["transactions_raw",       "date",             "transactions_raw"],
    ["aesthetics_sales_daily", "date_of_service",  "aesthetics_sales_daily"],
    ["slimming_sales_daily",   "date_of_service",  "slimming_sales_daily"],
    ["salary_supplement_monthly","month",          "salary_supplement_monthly"],
    ["wage_role_mapping",      null,               "wage_role_mapping"],
    ["coa_mapping",            null,               "coa_mapping"],
  ];

  await Promise.all(tableCoverage.map(async ([table, dateCol, key]) => {
    if (!dateCol) {
      const { count } = await supabase.from(table as never).select("*", { count: "exact", head: true });
      coverage[key] = { from_date: null, to_date: null, rows: count ?? 0 };
      return;
    }
    const { data: minMax } = await supabase
      .from(table as never)
      .select(`${dateCol}`)
      .order(dateCol, { ascending: true })
      .limit(1);
    const { data: maxRow } = await supabase
      .from(table as never)
      .select(`${dateCol}`)
      .order(dateCol, { ascending: false })
      .limit(1);
    const { count } = await supabase.from(table as never).select("*", { count: "exact", head: true });
    coverage[key] = {
      from_date: minMax?.[0]?.[dateCol as never] ?? null,
      to_date:   maxRow?.[0]?.[dateCol as never] ?? null,
      rows:      count ?? 0,
    };
  }));

  // Assemble response
  const sources = DATA_SOURCE_DEFS.map(def => {
    const log      = def.log_key ? latestLog.get(def.log_key) : undefined;
    const cov      = def.coverage_table ? coverage[def.coverage_table] : undefined;
    return {
      ...def,
      last_sync: log ?? null,
      coverage:  cov  ?? null,
    };
  });

  return NextResponse.json({ sources, fetched_at: new Date().toISOString() });
}

// ── POST — manual trigger ─────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { source_id, date_from, date_to } = await req.json() as {
    source_id: string;
    date_from?: string;
    date_to?:   string;
  };

  const def = DATA_SOURCE_DEFS.find(d => d.id === source_id);
  if (!def || !def.endpoint)
    return NextResponse.json({ error: "No triggerable endpoint for this source" }, { status: 400 });

  // Default window: 1st of 2 months ago → today
  const now   = new Date();
  const from  = date_from ?? (() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  const to    = date_to ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const origin = new URL(req.url).origin;
  const resp = await fetch(`${origin}${def.endpoint}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ date_from: from, date_to: to, force: true }),
  });

  const result = await resp.json().catch(() => ({}));
  return NextResponse.json({ triggered: true, date_from: from, date_to: to, result });
}
