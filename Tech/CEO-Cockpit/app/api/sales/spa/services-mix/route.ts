// app/api/sales/spa/services-mix/route.ts
//
// Service-level revenue mix for the Spa sales dashboard treemap.
//
// Source: `spa_services_by_employee_daily` (one row per service line item,
// populated from the Cockpit "Service - Spa" tab). Each row has a
// `service_name` and a `price_ex_vat`. We multiply by 1.18 to keep gross
// (inc-VAT) parity with the rest of the sales surface.
//
// Categories are derived at read time by `categorizeSpaService`. Unknown
// strings fall into "Other" so nothing is silently dropped.
//
// QC: returns a `qc` block with the canonical services total from
// `spa_revenue_daily` (inc-VAT, post migration 073). The page surfaces the
// delta so any ETL lag between the two tables is visible.

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  categorizeSpaService,
  SPA_GROUP_ORDER,
  SPA_GROUP_COLORS,
  type SpaGroup,
} from "@/lib/analytics/spa-services";

export const dynamic = "force-dynamic";

const VAT_MULT = 1.18;

interface ServiceRow {
  service_name: string | null;
  price_ex_vat: number | null;
}

interface CanonicalRow {
  services: number | null;
}

export interface SpaServicesMixServiceRow {
  service:      string;
  revenue:      number;   // inc-VAT
  tx_count:     number;
  nav_group:    SpaGroup;
  nav_category: string;
  pct:          number;
}

export interface SpaServicesMixGroupRow {
  group:         SpaGroup;
  color:         string;
  services:      SpaServicesMixServiceRow[];
  total_revenue: number;
  total_count:   number;
}

export interface SpaServicesMixResponse {
  byService: SpaServicesMixServiceRow[];
  byGroup:   SpaServicesMixGroupRow[];
  totals: {
    revenue:  number;   // sum from spa_services_by_employee_daily × 1.18
    tx_count: number;
  };
  qc: {
    canonical_services_revenue: number;   // sum from spa_revenue_daily.services
    delta:                      number;   // treemap_total − canonical
    delta_pct:                  number;
    status:                     "ok" | "warn" | "error";
  };
  generated_at: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to   = searchParams.get("to");
    if (!from || !to) {
      return NextResponse.json({ error: "Missing from/to params" }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    // ── 1. Service-level rows (treemap source) ─────────────────────────────
    const rows = await fetchAll<ServiceRow>(
      (off, lim) =>
        supabase
          .from("spa_services_by_employee_daily")
          .select("service_name, price_ex_vat")
          .gte("date_of_service", from)
          .lte("date_of_service", to)
          .range(off, off + lim - 1),
      "spa_services_by_employee_daily (services-mix)",
    );

    type AccRow = { service: string; revenue: number; tx_count: number; group: SpaGroup; category: string };
    const acc = new Map<string, AccRow>();
    let treemapTotal = 0;
    for (const r of rows) {
      const name = (r.service_name ?? "").trim();
      if (!name) continue;
      const incVat = (r.price_ex_vat ?? 0) * VAT_MULT;
      if (incVat <= 0) continue;
      const { group, category } = categorizeSpaService(name);
      const key = `${name}::${group}`;
      if (!acc.has(key)) {
        acc.set(key, { service: name, revenue: 0, tx_count: 0, group, category });
      }
      const a = acc.get(key)!;
      a.revenue  += incVat;
      a.tx_count += 1;
      treemapTotal += incVat;
    }

    const byService: SpaServicesMixServiceRow[] = Array.from(acc.values())
      .map(a => ({
        service:      a.service,
        revenue:      +a.revenue.toFixed(2),
        tx_count:     a.tx_count,
        nav_group:    a.group,
        nav_category: a.category,
        pct:          treemapTotal > 0 ? +((a.revenue / treemapTotal) * 100).toFixed(2) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const groupMap = new Map<SpaGroup, SpaServicesMixServiceRow[]>();
    for (const row of byService) {
      if (!groupMap.has(row.nav_group)) groupMap.set(row.nav_group, []);
      groupMap.get(row.nav_group)!.push(row);
    }

    const byGroup: SpaServicesMixGroupRow[] = SPA_GROUP_ORDER
      .filter(g => groupMap.has(g))
      .map(g => {
        const services = groupMap.get(g)!;
        return {
          group:         g,
          color:         SPA_GROUP_COLORS[g],
          services,
          total_revenue: services.reduce((s, v) => s + v.revenue, 0),
          total_count:   services.reduce((s, v) => s + v.tx_count, 0),
        };
      });

    const totals = {
      revenue:  +treemapTotal.toFixed(2),
      tx_count: byService.reduce((s, v) => s + v.tx_count, 0),
    };

    // ── 2. QC — canonical services total from spa_revenue_daily ───────────
    const canonicalRows = await fetchAll<CanonicalRow>(
      (off, lim) =>
        supabase
          .from("spa_revenue_daily")
          .select("services")
          .gte("date", from)
          .lte("date", to)
          .range(off, off + lim - 1),
      "spa_revenue_daily (services-mix QC)",
    );
    const canonical = canonicalRows.reduce((s, r) => s + (r.services ?? 0), 0);
    const delta     = totals.revenue - canonical;
    const deltaPct  = canonical > 0 ? (Math.abs(delta) / canonical) * 100 : 0;
    const status: "ok" | "warn" | "error" =
      deltaPct <= 0.5 ? "ok"
      : deltaPct <= 5 ? "warn"
      : "error";

    const qc = {
      canonical_services_revenue: Math.round(canonical),
      delta:                      Math.round(delta),
      delta_pct:                  +deltaPct.toFixed(2),
      status,
    };

    const response: SpaServicesMixResponse = {
      byService,
      byGroup,
      totals,
      qc,
      generated_at: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (error: unknown) {
    console.error("[api/sales/spa/services-mix] error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
