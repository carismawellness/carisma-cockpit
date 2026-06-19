// app/api/sales/slimming-retention/route.ts
//
// Program-health analytics for Carisma Slimming, computed server-side from
// slimming_treatments_daily (per-session grain) and slimming_sales_daily
// (programme/product sales), name-matched across the two tables.
//
// Three metric families:
//   1. Active patient census (last session ≤21d active / 22–45d at-risk / >45d inactive)
//      + 12-month active-count trend at each month-end
//   2. At-risk work-list (the churn-save call list)
//   3. New vs Returning clients on slimming sales (period + trailing-12-month trend)
//
// Purely additive — reads existing tables, writes nothing.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  normalizeClientName,
  isUnmatchableClientName,
  displayClientName,
  daysBetween,
  computeNewReturning,
  trailingMonthWindows,
  type ClientTx,
} from "@/lib/analytics/retention";

export const dynamic = "force-dynamic";

// ── Tunables ──────────────────────────────────────────────────────────────────
const ACTIVE_DAYS    = 21;   // session within last 21 days  → active
const AT_RISK_DAYS   = 45;   // 22–45 days since last session → at-risk; >45 → inactive
const WORK_LIST_CAP  = 100;
const TREND_MONTHS   = 12;

type TxRow = {
  client:          string | null;
  treatment:       string | null;
  date_of_service: string | null;
  therapist:       string | null;
};

type SaleRow = {
  client:          string | null;
  service_description: string | null;
  date_of_service: string | null;
  paid:            number | null;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromStr = searchParams.get("from");
    const toStr   = searchParams.get("to");
    if (!fromStr || !toStr) {
      return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    const [txRows, saleRows] = await Promise.all([
      fetchAll<TxRow>(
        (off, lim) =>
          supabase
            .from("slimming_treatments_daily")
            .select("client, treatment, date_of_service, therapist")
            .order("date_of_service", { ascending: true })
            .range(off, off + lim - 1),
        "slimming_treatments_daily (retention)",
      ),
      fetchAll<SaleRow>(
        (off, lim) =>
          supabase
            .from("slimming_sales_daily")
            .select("client, service_description, date_of_service, paid")
            .order("date_of_service", { ascending: true })
            .range(off, off + lim - 1),
        "slimming_sales_daily (retention)",
      ),
    ]);

    const today = new Date().toISOString().slice(0, 10);

    // ── Session index (treatments table) ──────────────────────────────────────
    interface PatientSessions {
      sessions: { date: string; treatment: string | null; therapist: string | null }[];
    }
    const patients = new Map<string, PatientSessions>();
    let totalSessions = 0, namedSessions = 0;
    let lastSessionDate: string | null = null;
    let lastNamedSessionDate: string | null = null;

    for (const r of txRows) {
      const date = r.date_of_service;
      if (!date) continue;
      totalSessions++;
      if (!lastSessionDate || date > lastSessionDate) lastSessionDate = date;
      const norm = normalizeClientName(r.client);
      if (isUnmatchableClientName(norm)) continue;
      namedSessions++;
      if (!lastNamedSessionDate || date > lastNamedSessionDate) lastNamedSessionDate = date;
      if (!patients.has(norm)) patients.set(norm, { sessions: [] });
      patients.get(norm)!.sessions.push({ date, treatment: r.treatment, therapist: r.therapist });
    }
    for (const p of patients.values()) p.sessions.sort((a, b) => a.date.localeCompare(b.date));

    // ── Sales revenue per client (for LTV join on the work-list) ─────────────
    const revenueByClient = new Map<string, number>();
    let salesTotalRevenue = 0, salesUnmatchedRevenue = 0;
    const salesTxs: ClientTx[] = [];
    for (const r of saleRows) {
      const date = r.date_of_service;
      if (!date) continue;
      const amount = r.paid ?? 0;
      salesTotalRevenue += amount;
      const norm = normalizeClientName(r.client);
      if (isUnmatchableClientName(norm)) {
        salesUnmatchedRevenue += amount;
        continue;
      }
      revenueByClient.set(norm, (revenueByClient.get(norm) ?? 0) + amount);
      salesTxs.push({ client: norm, date, amount });
    }

    // ── 1. Census ─────────────────────────────────────────────────────────────
    let active = 0, atRisk = 0, inactive = 0;
    type AtRiskItem = {
      client:          string;
      lastSessionDate: string;
      daysSince:       number;
      lastTreatment:   string | null;
      lastTherapist:   string | null;
      totalSessions:   number;
      totalRevenue:    number;   // joined from slimming_sales_daily by name
    };
    const atRiskItems: AtRiskItem[] = [];

    for (const [name, p] of patients) {
      const last = p.sessions[p.sessions.length - 1];
      const daysSince = daysBetween(last.date, today);
      if (daysSince <= ACTIVE_DAYS) active++;
      else if (daysSince <= AT_RISK_DAYS) {
        atRisk++;
        atRiskItems.push({
          client:          displayClientName(name),
          lastSessionDate: last.date,
          daysSince,
          lastTreatment:   last.treatment,
          lastTherapist:   last.therapist,
          totalSessions:   p.sessions.length,
          totalRevenue:    Math.round(revenueByClient.get(name) ?? 0),
        });
      } else inactive++;
    }
    // Highest-value saves first
    atRiskItems.sort((a, b) => b.totalRevenue - a.totalRevenue || b.totalSessions - a.totalSessions);

    // Active-count trend: distinct named clients with a session in the 21 days
    // ending at each trailing month-end.
    const trend = trailingMonthWindows(today, TREND_MONTHS).map(({ month, end }) => {
      const monthEnd = end <= today ? end : today;
      const windowStart = (() => {
        const d = new Date(monthEnd + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - (ACTIVE_DAYS - 1));
        return d.toISOString().slice(0, 10);
      })();
      let count = 0;
      for (const p of patients.values()) {
        if (p.sessions.some(s => s.date >= windowStart && s.date <= monthEnd)) count++;
      }
      return { month, monthEnd, active: count };
    });

    // ── 3. New vs Returning (sales table) ─────────────────────────────────────
    const newReturning = computeNewReturning(
      salesTxs, fromStr, toStr, trailingMonthWindows(today, TREND_MONTHS),
    );

    let salesHistoryStart: string | null = null;
    for (const t of salesTxs) {
      if (!salesHistoryStart || t.date < salesHistoryStart) salesHistoryStart = t.date;
    }

    return NextResponse.json({
      asOf: today,
      treatments: {
        totalSessions,
        namedSessions,
        nameCoveragePct: totalSessions > 0
          ? Math.round((namedSessions / totalSessions) * 1000) / 10
          : 0,
        lastSessionDate,
        lastNamedSessionDate,
      },
      census: {
        activeDays:  ACTIVE_DAYS,
        atRiskDays:  AT_RISK_DAYS,
        active,
        atRisk,
        inactive,
        totalPatients: patients.size,
        trend,
      },
      atRiskList:      atRiskItems.slice(0, WORK_LIST_CAP),
      atRiskListTotal: atRiskItems.length,
      salesMatchQuality: {
        historyStart:             salesHistoryStart,
        totalRevenue:             Math.round(salesTotalRevenue),
        unmatchedRevenue:         Math.round(salesUnmatchedRevenue),
        unmatchedRevenueSharePct: salesTotalRevenue > 0
          ? Math.round((salesUnmatchedRevenue / salesTotalRevenue) * 1000) / 10
          : 0,
      },
      newReturning,
    });
  } catch (error: unknown) {
    console.error("[api/sales/slimming-retention] error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
