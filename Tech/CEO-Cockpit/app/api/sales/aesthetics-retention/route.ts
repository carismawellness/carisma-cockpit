// app/api/sales/aesthetics-retention/route.ts
//
// Client-retention analytics for Carisma Aesthetics, computed server-side
// from aesthetics_sales_daily (full-history scan, name-matched clients).
//
// Three metric families:
//   1. New vs Returning clients (selected period + trailing-12-month trend)
//   2. Consult → Treatment conversion (60-day window)
//   3. Tox (wrinkle-relaxer) 90-day recall compliance + recall work-list
//
// Purely additive — reads the same table other sales surfaces read, writes nothing.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  normalizeClientName,
  isUnmatchableClientName,
  displayClientName,
  isConsultationService,
  isToxService,
  daysBetween,
  addDays,
  median,
  computeNewReturning,
  trailingMonthWindows,
  type ClientTx,
} from "@/lib/analytics/retention";

export const dynamic = "force-dynamic";

// ── Tunables ──────────────────────────────────────────────────────────────────
const CONSULT_WINDOW_DAYS = 60;   // consult → first treatment conversion window
const TOX_CYCLE_DAYS      = 90;   // expected wrinkle-relaxer return interval
const TOX_DUE_SOON_DAYS   = 14;   // "due soon" = expected return within next 14 days
const WORK_LIST_CAP       = 100;
const TREND_MONTHS        = 12;

type AesRow = {
  customer:        string | null;
  service_product: string | null;
  date_of_service: string | null;
  price_inc_vat:   number | null;
  note_person:     string | null;
};

interface ClientRecord {
  txs: { date: string; service: string; amount: number; person: string | null }[];
}

export type ToxBucketKey = "onCycle" | "dueSoon" | "dueNow" | "lapsed" | "lost";

