/**
 * POST /api/etl/ghl-crm
 *
 * Pulls from all 3 GHL locations (Spa, Aesthetics, Slimming) and upserts:
 *   - crm_daily            (total_leads, leads_meta, leads_crm, appointments_booked,
 *                            total_sales, unreplied_whatsapp, unworked_leads,
 *                            conversion_rate_pct, etl_synced_at)
 *   - crm_lead_reconciliation  (leads_meta vs leads_crm by date)
 *   - crm_booking_mix          (treatment names from opportunity titles)
 *
 * Fields NOT populated (no GHL source — dashboard shows demo data):
 *   speed_to_lead_median_min, speed_to_lead_mean_min, total_calls,
 *   unreplied_crm, unreplied_email, deposit_pct, avg_daily_sales
 *
 * Required env vars:
 *   GHL_API_KEY            — Spa private integration token
 *   GHL_API_KEY_AESTHETICS — Aesthetics private integration token
 *   GHL_API_KEY_SLIMMING   — Slimming private integration token
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SUPABASE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// ── GHL config ────────────────────────────────────────────────────────────────

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_V    = "2021-07-28";

type GhlBrand = {
  slug: string;
  apiKey: string;
  locationId: string;
  // Stage IDs that count as "Booking Won" across all pipelines
  bookingWonStageIds: Set<string>;
};

function buildBrands(): GhlBrand[] {
  return [
    {
      slug: "spa",
      apiKey: process.env.GHL_API_KEY ?? "",
      locationId: "TrtSnBSSKBOkVVNxJ3AM",
      bookingWonStageIds: new Set([
        "aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c", // Call Pipeline — ✅ Booking Won
        "2619c29e-1aa3-401a-bd1b-b4dad2f9032e", // Chat Pipeline — ✅ Booking Won
      ]),
    },
    {
      slug: "aesthetics",
      apiKey: process.env.GHL_API_KEY_AESTHETICS ?? "",
      locationId: "Goi7kzVK7iwe2woxUHkT",
      bookingWonStageIds: new Set([
        "e4209bea-82d7-4802-ac5d-54fae9523360", // Call Pipeline — ✅ Booking Won
        "6536563b-0cf6-4622-9856-cb2a239d341a", // Chat Pipeline — ✅ Booking Won
      ]),
    },
    {
      slug: "slimming",
      apiKey: process.env.GHL_API_KEY_SLIMMING ?? "",
      locationId: "imWIWDcnmOfijW0lltPq",
      bookingWonStageIds: new Set([
        "e74d873e-001e-4746-8d55-35787a796ce0", // Call Pipeline — ✅ Booking Won
        "aadd78c7-a91c-4f5f-b0f8-3418f672c6f7", // Chat Pipeline — ✅ Booking Won
      ]),
    },
  ];
}

// ── GHL REST helper ───────────────────────────────────────────────────────────

async function ghlGet(
  path: string,
  apiKey: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(`${GHL_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_V,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GHL ${path} ${resp.status}: ${text.slice(0, 300)}`);
  }

  return resp.json();
}

// ── Contact stats per date ────────────────────────────────────────────────────

type DailyContactStats = { total: number; meta: number; unworked: number };

type ContactApiRow = {
  dateAdded: string;
  tags?: string[];
  attributionSource?: { utmSource?: string; medium?: string; sessionSource?: string };
};

async function fetchContactStats(
  brand: GhlBrand,
  fromMs: number,
  toMs: number,
  log: string[]
): Promise<Map<string, DailyContactStats>> {
  const byDate = new Map<string, DailyContactStats>();
  const toMsInclusive = toMs + 86_400_000;

  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  let prevCursor = "";
  const MAX_PAGES = 500; // up to 50,000 contacts
  let processed = 0;
  let pageCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      locationId: brand.locationId,
      limit: "100",
    };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/contacts/", brand.apiKey, params)) as {
      contacts?: ContactApiRow[];
      meta?: { startAfter?: number | string; startAfterId?: string };
    };

    const contacts = data.contacts ?? [];
    pageCount++;
    if (contacts.length === 0) break;

    let oldestInBatch = Infinity;

    for (const c of contacts) {
      const ts = new Date(c.dateAdded).getTime();
      if (ts < oldestInBatch) oldestInBatch = ts;
      processed++;
      if (ts > toMsInclusive || ts < fromMs) continue;

      const dateStr = c.dateAdded.slice(0, 10);
      const prev = byDate.get(dateStr) ?? { total: 0, meta: 0, unworked: 0 };

      const isMeta =
        c.attributionSource?.utmSource === "facebook" ||
        c.attributionSource?.medium   === "facebook" ||
        c.attributionSource?.sessionSource === "Paid Social";

      const isUnworked = Array.isArray(c.tags) && c.tags.includes("to-do");

      byDate.set(dateStr, {
        total:    prev.total    + 1,
        meta:     prev.meta     + (isMeta    ? 1 : 0),
        unworked: prev.unworked + (isUnworked ? 1 : 0),
      });
    }

    if (oldestInBatch < fromMs) break;
    if (data.meta?.startAfter === undefined || data.meta?.startAfter === null) break;

    const nextCursor = `${data.meta.startAfter}|${data.meta.startAfterId ?? ""}`;
    if (nextCursor === prevCursor) break;
    prevCursor   = nextCursor;
    startAfter   = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }

  log.push(`[${brand.slug}] contacts: ${pageCount} pages, ${processed} processed, ${byDate.size} dates with data`);
  return byDate;
}

// ── Booking stats per date ────────────────────────────────────────────────────

type DailyBookingStats = { count: number; revenue: number; treatments: string[] };

type OppApiRow = {
  name: string;
  monetaryValue?: number;
  pipelineStageId: string;
  createdAt: string;
};

async function fetchBookingStats(
  brand: GhlBrand,
  fromMs: number,
  toMs: number
): Promise<Map<string, DailyBookingStats>> {
  const byDate = new Map<string, DailyBookingStats>();
  const toMsInclusive = toMs + 86_400_000;

  let startAfter: string | undefined;
  let startAfterId: string | undefined;
  const MAX_PAGES = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      location_id: brand.locationId,
      status: "all",
      limit: "100",
    };
    if (startAfter)   params.startAfter   = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;

    const data = (await ghlGet("/opportunities/search", brand.apiKey, params)) as {
      opportunities?: OppApiRow[];
      meta?: { startAfter?: number; startAfterId?: string };
    };

    const opps = data.opportunities ?? [];
    if (opps.length === 0) break;

    let oldestInBatch = Infinity;

    for (const opp of opps) {
      const ts = new Date(opp.createdAt).getTime();
      if (ts < oldestInBatch) oldestInBatch = ts;
      if (ts > toMsInclusive || ts < fromMs) continue;
      if (!brand.bookingWonStageIds.has(opp.pipelineStageId)) continue;

      const dateStr = opp.createdAt.slice(0, 10);
      const prev = byDate.get(dateStr) ?? { count: 0, revenue: 0, treatments: [] };
      byDate.set(dateStr, {
        count:      prev.count + 1,
        revenue:    prev.revenue + (opp.monetaryValue ?? 0),
        treatments: opp.name ? [...prev.treatments, opp.name] : prev.treatments,
      });
    }

    if (oldestInBatch < fromMs) break;

    if (!data.meta?.startAfter) break;
    startAfter   = String(data.meta.startAfter);
    startAfterId = data.meta.startAfterId;
  }

  return byDate;
}

// ── Unread conversation snapshot ──────────────────────────────────────────────

async function fetchUnreadCount(brand: GhlBrand): Promise<number> {
  try {
    const data = (await ghlGet("/conversations/search", brand.apiKey, {
      locationId: brand.locationId,
      status: "unread",
      limit: "1",
    })) as { total?: number };
    return data.total ?? 0;
  } catch {
    return 0;
  }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createClient>;

function initSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key);
}

async function getBrandMap(sb: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await sb.from("brands").select("id, slug");
  if (error) throw new Error(`Brand map: ${error.message}`);
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as { id: number; slug: string }[]) map[row.slug] = row.id;
  return map;
}

async function upsertRows(
  sb: SupabaseClient,
  table: string,
  rows: object[],
  onConflict: string
): Promise<void> {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb.from(table) as any)
      .upsert(rows.slice(i, i + CHUNK) as Record<string, unknown>[], { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

// ── Date utilities ────────────────────────────────────────────────────────────

function parseDateStr(val: unknown, fallback: Date): Date {
  if (typeof val !== "string") return fallback;
  const d = new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

function allDatesInRange(fromMs: number, toMs: number): string[] {
  const dates: string[] = [];
  for (let t = fromMs; t <= toMs; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* no body */ }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const defaultTo   = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dateFrom = parseDateStr(body.date_from, defaultFrom);
  const dateTo   = parseDateStr(body.date_to, defaultTo);
  const fromMs   = dateFrom.getTime();
  const toMs     = dateTo.getTime();

  const syncedAt = new Date().toISOString();
  const supabase = initSupabase();
  const brandMap = await getBrandMap(supabase);

  const brands = buildBrands();
  const log: string[] = [];
  const errors: string[] = [];

  for (const brand of brands) {
    if (!brand.apiKey) {
      errors.push(`${brand.slug}: missing API key`);
      continue;
    }
    const brandId = brandMap[brand.slug];
    if (!brandId) {
      errors.push(`${brand.slug}: not found in brands table`);
      continue;
    }

    try {
      log.push(`[${brand.slug}] fetching contacts...`);
      const contactStats = await fetchContactStats(brand, fromMs, toMs, log);

      log.push(`[${brand.slug}] fetching bookings...`);
      const bookingStats = await fetchBookingStats(brand, fromMs, toMs);

      log.push(`[${brand.slug}] fetching unread count...`);
      const unreadCount = await fetchUnreadCount(brand);

      const dates = allDatesInRange(fromMs, toMs);
      const crmRows: object[] = [];
      const reconRows: object[] = [];

      for (const dateStr of dates) {
        const cs = contactStats.get(dateStr) ?? { total: 0, meta: 0, unworked: 0 };
        const bs = bookingStats.get(dateStr)  ?? { count: 0, revenue: 0, treatments: [] };

        const rawConvPct = cs.total > 0 ? (bs.count / cs.total) * 100 : null;
        const conversionPct = rawConvPct === null
          ? null
          : Math.min(Math.round(rawConvPct * 100) / 100, 999.99);

        crmRows.push({
          date:                 dateStr,
          brand_id:             brandId,
          total_leads:          cs.total   > 0 ? cs.total   : null,
          leads_meta:           cs.meta    > 0 ? cs.meta    : null,
          leads_crm:            cs.total   > 0 ? cs.total   : null,
          appointments_booked:  bs.count   > 0 ? bs.count   : null,
          total_sales:          bs.count   > 0 ? bs.revenue : null,
          // unreplied is a point-in-time snapshot — only meaningful for today
          unreplied_whatsapp:   dateStr === todayStr ? unreadCount : null,
          unworked_leads:       cs.unworked > 0 ? cs.unworked : null,
          conversion_rate_pct:  conversionPct,
          etl_synced_at:        syncedAt,
        });

        reconRows.push({
          date:      dateStr,
          brand_id:  brandId,
          leads_meta: cs.meta,
          leads_crm:  cs.total,
        });
      }

      await upsertRows(supabase, "crm_daily", crmRows, "date,brand_id");
      await upsertRows(supabase, "crm_lead_reconciliation", reconRows, "date,brand_id");

      // Build booking mix rows — aggregate treatment names from opportunity titles
      const mixRows: object[] = [];
      for (const [dateStr, bs] of bookingStats) {
        const treatCount = new Map<string, number>();
        for (const name of bs.treatments) {
          const norm = name.trim().slice(0, 120);
          if (!norm) continue;
          treatCount.set(norm, (treatCount.get(norm) ?? 0) + 1);
        }
        for (const [treatment_name, count] of treatCount) {
          mixRows.push({ date: dateStr, brand_id: brandId, treatment_name, count });
        }
      }
      await upsertRows(supabase, "crm_booking_mix", mixRows, "date,brand_id,treatment_name");

      const totalContacts = [...contactStats.values()].reduce((s, v) => s + v.total, 0);
      const totalBookings = [...bookingStats.values()].reduce((s, v) => s + v.count, 0);
      log.push(
        `[${brand.slug}] ✓ ${dates.length} days | ` +
        `${totalContacts} contacts | ${totalBookings} bookings | ${unreadCount} unread`
      );
    } catch (e) {
      const msg = `[${brand.slug}] ${String(e)}`;
      errors.push(msg);
      log.push(`ERROR — ${msg}`);
    }
  }

  const allFailed = errors.length === brands.length;
  return NextResponse.json(
    {
      status:   allFailed        ? "error"   :
                errors.length > 0 ? "partial" : "ok",
      date_from: dateFrom.toISOString().slice(0, 10),
      date_to:   dateTo.toISOString().slice(0, 10),
      errors:    errors.length > 0 ? errors : undefined,
      log:       log.join("\n"),
    },
    { status: allFailed ? 500 : 200 }
  );
}
