/**
 * GET /api/settings/data-sources
 * Returns last ETL sync status per source + data coverage per table.
 *
 * POST /api/settings/data-sources
 * Body: { source_id: string }  → triggers the ETL for that source (current-month window).
 */

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ── Source definitions ────────────────────────────────────────────────────────

export const DATA_SOURCE_DEFS = [
  {
    id:          "cockpit_revenue",
    name:        "Spa Revenue (Cockpit Datasheet)",
    description: "SPA service and product sales exported from the Cockpit Datasheet (Google Sheets). Also pulls Wholesale, Sales Discount and Sales Refund from Zoho SPA P&L.",
    tables:      ["spa_revenue_monthly"],
    brand:       "SPA",
    frequency:   "Nightly cron + auto on dashboard load for missing months",
    log_key:     "cockpit_spa_revenue",
    endpoint:    "/api/etl/cockpit-revenue",
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
    name:        "Aesthetics Sales (Cockpit Datasheet)",
    description: "Daily treatment and product revenue for the Aesthetics brand, sourced from the Cockpit Datasheet (Aesthetics tab). Loaded into aesthetics_sales_daily and used as Net Revenue in EBITDA V2.",
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
    name:        "Slimming Sales (Cockpit Datasheet)",
    description: "Slimming programme package sales (weight loss, treatment plans, medical consults, products) sourced from the Cockpit Datasheet (Sales - Slimming tab). Loaded into slimming_sales_daily and used as Net Revenue in EBITDA V2.",
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
    id:          "slimming_treatments",
    name:        "Slimming Treatments (Cockpit Datasheet)",
    description: "Individual treatment transactions for the Slimming brand (Tx - Slimming tab in Cockpit Datasheet). Drives per-therapist analytics on the Slimming sales page.",
    tables:      ["slimming_treatments_daily"],
    brand:       "SLIM",
    frequency:   "Nightly cron",
    log_key:     null,
    endpoint:    "/api/etl/slimming-treatments",
    coverage_table: "slimming_treatments_daily",
    coverage_col:   "date_of_service",
    manual_note: null,
  },
  {
    id:          "crm_agents",
    name:        "CRM Agents — Daily KPIs",
    description: "Per-agent CRM KPIs (messages, bookings, deposits, sales, conversion rate, AOV) synced from the CRM Master Google Sheet (all 12 agent tabs) into crm_agent_daily. Powers the Sales individual agent dashboard.",
    tables:      ["crm_agent_daily"],
    brand:       "ALL",
    frequency:   "Nightly cron",
    log_key:     null,
    endpoint:    "/api/etl/crm-agents",
    coverage_table: "crm_agent_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "ghl_crm",
    name:        "GHL CRM — Leads & Pipeline",
    description: "Pulls lead, appointment and pipeline data from all 3 GoHighLevel sub-accounts (Spa, Aesthetics, Slimming). Writes daily aggregates to crm_daily for the cross-brand CRM dashboard.",
    tables:      ["crm_daily"],
    brand:       "ALL",
    frequency:   "Nightly cron (rolling 3-month window)",
    log_key:     null,
    endpoint:    "/api/etl/ghl-crm",
    coverage_table: "crm_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "meta_campaigns",
    name:        "Meta Ads — Daily Campaigns",
    description: "Daily campaign metrics (spend, impressions, clicks, leads, ROAS) from the Meta Marketing API across all 3 brand ad accounts. Loaded into meta_campaigns_daily.",
    tables:      ["meta_campaigns_daily"],
    brand:       "ALL",
    frequency:   "Nightly cron (rolling 30-day window)",
    log_key:     null,
    endpoint:    "/api/etl/meta-campaigns",
    coverage_table: "meta_campaigns_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "google_campaigns",
    name:        "Google Ads — Daily Campaigns",
    description: "Daily campaign metrics (spend, impressions, clicks, conversions) from Google Ads across all 3 brand accounts. Loaded into google_campaigns_daily.",
    tables:      ["google_campaigns_daily"],
    brand:       "ALL",
    frequency:   "Nightly cron (rolling 30-day window)",
    log_key:     null,
    endpoint:    "/api/etl/google-campaigns",
    coverage_table: "google_campaigns_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "klaviyo",
    name:        "Klaviyo — Daily Email Aggregates",
    description: "Daily email marketing health: subscriber counts, active flows, campaign open/click/unsubscribe/bounce rates across all 3 brand Klaviyo accounts. Snapshots yesterday's aggregates into klaviyo_daily.",
    tables:      ["klaviyo_daily"],
    brand:       "ALL",
    frequency:   "Nightly cron (yesterday's snapshot)",
    log_key:     null,
    endpoint:    "/api/etl/klaviyo-sync",
    coverage_table: "klaviyo_daily",
    coverage_col:   "date",
    manual_note: null,
  },
  {
    id:          "salary_supplement",
    name:        "Salary Supplement",
    description: "Monthly wage supplements (bonuses, allowances) sourced from a Google Sheet. Each month must be reviewed and manually frozen in Settings → EBITDA Mapping → Salary Supplement before it is included in EBITDA. Months without frozen data automatically fall back to the most recent frozen month in EBITDA V2.",
    tables:      ["salary_supplement_monthly"],
    brand:       "SPA",
    frequency:   "Manual — review monthly in Settings → EBITDA Mapping",
    log_key:     null,
    endpoint:    null,
    coverage_table: "salary_supplement_monthly",
    coverage_col:   "month",
    manual_note: "/settings/ebitda-mapping",
  },
  {
    id:          "wage_role_mapping",
    name:        "Employee → Role Mapping",
    description: "Maps Zoho contact names to EBITDA wage roles (Manager, Reception, Therapist, Practitioner, CRM). Maintained manually in Settings → EBITDA Mapping → Employee Mapping. Used to break wages down by role in EBITDA V2 drill-down.",
    tables:      ["wage_role_mapping"],
    brand:       "ALL",
    frequency:   "On-demand — update via Settings → EBITDA Mapping",
    log_key:     null,
    endpoint:    null,
    coverage_table: null,
    coverage_col:   null,
    manual_note: "/settings/ebitda-mapping",
  },
  {
    id:          "coa_mapping",
    name:        "Chart of Accounts Mapping",
    description: "Maps Zoho account codes to EBITDA lines (wages, advertising, SG&A …) and venue split rules. Synced from Zoho on demand via Settings → EBITDA Mapping → COA Mapping. Determines how every cost transaction is classified in EBITDA V2.",
    tables:      ["coa_mapping", "coa_split_rules"],
    brand:       "ALL",
    frequency:   "On-demand — sync via Settings → EBITDA Mapping",
    log_key:     null,
    endpoint:    null,
    coverage_table: null,
    coverage_col:   null,
    manual_note: "/settings/ebitda-mapping",
  },
] as const;

