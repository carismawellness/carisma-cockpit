// app/api/sales/slimming-weight/route.ts
//
// Reads weekly weight readings for every Slimming client directly from the
// "Clients weight record" tab of the Carisma Slimming Master Google Sheet,
// then computes progress metrics and a "call list" of clients not losing weight.
//
// Sheet format (columns A–Z):
//   A: Name
//   B: Starting weight  (kg, or "No tanita" / empty if no baseline)
//   C: 1 week  …  Z: 24 week  (kg readings; "0" means missed weigh-in)
//
// Zero-auth fetch — sheet must be shared as "Anyone with the link can view".

import { NextResponse } from "next/server";
import { parseCSV } from "@/lib/etl/csv";
import {
  slimmingMasterCsvUrl,
  SLIMMING_MASTER_TABS,
} from "@/lib/constants/slimming-master-sheet";
import type {
  WeightClient,
  WeightTrend,
  WeightStatus,
  SlimmingWeightData,
} from "@/lib/types/slimming-weight";

export const dynamic = "force-dynamic";

const WEEK_COUNT = 24;
const ON_TRACK_THRESHOLD  =  0.3;   // % — must have lost at least this much
const GAINING_THRESHOLD   = -0.3;   // % — below this is "gaining"
const TREND_MIN_DELTA_KG  =  0.15;  // kg change to register as movement

// ── Weight parser ─────────────────────────────────────────────────────────────

function parseWeight(raw: string): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "no tanita" || s === "-" || s === "—" || s === "n/a") return null;
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) && v > 5 ? v : null;   // < 5 kg is implausible
}

// ── Trend from last two valid readings ───────────────────────────────────────

function computeTrend(readings: (number | null)[]): WeightTrend {
  const valid = readings.filter((w): w is number => w !== null);
  if (valid.length >= 2) {
    const last = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    const delta = last - prev;
    if (delta < -TREND_MIN_DELTA_KG) return "down";   // losing — good
    if (delta >  TREND_MIN_DELTA_KG) return "up";     // gaining — bad
    return "flat";
  }
  if (valid.length === 1) return "new";
  return null;
}

// ── Status classification ─────────────────────────────────────────────────────

