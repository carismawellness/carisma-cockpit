/**
 * ETL staleness detection.
 *
 * For every cron-driven source (aligned with the registry in
 * app/api/settings/data-sources/route.ts) we know the expected cadence.
 * If the last SUCCESSFUL etl_sync_log entry is older than the cadence
 * (+ slack), the source is stale — this catches sources that stopped
 * being called entirely, which per-run error alerting can never see.
 *
 * All nightly sources use a 26h threshold (24h cadence + 2h slack).
 */

export interface StalenessEntry {
  source:               string;
  log_key:              string;
  lastSuccessAt:        string | null;
  ageHours:             number | null;
  expectedCadenceHours: number;
  stale:                boolean;
}

// source = registry id (data-sources route) / cron result name.
// log_key = source_name written to etl_sync_log by that ETL's ETLLogger.
export const SOURCE_CADENCES: Array<{ source: string; log_key: string; expectedCadenceHours: number }> = [
  { source: "cockpit_revenue",             log_key: "cockpit_spa_revenue",          expectedCadenceHours: 26 },
  { source: "cockpit_revenue_daily",       log_key: "cockpit_spa_revenue_daily",    expectedCadenceHours: 26 },
  { source: "zoho_spa_transactions",       log_key: "zoho_spa_transactions",        expectedCadenceHours: 26 },
  { source: "zoho_aesthetics_transactions",log_key: "zoho_aesthetics_transactions", expectedCadenceHours: 26 },
  { source: "aesthetics_sales",            log_key: "aesthetics_sales",             expectedCadenceHours: 26 },
  { source: "slimming_sales",              log_key: "slimming_sales",               expectedCadenceHours: 26 },
  { source: "slimming_treatments",         log_key: "slimming_treatments",          expectedCadenceHours: 26 },
  { source: "spa_services_by_employee",    log_key: "spa_services_by_employee",     expectedCadenceHours: 26 },
  { source: "crm_agents",                  log_key: "crm_agents",                   expectedCadenceHours: 26 },
  { source: "ghl_crm",                     log_key: "ghl_crm",                      expectedCadenceHours: 26 },
  { source: "meta_campaigns",              log_key: "meta_campaigns",               expectedCadenceHours: 26 },
  { source: "google_campaigns",            log_key: "google_campaigns",             expectedCadenceHours: 26 },
  { source: "klaviyo",                     log_key: "klaviyo",                      expectedCadenceHours: 26 },
  { source: "talexio_hr",                  log_key: "talexio-hr",                   expectedCadenceHours: 26 },
  { source: "lead_reconciliation",         log_key: "lead_reconciliation",          expectedCadenceHours: 26 },
  { source: "token_canary",                log_key: "token-canary",                 expectedCadenceHours: 26 },
];

/**
 * Fetch the latest successful sync timestamp per log_key from etl_sync_log,
 * using the service-role REST endpoint (works without a session — callable
 * from cron). Returns an empty map on any failure (never throws).
 */
export async function fetchLatestSuccesses(): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  try {
    const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return latest;

    const url =
      `${base}/rest/v1/etl_sync_log` +
      `?status=eq.success&select=source_name,completed_at,started_at` +
      `&order=started_at.desc&limit=500`;
    const resp = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return latest;

    const rows = await resp.json() as Array<{
      source_name: string; completed_at: string | null; started_at: string | null;
    }>;
    for (const row of rows) {
      if (!latest.has(row.source_name)) {
        const ts = row.completed_at ?? row.started_at;
        if (ts) latest.set(row.source_name, ts);
      }
    }
  } catch (err) {
    console.error("[Staleness] failed to read etl_sync_log:", err);
  }
  return latest;
}

/** Compute the per-source staleness report from a latest-success map. */
export function computeStaleness(
  latestSuccess: Map<string, string>,
  now: Date = new Date(),
): StalenessEntry[] {
  return SOURCE_CADENCES.map(({ source, log_key, expectedCadenceHours }) => {
    const lastSuccessAt = latestSuccess.get(log_key) ?? null;
    const ageHours = lastSuccessAt
      ? +(((now.getTime() - new Date(lastSuccessAt).getTime()) / 3_600_000).toFixed(1))
      : null;
    return {
      source,
      log_key,
      lastSuccessAt,
      ageHours,
      expectedCadenceHours,
      // No success record at all also counts as stale — either the ETL has
      // never run, or it stopped being called entirely.
      stale: ageHours === null || ageHours > expectedCadenceHours,
    };
  });
}

/** Convenience: fetch + compute in one call. Never throws. */
export async function getStalenessReport(): Promise<StalenessEntry[]> {
  const latest = await fetchLatestSuccesses();
  return computeStaleness(latest);
}