function toxBucket(daysSinceLastTox: number): ToxBucketKey {
  const overdue = daysSinceLastTox - TOX_CYCLE_DAYS;
  if (overdue < -TOX_DUE_SOON_DAYS) return "onCycle";
  if (overdue < 0)                  return "dueSoon";
  if (overdue <= 30)                return "dueNow";
  if (overdue <= 90)                return "lapsed";
  return "lost";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");
    if (!fromStr || !toStr) {
      return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    // Full-history scan, minimal columns (~4k rows as of Jun 2026).
    const rows = await fetchAll<AesRow>(
      (off, lim) =>
        supabase
          .from("aesthetics_sales_daily")
          .select("customer, service_product, date_of_service, price_inc_vat, note_person")
          .order("date_of_service", { ascending: true })
          .range(off, off + lim - 1),
      "aesthetics_sales_daily (retention)",
    );

    // ── Name matching + per-client transaction index ─────────────────────────
    const clients = new Map<string, ClientRecord>();
    let totalRevenue = 0, unmatchedRevenue = 0, unmatchedTx = 0, datedTx = 0;
    let historyStart: string | null = null;
    let lastDataDate: string | null = null;

    for (const r of rows) {
      const date = r.date_of_service;
      if (!date) continue;            // undated rows can't drive recency metrics
      datedTx++;
      const amount = r.price_inc_vat ?? 0;
      totalRevenue += amount;
      if (!historyStart || date < historyStart) historyStart = date;
      if (!lastDataDate || date > lastDataDate) lastDataDate = date;

      const norm = normalizeClientName(r.customer);
      if (isUnmatchableClientName(norm)) {
        unmatchedRevenue += amount;
        unmatchedTx++;
        continue;
      }
      if (!clients.has(norm)) clients.set(norm, { txs: [] });
      clients.get(norm)!.txs.push({
        date,
        service: r.service_product ?? "",
        amount,
        person: r.note_person,
      });
    }
    // rows arrive date-ordered, but undated/insert order can interleave — sort per client
    for (const c of clients.values()) c.txs.sort((a, b) => a.date.localeCompare(b.date));

    const today = new Date().toISOString().slice(0, 10);

    // ── 1. New vs Returning ───────────────────────────────────────────────────
    const flatTxs: ClientTx[] = [];
    for (const [name, rec] of clients) {
      for (const t of rec.txs) flatTxs.push({ client: name, date: t.date, amount: t.amount });
    }
    const newReturning = computeNewReturning(
      flatTxs, fromStr, toStr, trailingMonthWindows(today, TREND_MONTHS),
    );

    // ── 2. Consult → Treatment conversion ─────────────────────────────────────
    // Cohort: clients whose FIRST appearance (all transactions on their first
    // day) is Consultation-category, with that first consult inside [from, to].
    let cohortSize = 0, matured = 0, converted = 0, pending = 0;
    const daysToConvert: number[] = [];
    let convertedWindowRevenue = 0;

    for (const rec of clients.values()) {
      const firstDate = rec.txs[0].date;
      const firstDayTxs = rec.txs.filter(t => t.date === firstDate);
      if (!firstDayTxs.every(t => isConsultationService(t.service))) continue;
      if (firstDate < fromStr || firstDate > toStr) continue;
      cohortSize++;

      const deadline = addDays(firstDate, CONSULT_WINDOW_DAYS);
      const firstTreatment = rec.txs.find(
        t => t.date > firstDate && t.date <= deadline && !isConsultationService(t.service),
      );
      if (firstTreatment) {
        matured++; converted++;
        daysToConvert.push(daysBetween(firstDate, firstTreatment.date));
        convertedWindowRevenue += rec.txs
          .filter(t => t.date > firstDate && t.date <= deadline && !isConsultationService(t.service))
          .reduce((s, t) => s + t.amount, 0);
      } else if (lastDataDate && daysBetween(firstDate, lastDataDate) >= CONSULT_WINDOW_DAYS) {
        matured++;            // full 60-day window elapsed without a treatment
      } else {
        pending++;            // window still open — excluded from the rate
      }
    }

    const consults = {
      windowDays:           CONSULT_WINDOW_DAYS,
      cohortSize,
      matured,
      converted,
      pending,
      conversionRatePct:    matured > 0 ? Math.round((converted / matured) * 1000) / 10 : null,
      medianDaysToConvert:  median(daysToConvert),
      avgRevenuePerConverted: converted > 0 ? Math.round(convertedWindowRevenue / converted) : null,
    };

    // ── 3. Tox recall compliance ──────────────────────────────────────────────
    // Current-state metric: full history, bucketed by days since each client's
    // LATEST tox treatment vs the 90-day expected-return cycle.
    const buckets: Record<ToxBucketKey, { count: number; ltv: number }> = {
      onCycle: { count: 0, ltv: 0 },
      dueSoon: { count: 0, ltv: 0 },
      dueNow:  { count: 0, ltv: 0 },
      lapsed:  { count: 0, ltv: 0 },
      lost:    { count: 0, ltv: 0 },
    };
    type WorkItem = {
      client:       string;
      lastToxDate:  string;
      daysOverdue:  number;   // negative = due in N days
      bucket:       ToxBucketKey;
      practitioner: string | null;
      ltv:          number;
      toxVisits:    number;
      totalVisits:  number;
    };
    const workItems: WorkItem[] = [];

    for (const [name, rec] of clients) {
      const toxTxs = rec.txs.filter(t => isToxService(t.service));
      if (toxTxs.length === 0) continue;
      const lastTox = toxTxs[toxTxs.length - 1];
      const daysSince = daysBetween(lastTox.date, today);
      const bucket = toxBucket(daysSince);
      const ltv = Math.round(rec.txs.reduce((s, t) => s + t.amount, 0));
      buckets[bucket].count++;
      buckets[bucket].ltv += ltv;
      if (bucket === "dueSoon" || bucket === "dueNow" || bucket === "lapsed") {
        workItems.push({
          client:       displayClientName(name),
          lastToxDate:  lastTox.date,
          daysOverdue:  daysSince - TOX_CYCLE_DAYS,
          bucket,
          practitioner: lastTox.person ? displayClientName(normalizeClientName(lastTox.person)) : null,
          ltv,
          toxVisits:    toxTxs.length,
          totalVisits:  rec.txs.length,
        });
      }
    }

    // Most-recoverable first: due-now, then due-soon, then lapsed; high LTV first within each.
    const bucketPriority: Record<ToxBucketKey, number> = { dueNow: 0, dueSoon: 1, lapsed: 2, onCycle: 3, lost: 4 };
    workItems.sort((a, b) =>
      bucketPriority[a.bucket] - bucketPriority[b.bucket] || b.ltv - a.ltv,
    );

    const toxRecall = {
      cycleDays:      TOX_CYCLE_DAYS,
      dueSoonDays:    TOX_DUE_SOON_DAYS,
      totalToxClients: Object.values(buckets).reduce((s, b) => s + b.count, 0),
      buckets: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [k, { count: v.count, ltv: Math.round(v.ltv) }]),
      ),
      workList: workItems.slice(0, WORK_LIST_CAP),
      workListTotal: workItems.length,
    };

    return NextResponse.json({
      asOf:         today,
      historyStart,
      lastDataDate,
      matchQuality: {
        totalTx:                  datedTx,
        unmatchedTx,
        matchedClients:           clients.size,
        totalRevenue:             Math.round(totalRevenue),
        unmatchedRevenue:         Math.round(unmatchedRevenue),
        unmatchedRevenueSharePct: totalRevenue > 0
          ? Math.round((unmatchedRevenue / totalRevenue) * 1000) / 10
          : 0,
      },
      newReturning,
      consults,
      toxRecall,
    });
  } catch (error: unknown) {
    console.error("[api/sales/aesthetics-retention] error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