function computeStatus(
  startWeight: number | null,
  weeksLogged: number,
  pctLost: number | null,
): WeightStatus {
  if (!startWeight) return "no_baseline";
  if (weeksLogged === 0) return "awaiting";
  if (pctLost === null) return "awaiting";
  if (pctLost > ON_TRACK_THRESHOLD) return "on_track";
  if (pctLost < GAINING_THRESHOLD) return "gaining";
  return "plateau";
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const csvUrl = slimmingMasterCsvUrl(SLIMMING_MASTER_TABS.WEIGHT_RECORD.gid);

  let text: string;
  try {
    const resp = await fetch(csvUrl, { redirect: "follow", cache: "no-store" });
    if (!resp.ok) {
      const status = resp.status;
      if (status === 403 || status === 401) {
        return NextResponse.json(
          {
            error:
              "The Carisma Slimming Master sheet is not publicly accessible. " +
              "Open the sheet → Share → Anyone with the link → Viewer, then retry.",
            sheetAccessible: false,
          },
          { status: 503 },
        );
      }
      throw new Error(`Sheet CSV fetch failed with status ${status}`);
    }
    text = await resp.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── Parse CSV ───────────────────────────────────────────────────────────────
  const rows = parseCSV(text);
  if (rows.length < 2) {
    return NextResponse.json({ error: "Sheet appears empty or unreadable" }, { status: 502 });
  }

  // Find the header row (first row with ≥ 3 non-empty cells)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (rows[i].filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = rows[headerIdx].map(h => h.trim().toLowerCase());

  const nameIdx  = headers.indexOf("name");
  const startIdx = headers.indexOf("starting weight");

  if (nameIdx === -1 || startIdx === -1) {
    return NextResponse.json(
      { error: `Required columns not found. Got: ${headers.slice(0, 6).join(", ")}` },
      { status: 502 },
    );
  }

  // Map week column indices — "1 week", "2 week", ..., "24 week"
  const weekIdxs: number[] = [];
  for (let w = 1; w <= WEEK_COUNT; w++) {
    weekIdxs.push(headers.indexOf(`${w} week`));
  }

  // ── Parse client rows ───────────────────────────────────────────────────────
  // Deduplicate by normalised name — keep the row with more valid readings.
  const byName = new Map<string, WeightClient>();

  for (const row of rows.slice(headerIdx + 1)) {
    const rawName = (row[nameIdx] ?? "").trim();
    // Skip blanks, header echoes, and single-char placeholders ("x")
    if (!rawName || rawName.toLowerCase() === "name" || rawName.length < 2) continue;
    if (rawName.toLowerCase() === "x") continue;

    const startWeight = parseWeight(row[startIdx] ?? "");

    const weeklyReadings: (number | null)[] = weekIdxs.map(idx =>
      idx >= 0 ? parseWeight(row[idx] ?? "") : null,
    );

    const validReadings = weeklyReadings.filter((w): w is number => w !== null);
    const weeksLogged   = validReadings.length;
    const currentWeight = weeksLogged > 0 ? validReadings[validReadings.length - 1] : null;

    let weightLost: number | null = null;
    let pctLost: number | null = null;
    if (startWeight !== null && currentWeight !== null) {
      weightLost = Math.round((startWeight - currentWeight) * 10) / 10;
      pctLost    = Math.round((weightLost / startWeight) * 1000) / 10;
    }

    const trend  = computeTrend(weeklyReadings);
    const status = computeStatus(startWeight, weeksLogged, pctLost);

    const client: WeightClient = {
      name: rawName,
      startWeight,
      currentWeight,
      weightLost,
      pctLost,
      weeksLogged,
      trend,
      status,
    };

    const key = rawName.toLowerCase();
    const existing = byName.get(key);
    if (!existing || weeksLogged > existing.weeksLogged) {
      byName.set(key, client);
    }
  }

  // ── Compute summary ─────────────────────────────────────────────────────────
  const clients: WeightClient[] = Array.from(byName.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  const onTrack    = clients.filter(c => c.status === "on_track");
  const plateaued  = clients.filter(c => c.status === "plateau");
  const gaining    = clients.filter(c => c.status === "gaining");
  const awaiting   = clients.filter(c => c.status === "awaiting");
  const noBaseline = clients.filter(c => c.status === "no_baseline");

  const withData = clients.filter(
    c => c.status !== "awaiting" && c.status !== "no_baseline",
  );

  const pctValues = withData
    .map(c => c.pctLost)
    .filter((p): p is number => p !== null);

  const avgPctLost =
    pctValues.length > 0
      ? Math.round((pctValues.reduce((a, b) => a + b, 0) / pctValues.length) * 10) / 10
      : null;

  const totalKgLost =
    Math.round(
      withData
        .filter(c => (c.weightLost ?? 0) > 0)
        .reduce((sum, c) => sum + (c.weightLost ?? 0), 0) * 10,
    ) / 10;

  // ── Not-losing-weight call list ─────────────────────────────────────────────
  // Gaining first (most weight gained → top), then plateau (longest stall → top)
  const notLosingWeight: WeightClient[] = [
    ...gaining.sort((a, b) => (a.pctLost ?? 0) - (b.pctLost ?? 0)),   // most negative first
    ...plateaued.sort((a, b) => (b.weeksLogged ?? 0) - (a.weeksLogged ?? 0)), // longest plateau first
  ];

  const today = new Date().toISOString().slice(0, 10);

  const response: SlimmingWeightData = {
    asOf: today,
    sheetAccessible: true,
    summary: {
      totalClients:    clients.length,
      clientsWithData: withData.length,
      onTrack:         onTrack.length,
      plateaued:       plateaued.length,
      gaining:         gaining.length,
      awaiting:        awaiting.length,
      noBaseline:      noBaseline.length,
      avgPctLost,
      totalKgLost,
    },
    clients,
    notLosingWeight,
  };

  return NextResponse.json(response);
}
