/**
 * GHL Opportunities Mirror — initial backfill
 *
 * Paginates GET /opportunities/search for each brand's Call Pipeline,
 * upserts current state into ghl_opportunities, and writes a synthetic
 * stage event (source="backfill", changed_at=date_added) per opp so
 * the cohort/flow queries have at least one row per opportunity.
 *
 * Safe to re-run: upserts on primary key, stage events are skipped if
 * already present (checked by ghl_opportunity_id + source=backfill).
 *
 * Run:
 *   npx tsx --env-file .env.production.local Tools/backfill-ghl-opportunities.ts
 *
 * Optional: pass a brand slug to backfill just one brand:
 *   npx tsx --env-file .env.production.local Tools/backfill-ghl-opportunities.ts spa
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { createClient } from "@supabase/supabase-js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const STAGE_ORDER = [
  "New Leads",
  "Call Back",
  "Contacted",
  "Booking Won",
  "Active Member",
  "Booking Lost",
  "No Show",
  "Nurturing",
];

const BRAND_CONFIG = [
  {
    slug:       "spa",
    apiKey:     process.env.GHL_API_KEY ?? "",
    locationId: "TrtSnBSSKBOkVVNxJ3AM",
    pipelineId: "4vgVsqiN12VGdloyzyxD",
  },
  {
    slug:       "aesthetics",
    apiKey:     process.env.GHL_API_KEY_AESTHETICS ?? "",
    locationId: "Goi7kzVK7iwe2woxUHkT",
    pipelineId: "PaSsbcOAeRURF2Hc2V3F",
  },
  {
    slug:       "slimming",
    apiKey:     process.env.GHL_API_KEY_SLIMMING ?? "",
    locationId: "imWIWDcnmOfijW0lltPq",
    pipelineId: "N3usvWAkWpUppJj1ggtM",
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_V, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

function stripEmoji(name: string): string {
  return name.replace(/[^\x00-\x7F]/g, "").trim();
}

function matchStage(name: string): string {
  const clean = stripEmoji(name);
  const lower = clean.toLowerCase();
  for (const s of STAGE_ORDER) {
    if (s.toLowerCase() === lower) return s;
  }
  for (const s of STAGE_ORDER) {
    if (lower.includes(s.toLowerCase()) || s.toLowerCase().includes(lower)) return s;
  }
  return clean;
}

// Build stageId → normalizedName map for the given pipeline
async function buildStageMap(apiKey: string, locationId: string, pipelineId: string): Promise<Map<string, string>> {
  const data = (await ghlGet("/opportunities/pipelines", apiKey, { locationId })) as {
    pipelines?: Array<{ id: string; stages: Array<{ id: string; name: string }> }>;
  };
  const pipeline = (data.pipelines ?? []).find((p) => p.id === pipelineId);
  const map = new Map<string, string>();
  for (const stage of pipeline?.stages ?? []) {
    map.set(stage.id, matchStage(stage.name));
  }
  return map;
}

// Paginate all opportunities in a pipeline
async function* paginateOpportunities(
  apiKey: string,
  locationId: string,
  pipelineId: string,
): AsyncGenerator<Record<string, unknown>[]> {
  let startAfter:   string | undefined;
  let startAfterId: string | undefined;

  for (let page = 0; page < 500; page++) {
    const params: Record<string, string> = {
      location_id: locationId,
      pipeline_id: pipelineId,
      status:      "all",
      limit:       "100",
    };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/opportunities/search", apiKey, params)) as {
      opportunities?: Record<string, unknown>[];
      meta?: { startAfter?: number; startAfterId?: string };
    };
    const opps = data.opportunities ?? [];
    if (!opps.length) break;

    yield opps;

    if (!data.meta?.startAfter) break;
    startAfter   = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

async function upsertChunked(
  sb: SbClient,
  table: string,
  rows: object[],
  onConflict: string,
  chunkSize = 200,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await sb.from(table).upsert(
      rows.slice(i, i + chunkSize),
      { onConflict },
    );
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argBrand = process.argv[2]; // optional: "spa" | "aesthetics" | "slimming"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: SbClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Load brand ID map
  const { data: brandRows, error: brandErr } = await sb.from("brands").select("id, slug");
  if (brandErr) throw new Error(`brands lookup: ${brandErr.message}`);
  const brandIdMap: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) brandIdMap[r.slug] = r.id;

  const syncedAt = new Date().toISOString();
  const brands = argBrand ? BRAND_CONFIG.filter((b) => b.slug === argBrand) : BRAND_CONFIG;

  for (const brand of brands) {
    if (!brand.apiKey) { console.log(`SKIP ${brand.slug}: no API key`); continue; }
    const brandId = brandIdMap[brand.slug];
    if (!brandId) { console.log(`SKIP ${brand.slug}: not in brands table`); continue; }

    console.log(`\n[${brand.slug}] building stage map...`);
    const stageMap = await buildStageMap(brand.apiKey, brand.locationId, brand.pipelineId);
    console.log(`[${brand.slug}] stage map: ${[...stageMap.entries()].map(([id, n]) => `${n}(${id.slice(0, 8)})`).join(", ")}`);

    let oppCount    = 0;
    let eventCount  = 0;
    let pageNum     = 0;

    // Collect all backfill event ghl_opportunity_ids already in DB to avoid re-inserting
    const { data: existingEvents } = await (sb.from("ghl_opportunity_stage_events") as any)
      .select("ghl_opportunity_id")
      .eq("brand_id", brandId)
      .eq("source", "backfill");
    const existingEventIds = new Set<string>(
      ((existingEvents ?? []) as { ghl_opportunity_id: string }[]).map((r) => r.ghl_opportunity_id),
    );
    console.log(`[${brand.slug}] ${existingEventIds.size} existing backfill events — will skip re-inserting`);

    for await (const opps of paginateOpportunities(brand.apiKey, brand.locationId, brand.pipelineId)) {
      pageNum++;

      const oppRows: object[] = [];
      const eventRows: object[] = [];

      for (const opp of opps) {
        const id          = opp.id as string;
        const stageId     = (opp.pipelineStageId ?? opp.pipeline_stage_id ?? "") as string;
        const normalName  = stageMap.get(stageId) ?? matchStage((opp.pipelineStage ?? "") as string);
        const dateAdded   = (opp.createdAt ?? opp.dateAdded ?? opp.date_added ?? "") as string;
        const dateUpdated = (opp.updatedAt ?? opp.dateUpdated ?? opp.date_updated ?? dateAdded) as string;

        oppRows.push({
          ghl_opportunity_id:    id,
          brand_id:              brandId,
          ghl_location_id:       brand.locationId,
          ghl_pipeline_id:       brand.pipelineId,
          ghl_pipeline_stage_id: stageId,
          stage_normalized:      normalName,
          status:                opp.status as string ?? null,
          contact_id:            (opp.contactId ?? (opp.contact as Record<string,unknown> | null)?.id ?? null) as string | null,
          assigned_to:           (opp.assignedTo ?? null) as string | null,
          monetary_value:        (opp.monetaryValue ?? null) as number | null,
          date_added:            dateAdded || null,
          date_updated:          dateUpdated || null,
          last_stage_change_at:  null,
          raw:                   opp,
          synced_at:             syncedAt,
        });

        // Only insert backfill event if not already present
        if (!existingEventIds.has(id) && dateAdded) {
          eventRows.push({
            ghl_opportunity_id:    id,
            brand_id:              brandId,
            from_stage_normalized: null,
            to_stage_normalized:   normalName,
            changed_at:            dateAdded,
            source:                "backfill",
            raw:                   { pipelineStageId: stageId },
          });
          eventCount++;
        }
      }

      await upsertChunked(sb, "ghl_opportunities", oppRows, "ghl_opportunity_id");
      if (eventRows.length) await upsertChunked(sb, "ghl_opportunity_stage_events", eventRows, "id");

      oppCount += opps.length;
      process.stdout.write(`\r[${brand.slug}] page ${pageNum} | opps upserted: ${oppCount} | events written: ${eventCount}   `);
    }

    console.log(`\n[${brand.slug}] ✓ ${oppCount} opportunities | ${eventCount} new backfill events`);
  }

  console.log("\nBackfill complete.");
}

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
