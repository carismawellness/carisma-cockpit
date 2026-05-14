"use client";

import { useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SlimmingSaleRow {
  id:                  number;
  sheet_tab:           string;
  month:               string;
  date_of_service:     string | null;
  client:              string | null;
  service_type:        "weight_loss" | "treatment" | "medical" | "product" | null;
  service_description: string | null;
  full_price:          number | null;
  paid:                number | null;
  vat_rate:            number | null;
  price_ex_vat:        number | null;
  sales_staff:         string | null;
  synced_at:           string;
}

export interface StaffBreakdown {
  staff:       string;
  tx_count:    number;
  revenue_ex:  number;
  revenue_inc: number;
}

export interface ServiceTypeBreakdown {
  type:        string;
  label:       string;
  tx_count:    number;
  revenue_ex:  number;
  pct:         number;
}

export interface ServiceBreakdown {
  service:    string;
  type:       string;
  tx_count:   number;
  revenue_ex: number;
  pct:        number;
}

export interface SlimmingSalesTotals {
  revenue_ex:   number;
  revenue_inc:  number;
  vat_amount:   number;
  tx_count:     number;
  last_synced:  string | null;
}

export interface UseSlimmingSalesResult {
  rows:          SlimmingSaleRow[];
  byStaff:       StaffBreakdown[];
  byServiceType: ServiceTypeBreakdown[];
  byService:     ServiceBreakdown[];
  totals:        SlimmingSalesTotals;
  isFetching:    boolean;
  isSyncing:     boolean;
  syncError:     string | null;
  missingMonths: string[];
  triggerSync:   () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsInRange(dateFrom: Date, dateTo: Date): string[] {
  const months: string[] = [];
  const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1);
  const end = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  while (d <= end) {
    months.push(toMonthStr(d));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  weight_loss: "Weight Loss Programme",
  treatment:   "Treatments",
  medical:     "Medical Consultation",
  product:     "Products",
};

// ── Service canonicalization (slimming-specific) ───────────────────────────────

const CANONICAL: [RegExp, string][] = [
  // Abbreviations used in the sheet
  [/^\s*ems\s*$/i,                          "EMS"],
  [/\bems\b/i,                              "EMS"],
  [/^\s*ff\s*$/i,                           "Fat Freezing"],
  [/\bff\b/i,                              "Fat Freezing"],
  [/^\s*rf\s*$/i,                           "Radiofrequency"],
  [/\brf\b/i,                              "Radiofrequency"],
  [/^\s*lipo\s*laser/i,                     "Laser Lipo"],
  [/^\s*us\s*$/i,                           "Ultrasound"],
  // Programmes
  [/24\s*w(?:eek)?.*transform.*medical/i,   "Transform Medical 24w"],
  [/12\s*w(?:eek)?.*transform.*medical/i,   "Transform Medical 12w"],
  [/6\s*w(?:eek)?.*transform.*medical/i,    "Transform Medical 6w"],
  [/24\s*w(?:eek)?.*transform/i,            "Transform Regular 24w"],
  [/12\s*w(?:eek)?.*transform/i,            "Transform Regular 12w"],
  [/6\s*w(?:eek)?.*transform/i,             "Transform Regular 6w"],
  [/transform.*medical/i,                   "Transform Medical"],
  [/transform/i,                            "Transform"],
  [/fat\s*freez/i,                          "Fat Freezing"],
  [/\bcavit/i,                              "Cavitation"],
  [/laser\s*lipo/i,                         "Laser Lipo"],
  [/\blipo\b/i,                             "Lipolysis"],
  [/slimming\s*guide/i,                     "Slimming Guide"],
  [/\bguide\b/i,                            "Slimming Guide"],
  [/consult/i,                              "Medical Consultation"],
  [/mixed/i,                                "Mixed Programme"],
  [/package/i,                              "Package"],
  [/\binject/i,                             "Injection"],
  [/sculpt/i,                               "Body Sculpting"],
  [/radio\s*freq/i,                         "Radiofrequency"],
  [/ultrasound/i,                           "Ultrasound"],
];

function canonicalize(raw: string): string {
  if (!raw) return "(Unspecified)";
  const cleaned = raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "(Unspecified)";
  for (const [re, name] of CANONICAL) {
    if (re.test(cleaned)) return name;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useSlimmingSales(dateFrom: Date, dateTo: Date): UseSlimmingSalesResult {
  const supabase      = createClient();
  const queryClient   = useQueryClient();
  const lastFiredRef  = useRef("");

  const fromMonth   = toMonthStr(new Date(dateFrom.getFullYear(), dateFrom.getMonth(), 1));
  const toMonth     = toMonthStr(new Date(dateTo.getFullYear(),   dateTo.getMonth(),   1));
  const fromDateStr = toDateStr(dateFrom);
  const toDateStr_  = toDateStr(dateTo);

  // ── 1. Fetch rows ────────────────────────────────────────────────────────────
  const { data: rows = [], isFetching } = useQuery({
    queryKey: ["slimming-sales", fromDateStr, toDateStr_],
    queryFn:  async () => {
      const { data, error } = await supabase
        .from("slimming_sales_daily")
        .select("*")
        .gte("month", fromMonth)
        .lte("month", toMonth)
        .order("date_of_service", { ascending: true });
      if (error) throw error;
      const all = (data ?? []) as SlimmingSaleRow[];
      return all.filter(r =>
        !r.date_of_service ||
        (r.date_of_service >= fromDateStr && r.date_of_service <= toDateStr_)
      );
    },
    staleTime: 0,
  });

  // ── 2. Sync mutation ─────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: async ({
      syncFrom,
      syncTo,
    }: {
      syncFrom?: Date;
      syncTo?: Date;
    } = {}) => {
      const res = await fetch("/api/etl/slimming-sales", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          date_from: toDateStr(syncFrom ?? dateFrom),
          date_to:   toDateStr(syncTo   ?? dateTo),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      return json;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slimming-sales", fromDateStr, toDateStr_] }),
  });

  // ── 3. Missing months + auto-refresh logic ────────────────────────────────
  const allMonths     = monthsInRange(dateFrom, dateTo);
  const presentMonths = new Set(rows.map((r: SlimmingSaleRow) => r.month));
  const missingMonths = allMonths.filter(m => !presentMonths.has(m));

  const autoRefreshFiredRef = useRef(false);
  const today       = new Date();
  const curMonthStr = toMonthStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const prevMonthStr = toMonthStr(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const recentInRange = !isFetching && (
    (curMonthStr  >= fromMonth && curMonthStr  <= toMonth) ||
    (prevMonthStr >= fromMonth && prevMonthStr <= toMonth)
  );

  const missingKey = missingMonths.join(",");
  if (!isFetching && !syncMutation.isPending) {
    if (missingMonths.length > 0 && missingKey !== lastFiredRef.current) {
      lastFiredRef.current = missingKey;
      setTimeout(() => syncMutation.mutate({}), 0);
    } else if (recentInRange && !autoRefreshFiredRef.current) {
      autoRefreshFiredRef.current = true;
      setTimeout(() => syncMutation.mutate({}), 0);
    }
  }

  // ── 3. By Staff ──────────────────────────────────────────────────────────────
  const byStaff = useMemo<StaffBreakdown[]>(() => {
    const map = new Map<string, StaffBreakdown>();
    for (const r of rows) {
      const raw   = r.sales_staff?.trim() ?? "(Unassigned)";
      const key   = raw.toLowerCase();
      const label = raw === "(Unassigned)" ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      const ex    = r.price_ex_vat  ?? 0;
      const inc   = r.full_price    ?? 0;
      if (!map.has(key)) {
        map.set(key, { staff: label, tx_count: 0, revenue_ex: 0, revenue_inc: 0 });
      }
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex  += ex;
      agg.revenue_inc += inc;
    }
    return Array.from(map.values())
      .map(s => ({ ...s, revenue_ex: Math.round(s.revenue_ex), revenue_inc: Math.round(s.revenue_inc) }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  // ── 4. By Service Type ───────────────────────────────────────────────────────
  const byServiceType = useMemo<ServiceTypeBreakdown[]>(() => {
    const map = new Map<string, { tx_count: number; revenue_ex: number }>();
    for (const r of rows) {
      const type = r.service_type ?? "unknown";
      if (!map.has(type)) map.set(type, { tx_count: 0, revenue_ex: 0 });
      const agg = map.get(type)!;
      agg.tx_count++;
      agg.revenue_ex += r.price_ex_vat ?? 0;
    }
    const totalEx = Array.from(map.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
    return Array.from(map.entries())
      .map(([type, v]) => ({
        type,
        label:      SERVICE_TYPE_LABELS[type] ?? type,
        tx_count:   v.tx_count,
        revenue_ex: Math.round(v.revenue_ex),
        pct:        Math.round((v.revenue_ex / totalEx) * 1000) / 10,
      }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  // ── 5. By Service ────────────────────────────────────────────────────────────
  const byService = useMemo<ServiceBreakdown[]>(() => {
    const map      = new Map<string, { type: string; tx_count: number; revenue_ex: number }>();
    const labelMap = new Map<string, string>();
    for (const r of rows) {
      const raw   = r.service_description?.trim() || "(Unspecified)";
      const label = canonicalize(raw);
      const key   = label.toLowerCase();
      if (!labelMap.has(key)) labelMap.set(key, label);
      if (!map.has(key)) map.set(key, { type: r.service_type ?? "unknown", tx_count: 0, revenue_ex: 0 });
      const agg = map.get(key)!;
      agg.tx_count++;
      agg.revenue_ex += r.price_ex_vat ?? 0;
    }
    const totalEx = Array.from(map.values()).reduce((s, v) => s + v.revenue_ex, 0) || 1;
    return Array.from(map.entries())
      .map(([key, v]) => ({
        service:    labelMap.get(key) ?? key,
        type:       v.type,
        tx_count:   v.tx_count,
        revenue_ex: Math.round(v.revenue_ex),
        pct:        Math.round((v.revenue_ex / totalEx) * 1000) / 10,
      }))
      .sort((a, b) => b.revenue_ex - a.revenue_ex);
  }, [rows]);

  // ── 6. Totals ────────────────────────────────────────────────────────────────
  const totals = useMemo<SlimmingSalesTotals>(() => {
    const ex  = rows.reduce((s, r) => s + (r.price_ex_vat ?? 0), 0);
    const inc = rows.reduce((s, r) => s + (r.full_price   ?? 0), 0);
    const last = rows.reduce((best, r) => {
      if (!r.synced_at) return best;
      return (!best || r.synced_at > best) ? r.synced_at : best;
    }, null as string | null);
    return {
      revenue_ex:  Math.round(ex),
      revenue_inc: Math.round(inc),
      vat_amount:  Math.round(inc - ex),
      tx_count:    rows.length,
      last_synced: last,
    };
  }, [rows]);

  return {
    rows,
    byStaff,
    byServiceType,
    byService,
    totals,
    isFetching,
    isSyncing:     syncMutation.isPending,
    syncError:     syncMutation.error ? (syncMutation.error as Error).message : null,
    missingMonths,
    triggerSync:   () => syncMutation.mutate({}),
  };
}
