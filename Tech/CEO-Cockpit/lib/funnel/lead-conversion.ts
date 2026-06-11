// Brand-level lead conversion — single source of truth for the metric that
// appears on the Pipeline Funnel widget ("Lead Conv."), the funnel heatmap's
// Booking Efficiency row, the campaign drill-down's Conv % column, and the
// CRM Team Split's Conversion Rate line.
//
// Formula: leads acquired in the period whose CURRENT pipeline stage is
// "Booking Won" ÷ all leads acquired in the period (across every current
// stage). Sourced from the ghl_opportunities mirror, filtered by brand_id
// and date_added.
//
// Why this and not the live "Meta bookings ÷ Meta leads" or the per-agent
// booking_eff_pct: the GHL cohort-based rate is what's visible on the
// Pipeline Funnel widget the CEO trusts, captures every channel the lead
// can come in from (Meta + email + WhatsApp + repeat), and stays stable
// across short date filters where the live ratio swings wildly.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

const WON_STAGE = "Booking Won";

// GHL's search API (/opportunities/search) omits pipelineStageName from the
// response, so the backfill and reconcile stored raw stage UUIDs instead of
// normalized names. Until a full re-sync converts them, recognise these UUIDs
// as "Booking Won" so the metric is not permanently zero.
// Source: GET /opportunities/pipelines confirmed 2026-06-11.
const BOOKING_WON_IDS = new Set([
  "aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c", // Spa         (brand_id 1)
  "e4209bea-82d7-4802-ac5d-54fae9523360", // Aesthetics  (brand_id 2)
  "e74d873e-001e-4746-8d55-35787a796ce0", // Slimming    (brand_id 3)
]);

// One-off data migrations that bulk-imported historical contacts into GHL in a
// single day. Including these dates inflates the denominator by 6-9k leads and
// makes booking efficiency appear near-zero for those brands that month.
// Each entry excludes ALL leads (both won and total) with date_added on that
// calendar day for the specified brand.
export const MIGRATION_EXCLUSIONS: Array<{ brand_id: number; date: string }> = [
  { brand_id: 2, date: "2026-05-06" }, // Aesthetics: 6,328 leads bulk-imported (normal ~30/day)
  { brand_id: 3, date: "2026-05-06" }, // Slimming:   2,690 leads bulk-imported (normal ~15/day)
];

/** Returns the set of calendar dates to skip for a given brand within [dateFrom, dateTo]. */
export function migrationExclusionDates(brandId: number, dateFrom: string, dateTo: string): Set<string> {
  return new Set(
    MIGRATION_EXCLUSIONS
      .filter(ex => ex.brand_id === brandId && ex.date >= dateFrom && ex.date <= dateTo)
      .map(ex => ex.date),
  );
}

export type LeadConversion = {
  won:    number;
  total:  number;
  ratePct: number | null;   // null when total == 0
};

/**
 * Compute brand-level lead conversion for a date window.
 *
 * `dateFrom`/`dateTo` are YYYY-MM-DD strings; the window is inclusive
 * on both ends and treated as covering full UTC days (matching how the
 * /api/crm/ghl-funnel route queries the cohort).
 */
export async function computeLeadConversion(
  sb: SbClient,
  brandId: number,
  dateFrom: string,
  dateTo: string,
): Promise<LeadConversion> {
  const { data, error } = await sb
    .from("ghl_opportunities")
    .select("stage_normalized, date_added")
    .eq("brand_id", brandId)
    .neq("status", "deleted")
    .gte("date_added", dateFrom)
    .lte("date_added", dateTo + "T23:59:59Z");

  if (error) {
    // Match the funnel route's failure mode — surface zeros rather than crash.
    return { won: 0, total: 0, ratePct: null };
  }

  const exclusionDates = migrationExclusionDates(brandId, dateFrom, dateTo);

  let won   = 0;
  let total = 0;
  for (const r of (data ?? []) as { stage_normalized: string; date_added: string }[]) {
    if (exclusionDates.size > 0 && exclusionDates.has(r.date_added.slice(0, 10))) continue;
    total += 1;
    if (r.stage_normalized === WON_STAGE || BOOKING_WON_IDS.has(r.stage_normalized)) won += 1;
  }

  return {
    won,
    total,
    ratePct: total > 0 ? Math.round((won / total) * 1000) / 10 : null,
  };
}
