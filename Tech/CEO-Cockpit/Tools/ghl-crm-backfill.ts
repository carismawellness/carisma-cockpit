/**
 * GHL CRM historical backfill: Jan 1 2025 → today
 * Calls the GHL API directly and upserts to crm_daily, crm_booking_mix, crm_lead_reconciliation.
 * Requires crm_daily table to exist (migration 063).
 *
 * Run: npx tsx --env-file .env.production.local Tools/ghl-crm-backfill.ts
 */

for (const key of Object.keys(process.env)) {
  const v = process.env[key];
  if (typeof v === "string") process.env[key] = v.replace(/\\n$/g, "").trim();
}

import { createClient } from "@supabase/supabase-js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

const BRANDS = [
  {
    slug: "spa",
    apiKey: process.env.GHL_API_KEY ?? "",
    locationId: "TrtSnBSSKBOkVVNxJ3AM",
    bookingWonStageIds: new Set([
      "aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c",
      "2619c29e-1aa3-401a-bd1b-b4dad2f9032e",
    ]),
  },
  {
    slug: "aesthetics",
    apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "",
    locationId: "Goi7kzVK7iwe2woxUHkT",
    bookingWonStageIds: new Set([
      "e4209bea-82d7-4802-ac5d-54fae9523360",
      "6536563b-0cf6-4622-9856-cb2a239d341a",
    ]),
  },
  {
    slug: "slimming",
    apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",
    locationId: "imWIWDcnmOfijW0lltPq",
    bookingWonStageIds: new Set([
      "e74d873e-001e-4746-8d55-35787a796ce0",
      "aadd78c7-a91c-4f5f-b0f8-3418f672c6f7",
    ]),
  },
];

