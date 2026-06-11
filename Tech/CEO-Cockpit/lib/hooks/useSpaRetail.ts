"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetch-all";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetailRow {
  id:            number;
  date:          string;          // YYYY-MM-DD
  location_id:   number;
  employee_name: string | null;
  product_name:  string | null;
  product_brand: string | null;
  amount_ex_vat: number | null;
}

export interface RetailByLocation {
  location_id:    number;
  name:           string;          // hotel display name
  color:          string;          // cream palette per hotel
  revenue_gross:  number;          // inc-VAT
  tx_count:       number;          // transaction lines
}

export interface RetailByEmployee {
  employee_name:  string;
  revenue_gross:  number;          // inc-VAT
  tx_count:       number;
}

export interface RetailByBrand {
  brand:          string;
  revenue_gross:  number;
  tx_count:       number;
  pct:            number;
}

export interface RetailTotals {
  revenue_gross:  number;          // inc-VAT
  revenue_ex_vat: number;
  tx_count:       number;
  aov:            number;          // inc-VAT / tx_count
  last_synced:    string | null;
}

export interface UseSpaRetailResult {
  rows:        RetailRow[];
  byLocation:  RetailByLocation[];
  byEmployee:  RetailByEmployee[];
  byBrand:     RetailByBrand[];
  totals:      RetailTotals;
  isFetching:  boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VAT_RATE = 0.18;

// Same cream palette as the brand-breakdown chart so hotels read consistently.
const SPA_LOCATION_META: Record<number, { name: string; color: string }> = {
  1: { name: "Inter",     color: "#3D2D1A" },
  2: { name: "Hugos",     color: "#C49862" },
  3: { name: "Hyatt",     color: "#7A3F35" },
  4: { name: "Ramla",     color: "#8C7A5A" },
  5: { name: "Riviera",   color: "#D9B98C" },
  6: { name: "Odycy",     color: "#7E8055" },
  7: { name: "Excelsior", color: "#A0522D" },
  8: { name: "Novotel",   color: "#E8D9B9" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeName(raw: string | null): string {
  if (!raw) return "(Unassigned)";
  return raw.trim().replace(/\s+/g, " ");
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpaRetail(dateFrom: Date, dateTo: Date): UseSpaRetailResult {
  const supabase = createClient();
  const fromStr = toDateStr(dateFrom);
  const toStr   = toDateStr(dateTo);

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["spa-retail", fromStr, toStr],
    queryFn: async () => {
      const data = await fetchAll(
        (off, lim) =>
          supabase
            .from("spa_retail_by_employee_daily")
            .select("id, date, location_id, employee_name, product_name, product_brand, amount_ex_vat")
            .gte("date", fromStr)
            .lte("date", toStr)
            .order("date", { ascending: true })
            .range(off, off + lim - 1),
        "spa_retail_by_employee_daily",
      ) as RetailRow[];
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // ── By location ─────────────────────────────────────────────────────────────
  const locMap = new Map<number, { revenue_ex: number; tx_count: number }>();
  for (const r of rows) {
    const k = r.location_id;
    const cur = locMap.get(k) ?? { revenue_ex: 0, tx_count: 0 };
    cur.revenue_ex += r.amount_ex_vat ?? 0;
    cur.tx_count   += 1;
    locMap.set(k, cur);
  }
  const byLocation: RetailByLocation[] = Array.from(locMap.entries())
    .map(([id, v]) => {
      const meta = SPA_LOCATION_META[id] ?? { name: `Location ${id}`, color: "#9CA3AF" };
      return {
        location_id:   id,
        name:          meta.name,
        color:         meta.color,
        revenue_gross: Math.round(v.revenue_ex * (1 + VAT_RATE)),
        tx_count:      v.tx_count,
      };
    })
    // Secondary tiebreaker on location_id keeps ordering stable when two
    // branches happen to land on identical revenue — otherwise Array.sort()
    // is implementation-defined and rows can reshuffle on re-fetch.
    .sort((a, b) => b.revenue_gross - a.revenue_gross || a.location_id - b.location_id);

  // ── By employee ─────────────────────────────────────────────────────────────
  const empMap = new Map<string, { revenue_ex: number; tx_count: number }>();
  for (const r of rows) {
    const name = normalizeName(r.employee_name);
    const cur = empMap.get(name) ?? { revenue_ex: 0, tx_count: 0 };
    cur.revenue_ex += r.amount_ex_vat ?? 0;
    cur.tx_count   += 1;
    empMap.set(name, cur);
  }
  const byEmployee: RetailByEmployee[] = Array.from(empMap.entries())
    .map(([employee_name, v]) => ({
      employee_name,
      revenue_gross: Math.round(v.revenue_ex * (1 + VAT_RATE)),
      tx_count:      v.tx_count,
    }))
    // Secondary tiebreaker on name keeps the top-N employee list deterministic
    // when revenue ties (common at the long tail).
    .sort((a, b) =>
      b.revenue_gross - a.revenue_gross
      || a.employee_name.localeCompare(b.employee_name)
    );

  // ── By brand ────────────────────────────────────────────────────────────────
  const brandMap = new Map<string, { revenue_ex: number; tx_count: number }>();
  for (const r of rows) {
    const brand = (r.product_brand ?? "Other").trim() || "Other";
    const cur = brandMap.get(brand) ?? { revenue_ex: 0, tx_count: 0 };
    cur.revenue_ex += r.amount_ex_vat ?? 0;
    cur.tx_count   += 1;
    brandMap.set(brand, cur);
  }
  const totalBrandEx = Array.from(brandMap.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
  const byBrand: RetailByBrand[] = Array.from(brandMap.entries())
    .map(([brand, v]) => ({
      brand,
      revenue_gross: Math.round(v.revenue_ex * (1 + VAT_RATE)),
      tx_count:      v.tx_count,
      pct:           Math.round((v.revenue_ex / totalBrandEx) * 1000) / 10,
    }))
    // Secondary tiebreaker on brand name — brand mix table renders bottom-up
    // and small brands tying on revenue must not flicker between renders.
    .sort((a, b) =>
      b.revenue_gross - a.revenue_gross
      || a.brand.localeCompare(b.brand)
    );

  // ── Totals ──────────────────────────────────────────────────────────────────
  const revenue_ex_vat = rows.reduce((s, r) => s + (r.amount_ex_vat ?? 0), 0);
  const revenue_gross  = Math.round(revenue_ex_vat * (1 + VAT_RATE));
  const tx_count       = rows.length;
  const aov            = tx_count > 0 ? Math.round(revenue_gross / tx_count) : 0;

  const totals: RetailTotals = {
    revenue_gross,
    revenue_ex_vat: Math.round(revenue_ex_vat),
    tx_count,
    aov,
    last_synced: null,
  };

  return {
    rows,
    byLocation,
    byEmployee,
    byBrand,
    totals,
    isFetching,
  };
}
