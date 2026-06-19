/**
 * Speed-to-Lead ETL
 *
 * Computes, per GHL opportunity, the business-hours response time from lead
 * creation to the first move out of "New Leads", and writes it to
 * crm_speed_to_lead. Also rolls up daily median/mean into crm_daily.
 *
 * Two sources, unified in one pass over the GHL opportunity population:
 *   • EXACT   — the leaving-New-Leads moment is in ghl_opportunity_stage_events
 *               (webhook log). first_response_at = MIN(changed_at) where
 *               from_stage_normalized = 'New Leads'.
 *   • APPROX  — no such event (pre-webhook / missed). If the opp is currently
 *               past New Leads, approximate first_response_at = lastStageChangeAt.
 *               This OVERESTIMATES for opps that changed stage more than once.
 *   • PENDING — still in New Leads → responded = false, business_minutes = NULL.
 *
 * The full lead population (incl. historical) comes from GHL /opportunities/search
 * so backfill works even for leads created before the webhook went live. GHL
 * /users/ resolves assignedTo → agent_name.
 *
 * See docs/plans/2026-06-18-speed-to-lead-design.md
 */

import { createClient } from "@supabase/supabase-js";
import {
  businessMinutesBetween,
  stlBucketOf,
  median,
  mean,
  type StlBucket,
} from "@/lib/utils/business-hours";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V = "2021-07-28";
const NEW_LEADS = "New Leads";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

type StlBrand = { slug: string; apiKey: string; locationId: string };

function buildBrands(): StlBrand[] {
  return [
    { slug: "spa", apiKey: process.env.GHL_API_KEY ?? "", locationId: "TrtSnBSSKBOkVVNxJ3AM" },
    { slug: "aesthetics", apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "", locationId: "Goi7kzVK7iwe2woxUHkT" },
    { slug: "slimming", apiKey: process.env.GHL_API_KEY_SLIMMING ?? "", locationId: "imWIWDcnmOfijW0lltPq" },
  ];
}

// Stage normalization — kept in sync with the webhook + ghl-funnel route.
const STAGE_ORDER = [
  "New Leads", "Call Back", "Contacted", "Booking Won", "Active Member",
  "Booking Lost", "No Show", "Nurturing",
];
function stripEmoji(name: string): string {
  return name.replace(/[^\x00-\x7F]/g, "").trim();
}
function matchStage(name: string): string {
  const clean = stripEmoji(name);
  const lower = clean.toLowerCase();
  for (const s of STAGE_ORDER) if (s.toLowerCase() === lower) return s;
  for (const s of STAGE_ORDER) if (lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower)) return s;
  return clean;
}

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_V, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

// ── GHL lookups ───────────────────────────────────────────────────────────────

/** assignedTo (GHL user id) → display name, for one location. */
async function fetchUserMap(brand: StlBrand): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const data = (await ghlGet("/users/", brand.apiKey, { locationId: brand.locationId })) as {
      users?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; email?: string }>;
    };
    for (const u of data.users ?? []) {
      const name = (u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "").trim();
      if (u.id) map[u.id] = name || u.id;
    }
  } catch {
    /* leave empty — agent_name falls back to null/Unassigned */
  }
  return map;
}

/** stageId → normalized stage name, for one location's pipelines. */
async function fetchStageMap(brand: StlBrand): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const data = (await ghlGet("/opportunities/pipelines", brand.apiKey, { locationId: brand.locationId })) as {
      pipelines?: Array<{ stages: Array<{ id: string; name: string }> }>;
    };
    for (const p of data.pipelines ?? []) {
      for (const s of p.stages ?? []) map[s.id] = matchStage(s.name);
    }
  } catch {
    /* leave empty — fall back to treating unknown stages as non-New-Leads */
  }
  return map;
}

type GhlOpp = {
  id: string;
  pipelineStageId: string;
  createdAt: string;
  assignedTo?: string | null;
  lastStageChangeAt?: string | null;
  status?: string | null;
};

/** Page through every opportunity created within [fromMs, toMs] for one brand. */
async function fetchOpportunities(brand: StlBrand, fromMs: number, toMs: number): Promise<GhlOpp[]> {
  const out: GhlOpp[] = [];
  const toMsInclusive = toMs + 86_400_000;
  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  const MAX_PAGES = 500; // up to 50k opps

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { location_id: brand.locationId, status: "all", limit: "100" };
    if (startAfter) params.startAfter = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/opportunities/search", brand.apiKey, params)) as {
      opportunities?: GhlOpp[];
      meta?: { startAfter?: number; startAfterId?: string };
    };
    const opps = data.opportunities ?? [];
    if (opps.length === 0) break;

    let oldestInBatch = Infinity;
    for (const o of opps) {
      const ts = new Date(o.createdAt).getTime();
      if (ts < oldestInBatch) oldestInBatch = ts;
      if (ts > toMsInclusive || ts < fromMs) continue;
      out.push(o);
    }
    if (oldestInBatch < fromMs) break;
    if (!data.meta?.startAfter) break;
    startAfter = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }
  return out;
}