type SourceId = typeof DATA_SOURCE_DEFS[number]["id"];

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createServerSupabaseClient();

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

  // Coverage is built via direct per-table queries below

  // Build simpler coverage map via direct queries for tables we know
  type Coverage = { from_date: string | null; to_date: string | null; rows: number };
  const coverage: Record<string, Coverage> = {};

  const tableCoverage: Array<[string, string, string]> = [
    ["spa_revenue_monthly",       "month",           "spa_revenue_monthly"],
    ["spa_ebitda_daily",          "date",            "spa_ebitda_daily"],
    ["aesthetics_ebitda_daily",   "date",            "aesthetics_ebitda_daily"],
    ["transactions_raw",          "date",            "transactions_raw"],
    ["aesthetics_sales_daily",    "date_of_service", "aesthetics_sales_daily"],
    ["slimming_sales_daily",      "date_of_service", "slimming_sales_daily"],
    ["slimming_treatments_daily", "date_of_service", "slimming_treatments_daily"],
    ["crm_agent_daily",           "date",            "crm_agent_daily"],
    ["crm_daily",                 "date",            "crm_daily"],
    ["meta_campaigns_daily",      "date",            "meta_campaigns_daily"],
    ["google_campaigns_daily",    "date",            "google_campaigns_daily"],
    ["klaviyo_daily",             "date",            "klaviyo_daily"],
    ["salary_supplement_monthly", "month",           "salary_supplement_monthly"],
    ["wage_role_mapping",         "" as string,      "wage_role_mapping"],
    ["coa_mapping",               "" as string,      "coa_mapping"],
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
