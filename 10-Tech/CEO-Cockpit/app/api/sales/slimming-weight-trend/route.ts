// app/api/sales/slimming-weight-trend/route.ts
//
// Builds a chronological weekly trend from the Weight Tracker sheet.
//
// Algorithm per client:
//   1. Parse their Program Start date (column B)
//   2. Week N weigh-in date = Program Start + N × 7 days
//   3. Compare each valid reading to the previous valid reading
//      (not to starting weight) to determine that week's outcome
//
// Aggregate per calendar week (Monday anchor):
//   - weighed: clients with a non-null reading that week
//   - losing / plateau / gaining: breakdown of outcomes
//   - losingPct: losing / weighed × 100

import { NextResponse } from "next/server";
import { parseCSV } from "@/lib/etl/csv";
import {
  slimmingMasterCsvUrl,
  SLIMMING_MASTER_TABS,
} from "@/lib/constants/slimming-master-sheet";
import type {
  WeeklyTrendPoint,
  SlimmingWeightTrendData,
} from "@/lib/types/slimming-weight";

export const dynamic = "force-dynamic";

const WEEK_COUNT      = 24;
const DELTA_THRESHOLD = 0.15;   // kg — change smaller than this is "plateau"

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDateDMY(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return isNaN(Date.parse(iso)) ? null : iso;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseWeight(raw: string): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "no tanita" || s === "-" || s === "—" || s === "/" || s === "n/a") return null;
  const v = parseFloat(s.replace(",", "."));
  return Number.isFinite(v) && v > 5 ? v : null;
}

/** Add N days to an ISO date string, return ISO date string. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Return the Monday (ISO) of the week containing the given ISO date. */
function weekMonday(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(isoMonday: string): string {
  const d = new Date(isoMonday + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const csvUrl = slimmingMasterCsvUrl(SLIMMING_MASTER_TABS.WEIGHT_TRACKER.gid);

  let text: string;
  try {
    const resp = await fetch(csvUrl, { redirect: "follow", cache: "no-store" });
    if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
    text = await resp.text();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  const rows = parseCSV(text);
  if (rows.length < 2) return NextResponse.json({ error: "Sheet empty" }, { status: 502 });

  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    if (rows[i].filter(c => c.trim()).length >= 3) { headerIdx = i; break; }
  }
  const headers = rows[headerIdx].map(h => h.trim().toLowerCase());

  const nameIdx  = headers.indexOf("name");
  const progIdx  = headers.indexOf("program start");
  const weekIdxs: number[] = [];
  for (let w = 1; w <= WEEK_COUNT; w++) weekIdxs.push(headers.indexOf(`${w} week`));

  if (nameIdx === -1) return NextResponse.json({ error: "Name column not found" }, { status: 502 });

  // ── Build per-calendar-week buckets ──────────────────────────────────────────
  // Map: weekMonday (ISO) → { weighed, losing, plateau, gaining }
  const buckets = new Map<string, { weighed: number; losing: number; plateau: number; gaining: number }>();

  const seenNames = new Set<string>();

  for (const row of rows.slice(headerIdx + 1)) {
    const rawName = (row[nameIdx] ?? "").trim();
    if (!rawName || rawName.toLowerCase() === "name" || rawName.length < 2) continue;
    if (rawName.toLowerCase() === "x") continue;

    // Dedup: skip duplicate client rows (keep first encountered)
    const key = rawName.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const programStart = progIdx >= 0 ? parseDateDMY(row[progIdx] ?? "") : null;
    if (!programStart) continue; // can't place on timeline without a start date

    const weeklyReadings: (number | null)[] = weekIdxs.map(idx =>
      idx >= 0 ? parseWeight(row[idx] ?? "") : null,
    );

    // Walk through weeks; compare each valid reading to the previous valid reading
    let prevWeight: number | null = null;

    for (let w = 0; w < WEEK_COUNT; w++) {
      const reading = weeklyReadings[w];
      if (reading === null) continue; // no weigh-in this week

      // Calendar date of this weigh-in = program start + (w+1) weeks
      const weighInDate = addDays(programStart, (w + 1) * 7);
      const monday = weekMonday(weighInDate);

      if (!buckets.has(monday)) {
        buckets.set(monday, { weighed: 0, losing: 0, plateau: 0, gaining: 0 });
      }
      const bucket = buckets.get(monday)!;
      bucket.weighed++;

      if (prevWeight !== null) {
        const delta = reading - prevWeight;
        if (delta < -DELTA_THRESHOLD)      bucket.losing++;
        else if (delta > DELTA_THRESHOLD)  bucket.gaining++;
        else                               bucket.plateau++;
      } else {
        // First reading after baseline — no prior to compare, count as plateau
        bucket.plateau++;
      }

      prevWeight = reading;
    }
  }

  // ── Sort and format weeks ─────────────────────────────────────────────────────
  const weeks: WeeklyTrendPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monday, b]) => ({
      weekStart:  monday,
      weekLabel:  fmtWeekLabel(monday),
      weighed:    b.weighed,
      losing:     b.losing,
      plateau:    b.plateau,
      gaining:    b.gaining,
      losingPct:  b.weighed > 0
        ? Math.round((b.losing / b.weighed) * 1000) / 10
        : null,
    }));

  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({ asOf: today, weeks } satisfies SlimmingWeightTrendData);
}
