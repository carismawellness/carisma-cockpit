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
    .select("stage_normalized")
    .eq("brand_id", brandId)
    .neq("status", "deleted")
    .gte("date_added", dateFrom)
    .lte("date_added", dateTo + "T23:59:59Z");

  if (error) {
    // Match the funnel route's failure mode — surface zeros rather than crash.
    return { won: 0, total: 0, ratePct: null };
  }

  let won   = 0;
  let total = 0;
  for (const r of (data ?? []) as { stage_normalized: string }[]) {
    total += 1;
    if (r.stage_normalized === WON_STAGE) won += 1;
  }

  return {
    won,
    total,
    ratePct: total > 0 ? Math.round((won / total) * 1000) / 10 : null,
  };
}