async function ghlGet(path: string, apiKey: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, Version: GHL_V, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`GHL ${path} ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

async function fetchContactStats(brand: typeof BRANDS[0], fromMs: number, toMs: number) {
  const byDate = new Map<string, { total: number; meta: number; unworked: number }>();
  let startAfter: string | undefined;
  let startAfterId: string | undefined;

  for (let page = 0; page < 300; page++) {
    const params: Record<string, string> = { locationId: brand.locationId, limit: "100" };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/contacts/", brand.apiKey, params)) as {
      contacts?: any[];
      meta?: { startAfter?: number; startAfterId?: string };
    };
    const contacts = data.contacts ?? [];
    if (!contacts.length) break;

    let oldest = Infinity;
    for (const c of contacts) {
      const ts = new Date(c.dateAdded).getTime();
      if (ts < oldest) oldest = ts;
      if (ts > toMs + 86_400_000 || ts < fromMs) continue;
      const dateStr = c.dateAdded.slice(0, 10);
      const prev = byDate.get(dateStr) ?? { total: 0, meta: 0, unworked: 0 };
      const isMeta =
        c.attributionSource?.utmSource === "facebook" ||
        c.attributionSource?.medium   === "facebook" ||
        c.attributionSource?.sessionSource === "Paid Social";
      const isUnworked = Array.isArray(c.tags) && c.tags.includes("to-do");
      byDate.set(dateStr, { total: prev.total + 1, meta: prev.meta + (isMeta ? 1 : 0), unworked: prev.unworked + (isUnworked ? 1 : 0) });
    }
    if (oldest < fromMs) break;
    if (!data.meta?.startAfter) break;
    startAfter   = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }
  return byDate;
}

async function fetchBookingStats(brand: typeof BRANDS[0], fromMs: number, toMs: number) {
  const byDate = new Map<string, { count: number; revenue: number; treatments: string[] }>();
  let startAfter: string | undefined;
  let startAfterId: string | undefined;

  for (let page = 0; page < 100; page++) {
    const params: Record<string, string> = { location_id: brand.locationId, status: "all", limit: "100" };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/opportunities/search", brand.apiKey, params)) as {
      opportunities?: any[];
      meta?: { startAfter?: number; startAfterId?: string };
    };
    const opps = data.opportunities ?? [];
    if (!opps.length) break;

    let oldest = Infinity;
    for (const opp of opps) {
      const ts = new Date(opp.createdAt).getTime();
      if (ts < oldest) oldest = ts;
      if (ts > toMs + 86_400_000 || ts < fromMs) continue;
      if (!brand.bookingWonStageIds.has(opp.pipelineStageId)) continue;
      const dateStr = opp.createdAt.slice(0, 10);
      const prev = byDate.get(dateStr) ?? { count: 0, revenue: 0, treatments: [] };
      byDate.set(dateStr, {
        count:      prev.count + 1,
        revenue:    prev.revenue + (opp.monetaryValue ?? 0),
        treatments: opp.name ? [...prev.treatments, opp.name] : prev.treatments,
      });
    }
    if (oldest < fromMs) break;
    if (!data.meta?.startAfter) break;
    startAfter   = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }
  return byDate;
}

async function upsert(sb: ReturnType<typeof createClient>, table: string, rows: object[], onConflict: string) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await (sb.from(table) as any).upsert(rows.slice(i, i + 200) as any[], { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

function allDates(fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  for (let t = fromMs; t <= toMs; t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: brandRows } = await (sb.from("brands") as any).select("id, slug");
  const brandMap: Record<string, number> = {};
  for (const r of (brandRows ?? []) as { id: number; slug: string }[]) brandMap[r.slug] = r.id;

  const fromMs = new Date("2025-01-01T00:00:00Z").getTime();
  const toMs   = new Date().setUTCHours(0, 0, 0, 0);
  const syncedAt = new Date().toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);

  console.log(`GHL CRM backfill: 2025-01-01 → ${todayStr}`);

  for (const brand of BRANDS) {
    if (!brand.apiKey) { console.log(`SKIP ${brand.slug}: no API key`); continue; }
    const brandId = brandMap[brand.slug];
    if (!brandId) { console.log(`SKIP ${brand.slug}: not in brands table`); continue; }

    console.log(`[${brand.slug}] fetching...`);
    const contacts = await fetchContactStats(brand, fromMs, toMs);
    const bookings = await fetchBookingStats(brand, fromMs, toMs);

    const dates = allDates(fromMs, toMs);
    const crmRows: object[] = [];
    const reconRows: object[] = [];

    for (const d of dates) {
      const cs = contacts.get(d) ?? { total: 0, meta: 0, unworked: 0 };
      const bs = bookings.get(d)  ?? { count: 0, revenue: 0, treatments: [] };
      const rawConvPct = cs.total > 0 ? (bs.count / cs.total) * 100 : null;
      const convPct = rawConvPct === null ? null : Math.min(Math.round(rawConvPct * 100) / 100, 999.99);
      crmRows.push({
        date: d, brand_id: brandId,
        total_leads:         cs.total   > 0 ? cs.total   : null,
        leads_meta:          cs.meta    > 0 ? cs.meta    : null,
        leads_crm:           cs.total   > 0 ? cs.total   : null,
        appointments_booked: bs.count   > 0 ? bs.count   : null,
        total_sales:         bs.count   > 0 ? bs.revenue : null,
        unreplied_whatsapp:  d === todayStr ? 0 : null,
        unworked_leads:      cs.unworked > 0 ? cs.unworked : null,
        conversion_rate_pct: convPct,
        etl_synced_at:       syncedAt,
      });
      reconRows.push({ date: d, brand_id: brandId, leads_meta: cs.meta, leads_crm: cs.total });
    }

    await upsert(sb, "crm_daily", crmRows, "date,brand_id");
    await upsert(sb, "crm_lead_reconciliation", reconRows, "date,brand_id");

    const mixRows: object[] = [];
    for (const [d, bs] of bookings) {
      const counts = new Map<string, number>();
      for (const name of bs.treatments) {
        const n = name.trim().slice(0, 120);
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      for (const [treatment_name, count] of counts) mixRows.push({ date: d, brand_id: brandId, treatment_name, count });
    }
    await upsert(sb, "crm_booking_mix", mixRows, "date,brand_id,treatment_name");

    const totalC = [...contacts.values()].reduce((s, v) => s + v.total, 0);
    const totalB = [...bookings.values()].reduce((s, v) => s + v.count, 0);
    console.log(`[${brand.slug}] ✓ ${totalC} contacts | ${totalB} bookings`);
  }
  console.log("Done");
}

main().catch(e => { console.error("✗", e.message); process.exit(1); });