// ── Exact first-response lookup from the webhook event log ──────────────────────

/**
 * earliest changed_at where from_stage_normalized = 'New Leads', per opportunity,
 * for one brand within the window. This is the EXACT first-response moment.
 */
async function fetchExactFirstResponses(
  sb: SbClient,
  brandId: number,
  fromIso: string,
  toIso: string,
): Promise<Map<string, string>> {
  const firstByOpp = new Map<string, string>();
  const PAGE = 1000;
  let offset = 0;

  for (;;) {
    const { data, error } = await sb
      .from("ghl_opportunity_stage_events")
      .select("ghl_opportunity_id, changed_at")
      .eq("brand_id", brandId)
      .eq("from_stage_normalized", NEW_LEADS)
      .gte("changed_at", fromIso)
      .lte("changed_at", toIso)
      .order("changed_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`stage events: ${error.message}`);
    const rows = (data ?? []) as { ghl_opportunity_id: string; changed_at: string }[];
    for (const r of rows) {
      // ascending order → first seen is the earliest
      if (!firstByOpp.has(r.ghl_opportunity_id)) firstByOpp.set(r.ghl_opportunity_id, r.changed_at);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return firstByOpp;
}

// ── Upsert helpers ──────────────────────────────────────────────────────────────

async function upsert(sb: SbClient, table: string, rows: object[], onConflict: string): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

// ── Public ETL entrypoint ───────────────────────────────────────────────────────

export type StlResult = {
  status: "ok" | "partial" | "error";
  total_rows: number;
  exact: number;
  approx: number;
  pending: number;
  skipped_artifacts: number; // approx opps created directly into a later stage (sub-minute gap)
  errors?: string[];
  log: string[];
};

type StlFactRow = {
  ghl_opportunity_id: string;
  brand_id: number;
  assigned_to: string | null;
  agent_name: string | null;
  lead_created_at: string;
  first_response_at: string | null;
  raw_minutes: number | null;
  business_minutes: number | null;
  bucket: StlBucket;
  source: "exact" | "approx_backfill";
  responded: boolean;
  computed_at: string;
};

/**
 * @param daysBack how far back to compute (by lead creation date). Default 90.
 */
export async function runSpeedToLead(daysBack = 90): Promise<StlResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { status: "error", total_rows: 0, exact: 0, approx: 0, pending: 0, skipped_artifacts: 0, errors: ["Missing Supabase env vars"], log: [] };

  const sb: SbClient = createClient(url, key);
  const now = Date.now();
  const fromMs = now - daysBack * 86_400_000;
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(now).toISOString();
  const computedAt = new Date().toISOString();

  // brand slug → id
  const { data: brandRows, error: brandErr } = await sb.from("brands").select("id, slug");
  if (brandErr) return { status: "error", total_rows: 0, exact: 0, approx: 0, pending: 0, skipped_artifacts: 0, errors: [brandErr.message], log: [] };
  const brandIdMap: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[r.slug] = r.id;

  const log: string[] = [];
  const errors: string[] = [];
  let totalRows = 0;
  let nExact = 0;
  let nApprox = 0;
  let nPending = 0;
  let nSkipped = 0;

  // rollup accumulator: `${date}|${brandId}` → business_minutes[] of responded leads
  const dailyMinutes = new Map<string, number[]>();

  for (const brand of buildBrands()) {
    const brandId = brandIdMap[brand.slug];
    if (!brandId) { errors.push(`${brand.slug}: not in brands table`); continue; }
    if (!brand.apiKey) { errors.push(`${brand.slug}: missing API key`); continue; }

    try {
      const [opps, exactFirst, userMap, stageMap] = await Promise.all([
        fetchOpportunities(brand, fromMs, now),
        fetchExactFirstResponses(sb, brandId, fromIso, toIso),
        fetchUserMap(brand),
        fetchStageMap(brand),
      ]);

      const rows: StlFactRow[] = [];
      let bExact = 0, bApprox = 0, bPending = 0, bSkipped = 0;

      for (const o of opps) {
        const createdAt = o.createdAt;
        const createdDate = new Date(createdAt);
        const agentName = o.assignedTo ? (userMap[o.assignedTo] ?? null) : null;
        const currentStage = stageMap[o.pipelineStageId] ?? "";
        const isDeleted = o.status === "deleted";

        let firstResponseAt: string | null = null;
        let source: "exact" | "approx_backfill" = "exact";
        let responded = false;

        const exact = exactFirst.get(o.id);
        if (exact) {
          // EXACT — webhook recorded the move out of New Leads
          firstResponseAt = exact;
          source = "exact";
          responded = true;
        } else if (!isDeleted && currentStage && currentStage !== NEW_LEADS && o.lastStageChangeAt) {
          // APPROX — no event logged but the opp has clearly left New Leads.
          // Approximate first response with lastStageChangeAt (overestimates if
          // it changed stage more than once).
          const gapMin = (new Date(o.lastStageChangeAt).getTime() - createdDate.getTime()) / 60_000;
          if (gapMin < 1) {
            // lastStageChangeAt ≈ createdAt → the opp was created directly into a
            // later stage (bulk import / instant automation) and never genuinely
            // dwelled in New Leads. Backfill can't measure a real response here,
            // so EXCLUDE it from the population rather than logging a fake 0-min.
            bSkipped++;
            continue;
          }
          firstResponseAt = o.lastStageChangeAt;
          source = "approx_backfill";
          responded = true;
        } else {
          // PENDING — still in New Leads (or deleted before responding / no data)
          firstResponseAt = null;
          source = "exact";
          responded = false;
        }

        let rawMinutes: number | null = null;
        let businessMinutes: number | null = null;
        if (responded && firstResponseAt) {
          const respDate = new Date(firstResponseAt);
          rawMinutes = Math.max(0, (respDate.getTime() - createdDate.getTime()) / 60_000);
          businessMinutes = businessMinutesBetween(createdDate, respDate);
        }

        const bucket = stlBucketOf(businessMinutes, responded);

        rows.push({
          ghl_opportunity_id: o.id,
          brand_id: brandId,
          assigned_to: o.assignedTo ?? null,
          agent_name: agentName,
          lead_created_at: createdAt,
          first_response_at: firstResponseAt,
          raw_minutes: rawMinutes === null ? null : Math.round(rawMinutes * 100) / 100,
          business_minutes: businessMinutes === null ? null : Math.round(businessMinutes * 100) / 100,
          bucket,
          source,
          responded,
          computed_at: computedAt,
        });

        if (source === "exact" && responded) bExact++;
        else if (source === "approx_backfill") bApprox++;
        if (!responded) bPending++;

        if (responded && businessMinutes !== null) {
          const dkey = `${createdAt.slice(0, 10)}|${brandId}`;
          const arr = dailyMinutes.get(dkey);
          if (arr) arr.push(businessMinutes);
          else dailyMinutes.set(dkey, [businessMinutes]);
        }
      }

      await upsert(sb, "crm_speed_to_lead", rows, "ghl_opportunity_id");
      totalRows += rows.length;
      nExact += bExact; nApprox += bApprox; nPending += bPending; nSkipped += bSkipped;
      log.push(`[${brand.slug}] ${rows.length} rows | exact:${bExact} approx:${bApprox} pending:${bPending} | skipped(created-mid-pipeline):${bSkipped}`);
    } catch (e) {
      const msg = `[${brand.slug}] ${String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  // ── Rollup into crm_daily (median/mean/responded_count per day+brand) ─────────
  try {
    const dailyRows: object[] = [];
    for (const [dkey, mins] of dailyMinutes) {
      const [date, brandIdStr] = dkey.split("|");
      dailyRows.push({
        date,
        brand_id: Number(brandIdStr),
        speed_to_lead_median_min: Math.round(median(mins) * 100) / 100,
        speed_to_lead_mean_min: Math.round(mean(mins) * 100) / 100,
        speed_to_lead_responded_count: mins.length,
      });
    }
    await upsert(sb, "crm_daily", dailyRows, "date,brand_id");
    log.push(`rollup: ${dailyRows.length} crm_daily day/brand rows updated`);
  } catch (e) {
    errors.push(`rollup: ${String(e)}`);
  }

  const status: StlResult["status"] =
    errors.length === 0 ? "ok" : totalRows > 0 ? "partial" : "error";
  return { status, total_rows: totalRows, exact: nExact, approx: nApprox, pending: nPending, skipped_artifacts: nSkipped, errors: errors.length ? errors : undefined, log };
}
