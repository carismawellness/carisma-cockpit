/**
 * POST /api/etl/klaviyo-flows-sync
 *
 * Fetches all active Klaviyo flows for each brand and upserts one daily
 * snapshot row per (snapshot_date, brand_id, flow_id) into klaviyo_flows_daily.
 *
 * Flow metrics come from the flow-values-report endpoint (trailing 30-day
 * window for each flow). We snapshot "today" (or body.date if provided).
 *
 * Body: { date?: "YYYY-MM-DD" }  (defaults to today)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const API_VERSION = "2024-10-15";

const BRAND_CONFIGS: { brandId: number; apiKey: string }[] = [
  { brandId: 1, apiKey: process.env.KLAVIYO_API_KEY_SPA     ?? "" },
  { brandId: 2, apiKey: process.env.KLAVIYO_API_KEY_AES     ?? "" },
  { brandId: 3, apiKey: process.env.KLAVIYO_API_KEY_SLIM    ?? "" },
];

async function kFetch(path: string, apiKey: string) {
  const res = await fetch(`${KLAVIYO_BASE}${path}`, {
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: API_VERSION,
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Klaviyo ${path} → ${res.status}`);
  return res.json();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFlows(apiKey: string): Promise<{ id: string; name: string; status: string }[]> {
  const flows: { id: string; name: string; status: string }[] = [];
  let url = `/flows?filter=equals(status,"live")&page[size]=50`;
  while (url) {
    const data = await kFetch(url, apiKey);
    for (const f of data.data ?? []) {
      flows.push({
        id: f.id,
        name: f.attributes?.name ?? f.id,
        status: f.attributes?.status ?? "live",
      });
    }
    url = data.links?.next ? data.links.next.replace(KLAVIYO_BASE, "") : null;
    if (url) await sleep(300);
  }
  return flows;
}

async function fetchFlowMetrics(flowId: string, apiKey: string) {
  // flow-values-report requires send_channel filter
  try {
    const body = {
      data: {
        type: "flow-values-report",
        attributes: {
          timeframe: { key: "last_30_days" },
          filter: `equals(send_channel,"email")`,
        },
        relationships: { flows: { data: [{ type: "flow", id: flowId }] } },
      },
    };
    const res = await fetch(`${KLAVIYO_BASE}/flow-values-reports/`, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: API_VERSION,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const stats = data?.data?.[0]?.attributes?.statistics ?? {};
    const recipients = stats.recipients ?? 0;
    const delivered  = stats.delivered ?? 0;
    const opens      = stats.opens ?? 0;
    const clicks     = stats.clicks ?? 0;
    const unsubs     = stats.unsubscribes ?? 0;
    return {
      recipients,
      delivered,
      opens,
      clicks,
      unsubscribes: unsubs,
      open_rate_pct:  delivered > 0 ? (opens  / delivered) * 100 : null,
      click_rate_pct: delivered > 0 ? (clicks / delivered) * 100 : null,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let snapshotDate: string;
  try {
    const body = await req.json().catch(() => ({}));
    snapshotDate = body.date ?? new Date().toISOString().slice(0, 10);
  } catch {
    snapshotDate = new Date().toISOString().slice(0, 10);
  }

  const supabase = getAdminClient();
  let totalUpserted = 0;
  const log: string[] = [];

  for (const { brandId, apiKey } of BRAND_CONFIGS) {
    if (!apiKey) { log.push(`[brand ${brandId}] no API key — skipped`); continue; }
    try {
      const flows = await fetchFlows(apiKey);
      log.push(`[brand ${brandId}] ${flows.length} live flows`);

      const rows = [];
      for (const flow of flows) {
        await sleep(350); // avoid 75-req/s burst
        const metrics = await fetchFlowMetrics(flow.id, apiKey);
        rows.push({
          snapshot_date:  snapshotDate,
          brand_id:       brandId,
          flow_id:        flow.id,
          flow_name:      flow.name,
          status:         flow.status,
          recipients:     metrics?.recipients     ?? 0,
          delivered:      metrics?.delivered      ?? 0,
          opens:          metrics?.opens          ?? 0,
          clicks:         metrics?.clicks         ?? 0,
          unsubscribes:   metrics?.unsubscribes   ?? 0,
          open_rate_pct:  metrics?.open_rate_pct  ?? null,
          click_rate_pct: metrics?.click_rate_pct ?? null,
        });
      }

      const { error } = await supabase
        .from("klaviyo_flows_daily")
        .upsert(rows, { onConflict: "snapshot_date,brand_id,flow_id" });

      if (error) throw error;
      totalUpserted += rows.length;
      log.push(`[brand ${brandId}] ${rows.length} rows upserted`);
    } catch (err) {
      log.push(`[brand ${brandId}] ERROR: ${String(err).slice(0, 200)}`);
    }
  }

  return NextResponse.json({ status: "ok", rows_upserted: totalUpserted, log: log.join("\n") });
}
